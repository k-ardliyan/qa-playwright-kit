/**
 * Structured Report Archive — Opt-in, QA-validated history.
 *
 * Archive is NOT automatic. QA must explicitly save a run via:
 *   - Dashboard "Save to History" button
 *   - CLI: `npm run archive:save`
 *
 * Storage per run:
 *   artifacts/reports/archive/<runId>/summary.json   — copy of test-summary.json
 *   artifacts/reports/archive/<runId>/metadata.json  — QA decision, notes, timestamps
 *
 * @module src/agents/reporter/report-archive
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { deriveDisplayName, deriveTestSeriesId } from '../../support/custom-dashboard/domain/run';
import { resolveWorkspaceReportDir } from '../../shared/workspace-paths';

// ─── Types ───────────────────────────────────────────────────────────────────

/** QA decision options when saving a run. */
export type QaDecision =
  'APPROVE' | 'FILE_BUG' | 'REVISE_REQUIREMENT' | 'FIX_TEST' | 'FIX_ENV' | 'MARK_BLOCKED';

/** Who triggered the save. */
export type TriggerSource =
  'cli' | 'cli-auto' | 'dashboard-button' | 'mcp-tool' | 'pipeline-runner' | 'test-fixture';

/** Options passed to saveLatestRun. */
export interface SaveRunOptions {
  qaDecision: QaDecision;
  qaNotes?: string;
  triggerSource: TriggerSource;
  displayName?: string;
  testSeriesId?: string;
  requirementId?: string;
  requirementTitle?: string;
  branch?: string;
  buildRef?: string;
  gitSha?: string;
}

/** Metadata written alongside the test summary when QA saves a run. */
export interface ArchiveMetadata {
  schemaVersion?: number;
  runId: string;
  displayName?: string;
  testSeriesId?: string;
  requirementId?: string;
  requirementTitle?: string;
  /** When the run was saved to archive (ISO 8601 with ms). */
  savedAt: string;
  /** When the test was actually executed (ISO 8601 with ms). */
  ranAt: string;
  /** Test run duration in milliseconds. */
  durationMs?: number;
  /** Target environment (dev, staging, etc.). */
  appEnv: string;
  /** Base URL tested against. */
  baseUrl?: string;
  /** Requirement file path, if pipeline run. */
  requirementPath?: string;
  /** Branch/ref or commit. */
  branch?: string;
  buildRef?: string;
  gitSha?: string;
  /** Report mode: 'general' | 'role-aware'. */
  reportMode?: string;
  /** QA decision — mandatory when saving. */
  qaDecision: QaDecision;
  /** QA free-text notes. */
  qaNotes: string;
  /** How the save was triggered. */
  triggeredBy: 'manual' | 'dashboard' | 'pipeline';
  /** Where the save was triggered from. */
  triggerSource: TriggerSource;
  files?: string[];
}

/** Result of a successful save. */
export interface ArchiveSaveResult {
  runId: string;
  archivePath: string;
  summaryPath: string;
  metadataPath: string;
}

// ─── Constants ───────────────────────────────────────────────────────────────

// Lazy accessors: read env vars at call time so unit tests can inject a custom
// archive path via QA_ARCHIVE_DIR / QA_REPORT_DIR without worrying about
// module import order or caching.
function reportDir(): string {
  return resolveWorkspaceReportDir();
}
function archiveDir(): string {
  if (process.env['QA_ARCHIVE_DIR']) return process.env['QA_ARCHIVE_DIR'];
  return path.join(reportDir(), 'archive');
}
function summaryPath(): string {
  return path.join(reportDir(), 'test-summary.json');
}
function latestRunPath(): string {
  return path.join(reportDir(), '.latest-run');
}

// ─── Run ID generation ──────────────────────────────────────────────────────

/**
 * Generate a human-readable runId from a timestamp.
 * Format: `run-YYYYMMDD-HHmmss-SSS`
 */
export function generateRunId(isoTimestamp?: string): string {
  const d = isoTimestamp ? new Date(isoTimestamp) : new Date();
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  return `run-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}-${pad(d.getMilliseconds(), 3)}`;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Save the latest test run to the archive.
 *
 * Reads `artifacts/reports/test-summary.json` + `artifacts/reports/.latest-run`,
 * copies the summary, and writes enriched metadata.
 *
 * Returns the save result or throws on validation failure.
 */
export function saveLatestRun(options: SaveRunOptions): ArchiveSaveResult {
  const {
    qaDecision,
    qaNotes = '',
    triggerSource,
    displayName: customDisplayName,
    testSeriesId: customTestSeriesId,
    requirementId: customRequirementId,
    requirementTitle: customRequirementTitle,
    branch: customBranch,
    buildRef: customBuildRef,
    gitSha: customGitSha,
  } = options;

  // 1. Validate test-summary.json exists
  if (!fs.existsSync(summaryPath())) {
    throw new Error('No test-summary.json found. Run tests first before saving.');
  }

  // 2. Read test-summary.json
  let summary: Record<string, unknown>;
  try {
    summary = JSON.parse(fs.readFileSync(summaryPath(), 'utf-8'));
  } catch {
    throw new Error('Failed to parse test-summary.json. File may be corrupted.');
  }

  // 3. Read .latest-run marker for metadata
  let latestRun: Record<string, unknown> = {};
  if (fs.existsSync(latestRunPath())) {
    try {
      latestRun = JSON.parse(fs.readFileSync(latestRunPath(), 'utf-8'));
    } catch {
      // Warn — corrupt marker means reportMode and appEnv fall back to defaults
      process.stderr.write(
        `[archive] Warning: .latest-run marker is corrupt or unreadable — ` +
          `reportMode and appEnv will use fallback values. ` +
          `Delete artifacts/reports/.latest-run and re-run tests to reset.\n`,
      );
    }
  }

  // 4. Generate runId from ranAt timestamp
  const ranAt =
    (summary.timestamp as string) || (latestRun.timestamp as string) || new Date().toISOString();
  const runId = generateRunId(ranAt);

  // 5. Validate runId doesn't already exist
  const runDir = path.join(archiveDir(), runId);
  if (fs.existsSync(runDir)) {
    throw new Error(`Archive for run ${runId} already exists. Will not overwrite.`);
  }

  // 6. Create archive directory
  fs.mkdirSync(runDir, { recursive: true });

  // 7. Write summary.json (copy from test-summary.json)
  const archiveSummaryPath = path.join(runDir, 'summary.json');
  fs.writeFileSync(archiveSummaryPath, JSON.stringify(summary, null, 2), 'utf-8');

  // 7b. Snapshot attachments directory if exists
  try {
    const srcAttachments = path.join(reportDir(), 'attachments');
    if (fs.existsSync(srcAttachments) && fs.statSync(srcAttachments).isDirectory()) {
      const destAttachments = path.join(runDir, 'attachments');
      fs.cpSync(srcAttachments, destAttachments, { recursive: true });
    }
  } catch {
    // Non-blocking attachment snapshot
  }

  // 8. Write metadata.json
  // durationMs: prefer summary.runMeta.totalDurationMs (set by custom reporter),
  // fall back to latestRun.totalDurationMs (written by .latest-run marker).
  const durationMs =
    ((summary.runMeta as Record<string, unknown> | undefined)?.totalDurationMs as
      number | undefined) ?? (latestRun.totalDurationMs as number | undefined);

  const appEnv = (process.env.APP_ENV as string) || (latestRun.appEnv as string) || 'local';
  const requirementPath = (summary.requirementPath as string) || '';
  const requirementTitle = customRequirementTitle || (summary.requirementTitle as string) || '';
  const requirementId = customRequirementId || (summary.requirementId as string) || '';

  const displayName = deriveDisplayName({
    displayName: customDisplayName,
    requirementTitle,
    requirementPath,
    appEnv,
    ranAt,
  });

  const testSeriesId = deriveTestSeriesId({
    testSeriesId: customTestSeriesId,
    requirementId,
    requirementPath,
    requirementTitle,
  });

  const metadata: ArchiveMetadata = {
    schemaVersion: 2,
    runId,
    displayName,
    testSeriesId,
    requirementId,
    requirementTitle,
    savedAt: new Date().toISOString(),
    ranAt,
    durationMs,
    appEnv,
    baseUrl: process.env.BASE_URL,
    requirementPath,
    branch: customBranch || (process.env.GIT_BRANCH as string) || undefined,
    buildRef: customBuildRef || (process.env.BUILD_REF as string) || undefined,
    gitSha: customGitSha || (process.env.GIT_SHA as string) || undefined,
    reportMode: (summary.reportMode as string) || (latestRun.reportMode as string) || 'general',
    qaDecision,
    qaNotes,
    triggeredBy: 'manual',
    triggerSource,
  };
  const metadataPath = path.join(runDir, 'metadata.json');
  fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2), 'utf-8');

  return {
    runId,
    archivePath: runDir,
    summaryPath: archiveSummaryPath,
    metadataPath,
  };
}

/**
 * Load an archived run's summary by runId.
 * Returns null if the run does not exist.
 */
export function loadArchivedSummary(runId: string): Record<string, unknown> | null {
  // Security: reject invalid runId (path traversal guard)
  if (!isValidRunId(runId)) return null;
  const ad = archiveDir();
  const resolved = path.resolve(path.join(ad, runId));
  if (!resolved.startsWith(path.resolve(ad) + path.sep)) return null;
  const sp = path.join(ad, runId, 'summary.json');
  if (!fs.existsSync(sp)) return null;
  try {
    return JSON.parse(fs.readFileSync(sp, 'utf-8'));
  } catch {
    return null;
  }
}

/**
 * Load an archived run's metadata by runId.
 * Returns null if the metadata does not exist.
 */
export function loadArchivedMetadata(runId: string): ArchiveMetadata | null {
  // Security: reject invalid runId (path traversal guard)
  if (!isValidRunId(runId)) return null;
  const ad = archiveDir();
  const resolved = path.resolve(path.join(ad, runId));
  if (!resolved.startsWith(path.resolve(ad) + path.sep)) return null;
  const mp = path.join(ad, runId, 'metadata.json');
  if (!fs.existsSync(mp)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(mp, 'utf-8')) as ArchiveMetadata;
    if (!raw.displayName) {
      raw.displayName = deriveDisplayName({
        requirementTitle: raw.requirementTitle,
        requirementPath: raw.requirementPath,
        appEnv: raw.appEnv,
        ranAt: raw.ranAt,
      });
    }
    if (!raw.testSeriesId) {
      raw.testSeriesId = deriveTestSeriesId({
        requirementId: raw.requirementId,
        requirementPath: raw.requirementPath,
        requirementTitle: raw.requirementTitle,
      });
    }
    return raw;
  } catch {
    return null;
  }
}

/**
 * Delete an archived report by runId.
 * Returns true if the report was deleted, false if not found.
 */
export function deleteArchivedReport(runId: string): boolean {
  // Guard against path traversal — runId must only contain safe characters
  if (!isValidRunId(runId)) {
    throw new Error(`Invalid runId: "${runId}". RunId must match pattern run-YYYYMMDD-HHmmss-SSS.`);
  }
  const ad = archiveDir();
  const runDir = path.join(ad, runId);
  // Verify the resolved path is inside archiveDir() (defense-in-depth)
  const resolved = path.resolve(runDir);
  if (!resolved.startsWith(path.resolve(ad) + path.sep)) {
    throw new Error(`Refusing to delete outside archive directory.`);
  }
  if (!fs.existsSync(runDir)) return false;
  try {
    fs.rmSync(runDir, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}

/**
 * Update metadata for an existing archived report.
 * Returns the updated ArchiveMetadata, or null if the run is not found.
 */
export function updateArchivedMetadata(
  runId: string,
  updates: Partial<SaveRunOptions>,
): ArchiveMetadata | null {
  if (!isValidRunId(runId)) {
    throw new Error(`Invalid runId: "${runId}". RunId must match pattern run-YYYYMMDD-HHmmss-SSS.`);
  }
  const ad = archiveDir();
  const runDir = path.join(ad, runId);
  const resolved = path.resolve(runDir);
  if (!resolved.startsWith(path.resolve(ad) + path.sep)) {
    throw new Error(`Refusing to access outside archive directory.`);
  }
  if (!fs.existsSync(runDir)) return null;

  const metadataPath = path.join(runDir, 'metadata.json');
  let existingMeta: ArchiveMetadata | null = null;
  if (fs.existsSync(metadataPath)) {
    try {
      existingMeta = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));
    } catch {
      existingMeta = null;
    }
  }

  if (!existingMeta?.qaDecision && updates.qaDecision === undefined) {
    throw new Error('qaDecision is required; metadata cannot imply APPROVE.');
  }

  const updatedMeta: ArchiveMetadata = {
    schemaVersion: existingMeta?.schemaVersion ?? 2,
    runId,
    displayName:
      updates.displayName !== undefined ? updates.displayName : existingMeta?.displayName,
    testSeriesId:
      updates.testSeriesId !== undefined ? updates.testSeriesId : existingMeta?.testSeriesId,
    requirementId:
      updates.requirementId !== undefined ? updates.requirementId : existingMeta?.requirementId,
    requirementTitle:
      updates.requirementTitle !== undefined
        ? updates.requirementTitle
        : existingMeta?.requirementTitle,
    qaDecision: updates.qaDecision ?? existingMeta!.qaDecision,
    qaNotes: updates.qaNotes !== undefined ? updates.qaNotes : (existingMeta?.qaNotes ?? ''),
    savedAt: existingMeta?.savedAt ?? new Date().toISOString(),
    ranAt: existingMeta?.ranAt ?? new Date().toISOString(),
    appEnv: existingMeta?.appEnv ?? (process.env.APP_ENV as string) ?? 'local',
    triggeredBy: existingMeta?.triggeredBy ?? 'dashboard',
    triggerSource: existingMeta?.triggerSource ?? 'dashboard-button',
    durationMs: existingMeta?.durationMs,
    baseUrl: existingMeta?.baseUrl,
    requirementPath: existingMeta?.requirementPath,
    branch: updates.branch ?? existingMeta?.branch,
    buildRef: updates.buildRef ?? existingMeta?.buildRef,
    gitSha: updates.gitSha ?? existingMeta?.gitSha,
    reportMode: existingMeta?.reportMode ?? 'general',
  };

  fs.writeFileSync(metadataPath, JSON.stringify(updatedMeta, null, 2), 'utf-8');

  return updatedMeta;
}

/**
 * Validate that a runId only contains safe path characters.
 * Accepted format: canonical timestamp IDs and legacy numeric IDs retained for
 * compatibility with existing archive links.
 */
export function isValidRunId(runId: string): boolean {
  return (
    /^run-[\d-]+$/.test(runId) &&
    !runId.includes('..') &&
    !runId.includes('/') &&
    !runId.includes('\\')
  );
}

/**
 * List all archived report runIds.
 * Returns sorted newest-first (by directory mtime).
 */
export function listArchivedRunIds(): string[] {
  const ad = archiveDir();
  if (!fs.existsSync(ad)) return [];

  const entries = fs.readdirSync(ad, { withFileTypes: true });
  const runIds: Array<{ runId: string; mtime: number }> = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (!isValidRunId(entry.name)) continue;
    const hasSummary = fs.existsSync(path.join(ad, entry.name, 'summary.json'));
    const hasMetadata = fs.existsSync(path.join(ad, entry.name, 'metadata.json'));
    if (!hasSummary || !hasMetadata) continue;

    const stat = fs.statSync(path.join(ad, entry.name));
    runIds.push({ runId: entry.name, mtime: stat.mtimeMs });
  }

  // Sort newest first — parse timestamp from runId string (deterministic, immune
  // to filesystem mtime drift when archives are copied or restored).
  const parseRunIdMs = (id: string): number => {
    const canon = id.match(/^run-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})-(\d{3})$/);
    if (canon) {
      const [, yr, mo, dy, hh, mm, ss, ms] = canon;
      return new Date(`${yr}-${mo}-${dy}T${hh}:${mm}:${ss}.${ms}Z`).getTime();
    }
    const legacy = id.match(/^run-(\d+)$/);
    if (legacy) return parseInt(legacy[1], 10);
    return 0;
  };
  runIds.sort((a, b) => {
    const ta = parseRunIdMs(a.runId);
    const tb = parseRunIdMs(b.runId);
    // Both unknown → preserve mtime order
    if (ta === 0 && tb === 0) return b.mtime - a.mtime;
    return tb - ta;
  });
  return runIds.map((r) => r.runId);
}

/**
 * Get the archive directory path.
 */
export function getArchiveDir(): string {
  return archiveDir();
}

/**
 * Check if the latest run has already been archived.
 * Compares timestamp from .latest-run against existing archives.
 */
export function isLatestRunArchived(): boolean {
  if (!fs.existsSync(latestRunPath())) return false;
  try {
    const latest = JSON.parse(fs.readFileSync(latestRunPath(), 'utf-8'));
    const runId = generateRunId(latest.timestamp as string);
    return fs.existsSync(path.join(archiveDir(), runId));
  } catch {
    return false;
  }
}

/**
 * Get the latest run info from .latest-run marker.
 * Returns null if no run has been executed.
 */
export function getLatestRunInfo(): {
  timestamp: string;
  summaryPath: string;
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  passRate: number;
  reportMode: string;
} | null {
  if (!fs.existsSync(latestRunPath())) return null;
  try {
    return JSON.parse(fs.readFileSync(latestRunPath(), 'utf-8'));
  } catch {
    return null;
  }
}
