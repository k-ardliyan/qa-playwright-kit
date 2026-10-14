import { buildDashboardHtml } from './build-dashboard-html';
import type { DashboardOptions } from './build-dashboard-html';
import type { ReportHistoryEntry } from '../../agents/reporting/report-history';
import type { CollectedTestData, TestSummary } from './report-model';

export function buildCiHtml(
  summary: TestSummary,
  collectedTests: CollectedTestData[],
  history?: ReportHistoryEntry[],
  options?: DashboardOptions,
): string {
  return buildDashboardHtml('ci', summary, collectedTests, history, options);
}
