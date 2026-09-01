/**
 * Report History Browser — reads QA-validated archives.
 *
 * Only returns runs that have been explicitly saved by QA.
 * Legacy archives (pre-refactor) are supported via fallback.
 *
 * @module src/agents/reporter/report-history
 */

import {
  loadArchivedSummary,
  loadArchivedMetadata,
  listArchivedRunIds,
  type QaDecision,
} from './report-archive';
import { deriveDisplayName, deriveTestSeriesId } from '../../support/custom-dashboard/domain/run';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ReportHistoryEntry {
  runId: string;
  /** Human-readable QA label (e.g. "Login Regression — Staging RC12") */
  displayName?: string;
  /** Logical grouping identifier for comparable runs (e.g. "auth-login-regression") */
  testSeriesId?: string;
  /** Requirement identifier (e.g. "REQ-AUTH-001") */
  requirementId?: string;
  /** Requirement title */
  requirementTitle?: string;
  /** When the test was executed. */
  ranAt: string;
  /** When the run was saved to archive. */
  savedAt: string;
  /** QA decision on this run. */
  qaDecision: QaDecision | '';
  /** QA notes. */
  qaNotes: string;
  /** How the save was triggered. */
  triggerSource: string;
  /** Target environment. */
  appEnv: string;
  /** Base URL tested. */
  baseUrl?: string;
  /** Requirement path. */
  requirementPath: string;
  /** Pass rate (0-100). */
  passRate: number;
  /** Total tests. */
  totalTests: number;
  /** Tests passed. */
  passed: number;
  /** Tests failed. */
  failed: number;
  /** Tests skipped. */
  skipped: number;
  /** Report mode. */
  reportMode: string;
  /** Overall status: 'success' | 'partial' | 'failed'. */
  status: 'success' | 'partial' | 'failed';
  /** Duration in ms. */
  durationMs?: number;
  /** Roles in scope (role-aware mode). */
  rolesInScope?: string[];
  /** Summary by role. */
  summaryByRole?: Record<string, { passing: number; failing: number; skipped: number }>;
  /** Summary by module. */
  summaryByModule?: Record<
    string,
    { features: Record<string, { passing: number; failing: number; skipped: number }> }
  >;
}

export interface ReportHistoryQuery {
  sort?: 'newest' | 'oldest';
  limit?: number;
  /** Filter by QA decision. */
  qaDecision?: QaDecision;
  /** Filter by appEnv. */
  appEnv?: string;
  /** Filter by requirement path. */
  requirementPath?: string;
  /** Filter by test series. */
  testSeriesId?: string;
  /** Filter by role. */
  role?: string;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * List report history entries from QA-validated archives.
 *
 * Only returns runs that have been explicitly saved by QA.
 * Supports filtering by decision, environment, requirement, role.
 */
export function listReportHistory(query?: ReportHistoryQuery): ReportHistoryEntry[] {
  const sort = query?.sort ?? 'newest';
  const limit = query?.limit ?? 50;
  const runIds = listArchivedRunIds();

  const entries: ReportHistoryEntry[] = [];

  for (const runId of runIds) {
    const metadata = loadArchivedMetadata(runId);
    const summary = loadArchivedSummary(runId);

    if (summary) {
      const entry = buildEntry(runId, summary, metadata);
      if (matchesFilter(entry, query)) {
        entries.push(entry);
      }
    }
  }

  // Sort
  entries.sort((a, b) => {
    const dateA = new Date(a.savedAt || a.ranAt).getTime();
    const dateB = new Date(b.savedAt || b.ranAt).getTime();
    return sort === 'newest' ? dateB - dateA : dateA - dateB;
  });

  return entries.slice(0, limit);
}

/**
 * Get history for a specific requirement path.
 */
export function getRequirementHistory(requirementPath: string): ReportHistoryEntry[] {
  return listReportHistory({ requirementPath, sort: 'newest' });
}

// ─── Internal ────────────────────────────────────────────────────────────────

function deriveStatus(
  passRate: number,
  failed: number,
  skipped: number,
): ReportHistoryEntry['status'] {
  if (failed > 0) return 'failed';
  if (skipped > 0) return 'partial';
  if (passRate >= 100) return 'success';
  return 'partial';
}

function buildEntry(
  runId: string,
  summary: Record<string, unknown>,
  metadata: import('./report-archive').ArchiveMetadata | null,
): ReportHistoryEntry {
  const passRate = (summary.passRate as number) ?? 0;
  const total = (summary.total as number) ?? 0;
  const passed = (summary.passed as number) ?? 0;
  const failed = (summary.failed as number) ?? 0;
  const skipped = (summary.skipped as number) ?? 0;

  const ranAt = metadata?.ranAt ?? (summary.timestamp as string) ?? '';
  const appEnv = metadata?.appEnv ?? 'local';
  const requirementPath = metadata?.requirementPath ?? (summary.requirementPath as string) ?? '';
  const requirementTitle = metadata?.requirementTitle ?? (summary.requirementTitle as string) ?? '';
  const requirementId = metadata?.requirementId ?? (summary.requirementId as string) ?? '';

  const displayName =
    metadata?.displayName ||
    deriveDisplayName({
      requirementTitle,
      requirementPath,
      appEnv,
      ranAt,
    });

  const testSeriesId =
    metadata?.testSeriesId ||
    deriveTestSeriesId({
      requirementId,
      requirementPath,
      requirementTitle,
    });

  return {
    runId,
    displayName,
    testSeriesId,
    requirementId,
    requirementTitle,
    ranAt,
    savedAt: metadata?.savedAt ?? '',
    qaDecision: metadata?.qaDecision ?? '',
    qaNotes: metadata?.qaNotes ?? '',
    triggerSource: metadata?.triggerSource ?? 'cli',
    appEnv,
    baseUrl: metadata?.baseUrl,
    requirementPath,
    passRate,
    totalTests: total,
    passed,
    failed,
    skipped,
    reportMode: (summary.reportMode as string) ?? metadata?.reportMode ?? 'general',
    status: deriveStatus(passRate, failed, skipped),
    durationMs: metadata?.durationMs,
    rolesInScope: summary.rolesInScope as string[] | undefined,
    summaryByRole: summary.summaryByRole as ReportHistoryEntry['summaryByRole'],
    summaryByModule: summary.summaryByModule as ReportHistoryEntry['summaryByModule'],
  };
}

function matchesFilter(entry: ReportHistoryEntry, query?: ReportHistoryQuery): boolean {
  if (!query) return true;
  if (query.qaDecision && entry.qaDecision !== query.qaDecision) return false;
  if (query.appEnv && entry.appEnv !== query.appEnv) return false;
  if (query.requirementPath && entry.requirementPath !== query.requirementPath) return false;
  if (query.testSeriesId && entry.testSeriesId !== query.testSeriesId) return false;
  if (query.role) {
    const roles = entry.rolesInScope ?? [];
    if (!roles.includes(query.role)) return false;
  }
  return true;
}
