/**
 * Aggregation logic for the Executive & Operational Dashboard Overview.
 *
 * @module src/support/custom-dashboard/domain/dashboard-overview
 */

import type { ReportHistoryEntry } from '../../../agents/reporter/report-history';
import type {
  DashboardOverviewData,
  FailureSourceMixEntry,
  LatestRunSummary,
  ModuleHealthEntry,
  QualityMetrics,
  RecurringFailure,
  TrendPoint,
} from './dashboard';
import { deriveDisplayName, deriveTestSeriesId } from './run';

/** Statuses counted as "unhealthy" for triage and source-mix aggregation. */
export const UNHEALTHY_STATUSES = new Set(['failed', 'timedOut', 'interrupted']);

/** Canonical failure-source order for display (unknown last). */
export const FAILURE_SOURCE_ORDER = [
  'app',
  'test',
  'requirement',
  'env',
  'ai_generation',
  'unknown',
];

function normalizeTestCases(raw: unknown): Array<Record<string, unknown>> {
  return Array.isArray(raw)
    ? (raw as Array<Record<string, unknown>>).filter((t) => t && typeof t === 'object')
    : [];
}

/** A test case is unhealthy when its status is a failure-ish status. */
export function isUnhealthyStatus(status: unknown): boolean {
  return typeof status === 'string' && UNHEALTHY_STATUSES.has(status);
}

/**
 * Failure-source mix from a list of collected test cases (raw summary shape).
 * Counts only unhealthy cases; tests without an annotated source fall into
 * `unknown`. Pure — unit-testable without DOM/state.
 */
export function computeFailureSourceMix(
  rawTestCases: unknown[],
  windowLimit = 200,
): FailureSourceMixEntry[] {
  const testCases = normalizeTestCases(rawTestCases);
  const counts = new Map<string, number>();
  const sourceOf = (tc: Record<string, unknown>): string => {
    const s = tc.failureSource;
    return typeof s === 'string' && s ? s : 'unknown';
  };
  const candidates = testCases.slice(-windowLimit);
  for (const tc of candidates) {
    if (!isUnhealthyStatus(tc.status)) continue;
    const source = sourceOf(tc);
    counts.set(source, (counts.get(source) ?? 0) + 1);
  }
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  if (total === 0) return [];
  return FAILURE_SOURCE_ORDER.filter((s) => counts.has(s)).map((source) => ({
    source,
    count: counts.get(source) ?? 0,
    share: (counts.get(source) ?? 0) / total,
  }));
}

/**
 * Per-module pass rate from collected test cases. Modules derive from each
 * test's `module` field (fallback: `feature`, then `unknown`). Pure.
 */
export function computeModuleHealth(
  rawTestCases: unknown[],
  windowLimit = 500,
): ModuleHealthEntry[] {
  const testCases = normalizeTestCases(rawTestCases);
  const perModule = new Map<string, { total: number; failed: number }>();
  const moduleOf = (tc: Record<string, unknown>): string => {
    const m = tc.module;
    const f = tc.feature;
    if (typeof m === 'string' && m && m !== '-') return m;
    if (typeof f === 'string' && f && f !== '-') return f;
    return 'unknown';
  };
  for (const tc of testCases.slice(-windowLimit)) {
    if (typeof tc.status !== 'string' || tc.status === 'skipped') continue;
    const module = moduleOf(tc);
    const entry = perModule.get(module) ?? { total: 0, failed: 0 };
    entry.total += 1;
    if (isUnhealthyStatus(tc.status)) entry.failed += 1;
    perModule.set(module, entry);
  }
  return [...perModule.entries()]
    .map(([module, { total, failed }]) => ({
      module,
      total,
      failed,
      passRate: total === 0 ? 0 : Math.round(((total - failed) / total) * 100),
    }))
    .sort((a, b) => b.passRate - a.passRate || b.total - a.total);
}

/** Titles of tests in the latest run that passed only after a retry. */
export function computeFlakyTests(rawTestCases: unknown[]): string[] {
  const testCases = normalizeTestCases(rawTestCases);
  const out: string[] = [];
  for (const tc of testCases) {
    const retry = typeof tc.retry === 'number' ? tc.retry : 0;
    if (retry > 0 && tc.status === 'passed') {
      out.push((tc.title as string) || (tc.testId as string) || 'untitled');
    }
  }
  return out;
}

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
  /** Notes sidecar — agent-authored runInsights feed the AI Run Insights panel. */
  testNotes?: unknown;
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
      analysisVerdict:
        (summary?.analysisVerdict as string | undefined) ||
        (isArchived ? history.find((entry) => entry.runId === runId)?.analysisVerdict : undefined),
      analysisVerified:
        (summary?.analysisVerified as boolean | undefined) ??
        (isArchived ? history.find((entry) => entry.runId === runId)?.analysisVerified : undefined),
      analysisIssues:
        (summary?.analysisIssues as string[] | undefined) ??
        (isArchived ? history.find((entry) => entry.runId === runId)?.analysisIssues : undefined),
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

  // Flaky tests (passed after retry) from the latest run — needed by metrics.
  const latestTestCases = normalizeTestCases(
    summary && Array.isArray(summary.testCases) ? summary.testCases : [],
  );
  const flakyTests = computeFlakyTests(latestTestCases);

  const metrics: QualityMetrics = {
    overallPassRate: avgPassRate,
    totalArchivedRuns: totalArchived,
    totalTestsRun,
    recentFailuresCount: latestRun?.failed ?? 0,
    approvedRunsCount: approvedCount,
    activeTestSeriesCount: Math.max(1, activeSeries),
    flakyCount: flakyTests.length,
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

  // 4b. Failure-source mix + module health.
  // - Failure source per-test is only retained for the latest run (archived
  //   history entries carry aggregates, not per-test sources).
  // - Module health folds the latest run's test cases together with the
  //   archived runs' summaryByModule aggregates.
  const failureSourceMix = computeFailureSourceMix(latestTestCases);

  const moduleMap = new Map<string, { total: number; failed: number }>();
  const addModule = (module: string, total: number, failed: number): void => {
    const cur = moduleMap.get(module) ?? { total: 0, failed: 0 };
    cur.total += total;
    cur.failed += failed;
    moduleMap.set(module, cur);
  };
  for (const tc of latestTestCases) {
    if (typeof tc.status !== 'string' || tc.status === 'skipped') continue;
    const module = (
      typeof tc.module === 'string' && tc.module && tc.module !== '-'
        ? tc.module
        : typeof tc.feature === 'string' && tc.feature && tc.feature !== '-'
          ? tc.feature
          : 'unknown'
    ) as string;
    addModule(module, 1, isUnhealthyStatus(tc.status) ? 1 : 0);
  }
  for (const entry of history.slice(0, 6)) {
    const perModule = entry.summaryByModule;
    if (!perModule || typeof perModule !== 'object') continue;
    for (const [module, bucket] of Object.entries(perModule)) {
      const features = (bucket as { features?: Record<string, unknown> }).features ?? {};
      let total = 0;
      let failed = 0;
      for (const f of Object.values(features)) {
        const passing = (f as { passing?: number }).passing ?? 0;
        const failing = (f as { failing?: number }).failing ?? 0;
        const skipped = (f as { skipped?: number }).skipped ?? 0;
        total += passing + failing + skipped;
        failed += failing;
      }
      if (total > 0) addModule(module as string, total, failed);
    }
  }
  const moduleHealth: ModuleHealthEntry[] = [...moduleMap.entries()]
    .map(([module, { total, failed }]) => ({
      module,
      total,
      failed,
      passRate: total === 0 ? 0 : Math.round(((total - failed) / total) * 100),
    }))
    .sort((a, b) => a.passRate - b.passRate || b.total - a.total);

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
    aiRunInsights: buildAiRunInsights(summary, options.testNotes),
    failureSourceMix,
    moduleHealth,
    flakyTests,
  };
}

/**
 * Cross-scenario AI insights for the overview panel: deterministic insights
 * baked by the reporter (`summary.aiInsights`) first, then agent-authored
 * run insights from the notes sidecar (newest last).
 */
function buildAiRunInsights(
  summary: Record<string, unknown> | null | undefined,
  testNotes: unknown,
): DashboardOverviewData['aiRunInsights'] {
  const entries: DashboardOverviewData['aiRunInsights'] = [];
  const deterministic =
    summary && Array.isArray(summary['aiInsights'])
      ? (summary['aiInsights'] as unknown[]).filter((v): v is string => typeof v === 'string')
      : [];
  for (const text of deterministic) {
    entries.push({ text, source: 'analyzer' });
  }
  if (testNotes && typeof testNotes === 'object') {
    const runInsights = (testNotes as { runInsights?: unknown }).runInsights;
    if (Array.isArray(runInsights)) {
      for (const entry of runInsights) {
        if (!entry || typeof entry !== 'object') continue;
        const e = entry as Record<string, unknown>;
        if (typeof e['text'] !== 'string' || typeof e['source'] !== 'string') continue;
        const affected = e['affected'] as
          | { tests?: string[]; modules?: string[]; roles?: string[] }
          | undefined;
        entries.push({
          text: e['text'],
          source: e['source'],
          kind: typeof e['kind'] === 'string' ? e['kind'] : undefined,
          status: typeof e['status'] === 'string' ? e['status'] : undefined,
          priority: typeof e['priority'] === 'string' ? e['priority'] : undefined,
          confidence: typeof e['confidence'] === 'string' ? e['confidence'] : undefined,
          at: typeof e['at'] === 'string' ? e['at'] : undefined,
          affected:
            affected && typeof affected === 'object'
              ? {
                  tests: Array.isArray(affected.tests) ? affected.tests : undefined,
                  modules: Array.isArray(affected.modules) ? affected.modules : undefined,
                  roles: Array.isArray(affected.roles) ? affected.roles : undefined,
                }
              : undefined,
        });
      }
    }
  }
  return entries;
}
