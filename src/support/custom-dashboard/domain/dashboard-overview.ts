/**
 * Aggregation logic for the Executive & Operational Dashboard Overview.
 *
 * @module src/support/custom-dashboard/domain/dashboard-overview
 */

import type { ReportHistoryEntry } from '../../../agents/reporter/report-history';
import type {
  DashboardOverviewData,
  LatestRunSummary,
  QualityMetrics,
  RecurringFailure,
  TrendPoint,
} from './dashboard';
import { deriveDisplayName, deriveTestSeriesId } from './run';

export interface BuildDashboardOptions {
  latestRunInfo?: {
    timestamp: string;
    total: number;
    passed: number;
    failed: number;
    skipped: number;
    passRate: number;
    reportMode: string;
    appEnv?: string;
    totalDurationMs?: number;
    runId?: string;
  } | null;
  latestSummary?: Record<string, unknown> | null;
  latestRunArchived?: boolean;
  history?: ReportHistoryEntry[];
}

export function buildDashboardOverview(options: BuildDashboardOptions): DashboardOverviewData {
  const history = options.history ?? [];
  const info = options.latestRunInfo;
  const summary = options.latestSummary;
  const isArchived = options.latestRunArchived ?? false;

  // 1. Build LatestRunSummary
  let latestRun: LatestRunSummary | null = null;
  if (info || summary) {
    const runMeta = (summary?.runMeta as Record<string, unknown> | undefined) ?? {};
    const ranAt = (summary?.timestamp as string) || info?.timestamp || new Date().toISOString();
    const appEnv =
      (runMeta.appEnv as string) ||
      (summary?.appEnv as string) ||
      info?.appEnv ||
      (process.env.APP_ENV as string) ||
      'local';
    const requirementPath =
      (runMeta.requirementPath as string) || (summary?.requirementPath as string) || '';
    const requirementTitle = (summary?.requirementTitle as string) || '';
    const requirementId = (summary?.requirementId as string) || '';

    const passRate = (summary?.passRate as number) ?? info?.passRate ?? 0;
    const total = (summary?.total as number) ?? info?.total ?? 0;
    const passed = (summary?.passed as number) ?? info?.passed ?? 0;
    const failed = (summary?.failed as number) ?? info?.failed ?? 0;
    const skipped = (summary?.skipped as number) ?? info?.skipped ?? 0;
    const durationMs =
      ((summary?.runMeta as Record<string, unknown> | undefined)?.totalDurationMs as number) ??
      info?.totalDurationMs;

    const runId =
      info?.runId ||
      (summary?.runId as string | undefined) ||
      (runMeta.runId as string | undefined) ||
      (isArchived
        ? history.find((entry) => entry.ranAt === ranAt || entry.savedAt === ranAt)?.runId
        : undefined) ||
      'latest';

    const displayName = deriveDisplayName({
      requirementTitle,
      requirementPath,
      appEnv,
      ranAt,
    });

    const testSeriesId = deriveTestSeriesId({
      requirementId,
      requirementPath,
      requirementTitle,
    });

    latestRun = {
      runId,
      displayName,
      testSeriesId,
      appEnv,
      ranAt,
      passRate,
      totalTests: total,
      passed,
      failed,
      skipped,
      durationMs,
      isArchived,
      qaDecision: isArchived
        ? history.find((entry) => entry.runId === runId || entry.ranAt === ranAt)?.qaDecision
        : undefined,
    };
  }

  // 2. Metrics Calculation
  const totalArchived = history.length;
  const latestIsAlreadyArchived = Boolean(
    latestRun &&
    history.some((entry) => entry.runId === latestRun.runId || entry.ranAt === latestRun.ranAt),
  );
  const allRates = history.map((h) => h.passRate);
  if (latestRun && !latestIsAlreadyArchived) allRates.push(latestRun.passRate);

  const avgPassRate =
    allRates.length > 0 ? Math.round(allRates.reduce((a, b) => a + b, 0) / allRates.length) : 0;

  const totalTestsRun =
    history.reduce((sum, h) => sum + h.totalTests, 0) +
    (latestRun && !latestIsAlreadyArchived ? latestRun.totalTests : 0);
  const approvedCount = history.filter((h) => h.qaDecision === 'APPROVE').length;
  const activeSeries = new Set(history.map((h) => h.testSeriesId).filter(Boolean)).size;

  const metrics: QualityMetrics = {
    overallPassRate: avgPassRate,
    totalArchivedRuns: totalArchived,
    totalTestsRun,
    recentFailuresCount: latestRun?.failed ?? 0,
    approvedRunsCount: approvedCount,
    activeTestSeriesCount: Math.max(1, activeSeries),
  };

  // 3. Pass Rate Trend Points (chronological, max 15)
  const trendPoints: TrendPoint[] = [...history]
    .reverse()
    .slice(-15)
    .map((h) => ({
      runId: h.runId,
      displayName: h.displayName || h.runId,
      timestamp: h.savedAt || h.ranAt,
      passRate: h.passRate,
      totalTests: h.totalTests,
      failedTests: h.failed,
      qaDecision: h.qaDecision,
    }));

  // 4. Recurring Failures Scan
  const failureCounts = new Map<
    string,
    {
      scenarioId: string;
      title: string;
      role?: string;
      module?: string;
      feature?: string;
      occurrences: number;
      lastErrorMessage?: string;
      lastFailureSource?: string;
    }
  >();

  // Scan latest run test cases if available
  if (summary && Array.isArray(summary.testCases)) {
    for (const tc of summary.testCases as Array<Record<string, unknown>>) {
      if (tc.status === 'failed' || tc.status === 'timedOut') {
        const id = (tc.testId as string) || (tc.title as string);
        failureCounts.set(id, {
          scenarioId: (tc.testId as string) || (tc.scenarioId as string) || id,
          title: (tc.title as string) || id,
          role: tc.role as string | undefined,
          module: tc.module as string | undefined,
          feature: tc.feature as string | undefined,
          occurrences: 1,
          lastErrorMessage: tc.errorMessage as string | undefined,
          lastFailureSource: tc.failureSource as string | undefined,
        });
      }
    }
  }

  const recurringFailures: RecurringFailure[] = [...failureCounts.values()]
    .sort((a, b) => b.occurrences - a.occurrences)
    .slice(0, 5);

  // 5. Recent QA Decisions
  const recentQaDecisions = history
    .filter((h) => Boolean(h.qaDecision))
    .slice(0, 5)
    .map((h) => ({
      runId: h.runId,
      displayName: h.displayName || h.runId,
      decision: h.qaDecision as import('../../../agents/reporter/report-archive').QaDecision,
      notes: h.qaNotes,
      savedAt: h.savedAt || h.ranAt,
    }));

  return {
    latestRun,
    metrics,
    recentRuns: history.slice(0, 6),
    passRateTrend: trendPoints,
    recurringFailures,
    recentQaDecisions,
  };
}
