import type { ReportHistoryEntry } from '../../agents/reporter/report-history';
import { Dashboard } from './components/dashboard/Dashboard';
import type { CollectedTestData, TestSummary } from './types';

export interface DashboardOptions {
  /** Whether a latest test run exists (for Save to History banner). */
  hasLatestRun?: boolean;
  /** Whether the latest run has already been archived by QA. */
  latestRunArchived?: boolean;
  /**
   * When true, the dashboard is served via dashboard-server.ts (localhost).
   * Buttons call fetch() API instead of copying CLI commands.
   * Default: false (static HTML mode).
   */
  serveMode?: boolean;
}

/**
 * Normalize optional runtime fields that may be absent when raw
 * `test-summary.json` payloads are rendered (server mode normalizes via
 * `normalizeTestCases`, but CLI/preview/static paths do not). Defaulting here
 * — once, at the entry point — protects every component from `undefined`.
 */
function normalizeCollectedTests(tests: CollectedTestData[]): CollectedTestData[] {
  return (tests ?? []).map((t) => ({
    ...t,
    attachments: t.attachments ?? [],
    errors: t.errors ?? [],
    steps: t.steps ?? [],
    affectedLayer: t.affectedLayer ?? [],
    retry: t.retry ?? 0,
  }));
}

/**
 * Shared dashboard HTML builder used by both buildCiHtml and buildLocalHtml.
 * Powered by KitaJS TSX component tree.
 */
export function buildDashboardHtml(
  mode: 'ci' | 'local',
  summary: TestSummary,
  collectedTests: CollectedTestData[],
  history?: ReportHistoryEntry[],
  options?: DashboardOptions,
): string {
  return String(
    Dashboard({
      mode,
      summary,
      collectedTests: normalizeCollectedTests(collectedTests),
      history,
      options,
    }),
  );
}
