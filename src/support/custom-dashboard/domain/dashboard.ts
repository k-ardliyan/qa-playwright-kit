/**
 * Domain types for the Executive & Operational Dashboard Overview.
 *
 * @module src/support/custom-dashboard/domain/dashboard
 */

import type { ReportHistoryEntry } from '../../../agents/reporter/report-history';
import type { QaDecision } from '../../../agents/reporter/report-archive';

export interface TrendPoint {
  runId: string;
  displayName: string;
  timestamp: string;
  passRate: number;
  totalTests: number;
  failedTests: number;
  qaDecision?: QaDecision | '';
}

export interface RecurringFailure {
  scenarioId: string;
  title: string;
  role?: string;
  module?: string;
  feature?: string;
  occurrences: number;
  lastErrorMessage?: string;
  lastFailureSource?: string;
}

export interface QualityMetrics {
  overallPassRate: number;
  totalArchivedRuns: number;
  totalTestsRun: number;
  recentFailuresCount: number;
  approvedRunsCount: number;
  activeTestSeriesCount: number;
}

export interface LatestRunSummary {
  runId: string;
  displayName: string;
  testSeriesId?: string;
  appEnv: string;
  ranAt: string;
  passRate: number;
  totalTests: number;
  passed: number;
  failed: number;
  skipped: number;
  durationMs?: number;
  isArchived: boolean;
  qaDecision?: QaDecision | '';
  analysisVerdict?: string;
  analysisVerified?: boolean;
  analysisIssues?: string[];
}

export interface DashboardOverviewData {
  latestRun: LatestRunSummary | null;
  metrics: QualityMetrics;
  recentRuns: ReportHistoryEntry[];
  passRateTrend: TrendPoint[];
  recurringFailures: RecurringFailure[];
  recentQaDecisions: Array<{
    runId: string;
    displayName: string;
    decision: QaDecision;
    notes: string;
    savedAt: string;
  }>;
  /** Cross-scenario AI insights: deterministic (reporter) + agent-authored (sidecar). */
  aiRunInsights: AiRunInsight[];
}

/** One entry of the AI Run Insights panel. */
export interface AiRunInsight {
  text: string;
  source: string;
  kind?: string;
  status?: string;
  priority?: string;
  confidence?: string;
  at?: string;
  /** Traceability metadata — what the insight affects. */
  affected?: {
    tests?: string[];
    modules?: string[];
    roles?: string[];
  };
}
