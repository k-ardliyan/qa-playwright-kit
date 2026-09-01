/**
 * Reporter Agent — Barrel Export
 *
 * Re-exports all public APIs from the reporter module:
 * - Report Builder: Pipeline report interfaces and construction
 * - Report Archive: Opt-in save, load, delete, list
 * - Report History: Browse QA-validated archives
 * - Report Compare: Cross-run comparison
 * - Report AI Query: Natural-language query interface
 *
 * @module agents/reporter
 */

export {
  buildReport,
  writeReportMarkdown,
  type BuildReportInput,
  type PipelineReport,
  type ScenarioCoverage,
  type UnresolvedFailure,
} from './report-builder';

export {
  saveLatestRun,
  updateArchivedMetadata,
  loadArchivedSummary,
  loadArchivedMetadata,
  deleteArchivedReport,
  listArchivedRunIds,
  getArchiveDir,
  generateRunId,
  isLatestRunArchived,
  getLatestRunInfo,
  type ArchiveMetadata,
  type ArchiveSaveResult,
  type QaDecision,
  type TriggerSource,
} from './report-archive';

export {
  listReportHistory,
  getRequirementHistory,
  type ReportHistoryEntry,
  type ReportHistoryQuery,
} from './report-history';

export {
  compareReports,
  compareLatestVsPrevious,
  generateComparisonSummary,
  type ScenarioDiff,
  type ReportComparison,
} from './report-compare';

export { queryReportHistory, type AIReportQuery, type AIReportAnswer } from './report-ai-query';
