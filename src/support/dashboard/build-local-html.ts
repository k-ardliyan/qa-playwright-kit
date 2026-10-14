import { buildDashboardHtml } from './build-dashboard-html';
import type { DashboardOptions } from './build-dashboard-html';
import type { ReportHistoryEntry } from '../../agents/reporting/report-history';
import type { CollectedTestData, TestSummary } from './report-model';

export function buildLocalHtml(
  summary: TestSummary,
  collectedTests: CollectedTestData[],
  history?: ReportHistoryEntry[],
  options?: DashboardOptions,
): string {
  return buildDashboardHtml('local', summary, collectedTests, history, options);
}
