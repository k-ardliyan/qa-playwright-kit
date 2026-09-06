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
 *   artifacts/reports/archive/<runId>/test-notes.json — per-test QA/AI notes sidecar
 *
 * @module src/agents/reporter/report-archive
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { deriveDisplayName, deriveTestSeriesId } from '../../support/custom-dashboard/domain/run';
import { resolveWorkspaceReportDir } from '../../shared/workspace-paths';
import {
  archiveTestNotesSnapshot,
  latestTestNotesPath,
  withLatestTestNotesLock,
} from './test-notes';
import {
  countAgentRunInsights,
  countReporterRunInsights,
  evaluateAnalysisGate,
  isAnalysisVerdict,
  isPipelineContext,
  type AnalysisDeclaration,
} from './analysis-gate';

// ─── Types ───────────────────────────────────────────────────────────────────

/** QA decision options when saving a run. */
export const QA_DECISIONS = [
  'APPROVE',
  'FILE_BUG',
  'REVISE_REQUIREMENT',
  'FIX_TEST',
  'FIX_ENV',
  'MARK_BLOCKED',
] as const;
export type QaDecision = (typeof QA_DECISIONS)[number];

export function isQaDecision(value: unknown): value is QaDecision {
  return typeof value === 'string' && (QA_DECISIONS as readonly string[]).includes(value);
}

/** Who triggered the save. */
export type TriggerSource =
  | 'cli'
  | 'cli-auto'
  | 'dashboard-button'
  | 'mcp-tool'
  | 'pipeline-runner'
  | 'test-fixture';

const TRIGGER_SOURCES: readonly TriggerSource[] = [
  'cli',
  'cli-auto',
  'dashboard-button',
  'mcp-tool',
  'pipeline-runner',
  'test-fixture',
];

function isTriggerSource(value: unknown): value is TriggerSource {
  return typeof value === 'string' && TRIGGER_SOURCES.includes(value as TriggerSource);
}

function isTriggeredBy(value: unknown): value is ArchiveMetadata['triggeredBy'] {
  return value === 'manual' || value === 'dashboard' || value === 'pipeline';
}

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
  /** Canonical Analyze verdict persisted at archive time. */
  analysisVerdict?: import('./analysis-gate').AnalysisVerdict;
  /** True only when declaration/evidence agree. */
  analysisVerified?: boolean;
  /** Gate issues for incomplete/non-approved runs. */
  analysisIssues?: string[];
  /** Detailed declaration copied from the Reporter pipeline report, if any. */
  analysis?: {
    completed?: unknown;
    runInsightsRecorded?: unknown;
    passedScenariosReviewed?: unknown;
    reviewedPassedScenarioIds?: unknown;
  };
}

/** Result of a successful save. */
export interface ArchiveSaveResult {
  runId: string;
  archivePath: string;
  summaryPath: string;
  metadataPath: string;
  analysisVerdict?: import('./analysis-gate').AnalysisVerdict;
  analysisVerified?: boolean;
  notesArchived: boolean;
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

/**
 * Resolve the Reporter Analyze declaration for the latest pipeline run. The
 * custom reporter owns test-summary.json, while the Reporter agent owns
 * pipeline-report-<id>.json; saveLatestRun bridges the two by selecting the
 * newest JSON with the same requirement identity.
 */
function loadLatestPipelineAnalysis(
  summary: Record<string, unknown>,
): AnalysisDeclaration | undefined {
  const requirementPath =
    typeof summary['requirementPath'] === 'string' ? (summary['requirementPath'] as string) : '';
  const candidates: Array<{ mtime: number; analysis: AnalysisDeclaration }> = [];
  try {
    for (const entry of fs.readdirSync(reportDir(), { withFileTypes: true })) {
      if (!entry.isFile() || !/^pipeline-report-.+\.json$/i.test(entry.name)) continue;
      const filePath = path.join(reportDir(), entry.name);
      try {
        const payload = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Record<string, unknown>;
        if (!payload['analysis'] || typeof payload['analysis'] !== 'object') continue;
        if (
          requirementPath &&
          typeof payload['requirementPath'] === 'string' &&
          payload['requirementPath'] !== requirementPath
        ) {
          continue;
        }
        candidates.push({
          mtime: fs.statSync(filePath).mtimeMs,
          analysis: payload['analysis'] as AnalysisDeclaration,
        });
      } catch {
        // Ignore an unrelated/corrupt historical pipeline report
      }
    }
  } catch {
    return undefined;
  }
  candidates.sort((a, b) => b.mtime - a.mtime);
  return candidates[0]?.analysis;
}

function isContainedPath(root: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return (
    relative === '' ||
    (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
  );
}

function resolveContainedExisting(
  root: string,
  relativePath: string,
  kind: 'file' | 'directory' | 'any',
): string | null {
  try {
    const rootReal = fs.realpathSync(root);
    const candidate = path.resolve(root, relativePath);
    if (!isContainedPath(root, candidate) || !fs.existsSync(candidate)) return null;
    const candidateReal = fs.realpathSync(candidate);
    if (!isContainedPath(rootReal, candidateReal)) return null;
    const stat = fs.statSync(candidateReal);
    if (kind === 'file' && !stat.isFile()) return null;
    if (kind === 'directory' && !stat.isDirectory()) return null;
    return candidateReal;
  } catch {
    return null;
  }
}

function ensureArchiveRoot(): string {
  const root = archiveDir();
  fs.mkdirSync(root, { recursive: true });
  const realRoot = fs.realpathSync(root);
  if (!isContainedPath(realRoot, realRoot)) {
    throw new Error('Invalid archive directory.');
  }
  return realRoot;
}

function validateArchiveMetadata(raw: Record<string, unknown>, runId: string): void {
  if (raw.runId !== runId || !isQaDecision(raw.qaDecision)) {
    throw new Error('Invalid archived metadata: qaDecision and runId are required.');
  }
  if (typeof raw.qaNotes !== 'string') {
    throw new Error('Invalid archived metadata: qaNotes must be a string.');
  }
  for (const key of ['savedAt', 'ranAt', 'appEnv', 'triggeredBy', 'triggerSource']) {
    if (typeof raw[key] !== 'string' || !(raw[key] as string).trim()) {
      throw new Error(`Invalid archived metadata: ${key} is required.`);
    }
  }
  if (
    raw.displayName !== undefined &&
    (typeof raw.displayName !== 'string' || !raw.displayName.trim())
  ) {
    throw new Error('Invalid archived metadata: displayName must not be empty.');
  }
  if (raw.triggerSource !== undefined && !isTriggerSource(raw.triggerSource)) {
    throw new Error('Invalid archived metadata: triggerSource is invalid.');
  }
  if (!isTriggeredBy(raw.triggeredBy)) {
    throw new Error('Invalid archived metadata: triggeredBy is invalid.');
  }
  if (raw.analysisVerdict !== undefined && !isAnalysisVerdict(raw.analysisVerdict)) {
    throw new Error('Invalid archived metadata: analysisVerdict is invalid.');
  }
  if (raw.analysisVerified !== undefined && typeof raw.analysisVerified !== 'boolean') {
    throw new Error('Invalid archived metadata: analysisVerified must be a boolean.');
  }
  if (raw.analysisIssues !== undefined && !Array.isArray(raw.analysisIssues)) {
    throw new Error('Invalid archived metadata: analysisIssues must be an array.');
  }
}

function validateMetadataUpdates(updates: Partial<SaveRunOptions>): void {
  if (updates.qaDecision !== undefined && !isQaDecision(updates.qaDecision)) {
    throw new Error(
      `Invalid qaDecision: ${String(updates.qaDecision)}. Must be one of: ${QA_DECISIONS.join(', ')}`,
    );
  }
  if (
    updates.displayName !== undefined &&
    (typeof updates.displayName !== 'string' || !updates.displayName.trim())
  ) {
    throw new Error('displayName must be a non-empty string.');
  }
  for (const key of [
    'qaNotes',
    'testSeriesId',
    'requirementId',
    'requirementTitle',
    'branch',
    'buildRef',
    'gitSha',
  ] as const) {
    const value = updates[key];
    if (value !== undefined && typeof value !== 'string') {
      throw new Error(`${key} must be a string.`);
    }
  }
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
 * The latest notes sidecar is locked for the complete operation: snapshot →
 * Analyze gate → staging archive → atomic sidecar carry → final commit →
 * latest reset. Dashboard Save and CLI archive:save therefore have exactly the
 * same gate and evidence semantics as the MCP archive path.
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

  if (!isQaDecision(qaDecision)) {
    throw new Error(
      `Invalid qaDecision: ${String(qaDecision)}. Must be one of: ${QA_DECISIONS.join(', ')}`,
    );
  }
  if (!isTriggerSource(triggerSource)) {
    throw new Error(`Invalid triggerSource: ${String(triggerSource)}.`);
  }
  if (typeof qaNotes !== 'string') throw new Error('qaNotes must be a string.');
  if (customDisplayName !== undefined && !customDisplayName.trim()) {
    throw new Error('displayName must not be empty.');
  }

  const summaryFile = summaryPath();
  if (!fs.existsSync(summaryFile)) {
    throw new Error('No test-summary.json found. Run tests first before saving.');
  }

  let summary: Record<string, unknown>;
  try {
    summary = JSON.parse(fs.readFileSync(summaryFile, 'utf-8')) as Record<string, unknown>;
  } catch {
    throw new Error('Failed to parse test-summary.json. File may be corrupted.');
  }

  let latestRun: Record<string, unknown> = {};
  if (fs.existsSync(latestRunPath())) {
    try {
      latestRun = JSON.parse(fs.readFileSync(latestRunPath(), 'utf-8')) as Record<string, unknown>;
    } catch {
      process.stderr.write(
        `[archive] Warning: .latest-run marker is corrupt or unreadable — ` +
          `reportMode and appEnv will use fallback values. ` +
          `Delete artifacts/reports/.latest-run and re-run tests to reset.\n`,
      );
    }
  }

  const ranAt =
    (summary['timestamp'] as string) ||
    (latestRun['timestamp'] as string) ||
    new Date().toISOString();
  const runId = generateRunId(ranAt);
  const archiveRoot = ensureArchiveRoot();
  const runDir = path.join(archiveRoot, runId);
  const reportAnalysis =
    (summary['analysis'] as AnalysisDeclaration | undefined) ?? loadLatestPipelineAnalysis(summary);
  if (!isContainedPath(archiveRoot, runDir)) {
    throw new Error('Refusing to write outside archive directory.');
  }

  return withLatestTestNotesLock((notesSnapshot) => {
    const effectiveSummary = {
      ...summary,
      // CLI/dashboard metadata overrides are part of context too; MCP and save
      // paths must gate a requirementId-only run identically.
      ...(customRequirementId && !summary['requirementId']
        ? { requirementId: customRequirementId }
        : {}),
    };
    const pipelineContext = isPipelineContext(effectiveSummary);
    const passedTests = Array.isArray(summary['testCases'])
      ? (summary['testCases'] as Array<Record<string, unknown>>).filter(
          (tc) => tc['status'] === 'passed',
        )
      : [];
    const passedScenarioIds = passedTests
      .map((tc) => (typeof tc['scenarioId'] === 'string' ? (tc['scenarioId'] as string) : ''))
      .filter(Boolean);

    const gate = evaluateAnalysisGate({
      qaDecision,
      pipelineContext,
      declaration: reportAnalysis,
      evidence: {
        sidecarAvailable: notesSnapshot !== null,
        sidecarRunId: notesSnapshot?.runId,
        expectedRunId: runId,
        runInsightsCount: notesSnapshot?.runInsights?.length,
        agentRunInsightsCount: notesSnapshot ? countAgentRunInsights(notesSnapshot) : 0,
        reporterRunInsightsCount: notesSnapshot ? countReporterRunInsights(notesSnapshot) : 0,
        passedCount:
          typeof summary['passed'] === 'number' ? (summary['passed'] as number) : undefined,
        passedScenarioIds,
      },
    });

    if (!gate.allowed) {
      const error = new Error(
        `${gate.code}: ${gate.issues.join('; ')}. ` +
          'Run the Analyze sub-phase or choose a non-APPROVE decision.',
      ) as Error & { code?: string };
      error.code = gate.code;
      throw error;
    }
    if (fs.existsSync(runDir)) {
      throw new Error(`Archive for run ${runId} already exists. Will not overwrite.`);
    }

    // Stage every archive file, then commit by one directory rename. A failed
    // carry or metadata write cannot leave a final-looking partial archive.
    const stagingDir = `${runDir}.staging-${process.pid}-${Date.now()}`;
    fs.mkdirSync(stagingDir, { recursive: true });
    let notesArchived = false;
    try {
      const archiveSummaryPath = path.join(stagingDir, 'summary.json');
      fs.writeFileSync(archiveSummaryPath, JSON.stringify(effectiveSummary, null, 2), 'utf-8');

      try {
        const srcAttachmentsResolved = resolveContainedExisting(
          reportDir(),
          'attachments',
          'directory',
        );
        if (srcAttachmentsResolved) {
          fs.cpSync(srcAttachmentsResolved, path.join(stagingDir, 'attachments'), {
            recursive: true,
          });
        }
      } catch {
        // Evidence attachment snapshot is best-effort; notes are strict.
      }

      if (notesSnapshot) {
        notesArchived = archiveTestNotesSnapshot(stagingDir, notesSnapshot);
        if (!notesArchived) {
          throw new Error(
            'NOTES_ARCHIVE_FAILED: could not atomically carry test-notes.json; latest sidecar was kept.',
          );
        }
      }

      const summaryWithAnalysis = {
        ...effectiveSummary,
        analysisVerdict: gate.verdict,
        analysisVerified: gate.analysisVerified,
        analysisIssues: gate.issues.length > 0 ? gate.issues : undefined,
      };
      fs.writeFileSync(archiveSummaryPath, JSON.stringify(summaryWithAnalysis, null, 2), 'utf-8');

      const durationMs =
        ((summary['runMeta'] as Record<string, unknown> | undefined)?.['totalDurationMs'] as
          | number
          | undefined) ?? (latestRun['totalDurationMs'] as number | undefined);
      const appEnv = (process.env.APP_ENV as string) || (latestRun['appEnv'] as string) || 'local';
      const requirementPath = (summary['requirementPath'] as string) || '';
      const requirementTitle =
        customRequirementTitle || (summary['requirementTitle'] as string) || '';
      const requirementId = customRequirementId || (summary['requirementId'] as string) || '';
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
        reportMode:
          (summary['reportMode'] as string) || (latestRun['reportMode'] as string) || 'general',
        qaDecision,
        qaNotes,
        triggeredBy: 'manual',
        triggerSource,
        analysisVerdict: gate.verdict,
        analysisVerified: gate.analysisVerified,
        analysisIssues: gate.issues.length > 0 ? gate.issues : undefined,
        analysis: reportAnalysis,
      };
      const metadataPath = path.join(stagingDir, 'metadata.json');
      fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2), 'utf-8');

      fs.renameSync(stagingDir, runDir);
      // Source lock remains held through this reset, so no latest write can be
      // deleted between snapshot transfer and reset.
      if (notesSnapshot) fs.rmSync(latestTestNotesPath(), { force: true });

      return {
        runId,
        archivePath: runDir,
        summaryPath: path.join(runDir, 'summary.json'),
        metadataPath: path.join(runDir, 'metadata.json'),
        analysisVerdict: gate.verdict,
        analysisVerified: gate.analysisVerified,
        notesArchived,
      };
    } catch (error) {
      try {
        fs.rmSync(stagingDir, { recursive: true, force: true });
      } catch {
        // Best-effort staging cleanup
      }
      throw error;
    }
  });
}

/**
 * Load an archived run's summary by runId.
 * Returns null if the run does not exist.
 */
export function loadArchivedSummary(runId: string): Record<string, unknown> | null {
  if (!isValidRunId(runId)) return null;
  const sp = resolveContainedExisting(archiveDir(), path.join(runId, 'summary.json'), 'file');
  if (!sp) return null;
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
  if (!isValidRunId(runId)) return null;
  const mp = resolveContainedExisting(archiveDir(), path.join(runId, 'metadata.json'), 'file');
  if (!mp) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(mp, 'utf-8')) as Record<string, unknown>;
    validateArchiveMetadata(raw, runId);
    const metadata = raw as unknown as ArchiveMetadata;
    if (!metadata.displayName) {
      metadata.displayName = deriveDisplayName({
        requirementTitle: metadata.requirementTitle,
        requirementPath: metadata.requirementPath,
        appEnv: metadata.appEnv,
        ranAt: metadata.ranAt,
      });
    }
    if (!metadata.testSeriesId) {
      metadata.testSeriesId = deriveTestSeriesId({
        requirementId: metadata.requirementId,
        requirementPath: metadata.requirementPath,
        requirementTitle: metadata.requirementTitle,
      });
    }
    return metadata;
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
  const runDir = resolveContainedExisting(ad, runId, 'directory');
  if (!runDir) return false;
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
  validateMetadataUpdates(updates);
  if (!isValidRunId(runId)) {
    throw new Error(`Invalid runId: "${runId}". RunId must match pattern run-YYYYMMDD-HHmmss-SSS.`);
  }
  const ad = archiveDir();
  const runDir = resolveContainedExisting(ad, runId, 'directory');
  if (!runDir) return null;

  const metadataPath = path.join(runDir, 'metadata.json');
  let existingMeta: ArchiveMetadata | null = null;
  const existingMetadataPath = resolveContainedExisting(runDir, 'metadata.json', 'file');
  if (existingMetadataPath) {
    try {
      const raw = JSON.parse(fs.readFileSync(existingMetadataPath, 'utf-8')) as Record<
        string,
        unknown
      >;
      validateArchiveMetadata(raw, runId);
      existingMeta = raw as unknown as ArchiveMetadata;
    } catch {
      existingMeta = null;
    }
  }

  const nextDecision = updates.qaDecision ?? existingMeta?.qaDecision;
  if (!isQaDecision(nextDecision)) {
    throw new Error(
      `Invalid qaDecision: ${String(nextDecision)}. Must be one of: ${QA_DECISIONS.join(', ')}`,
    );
  }
  if (updates.displayName !== undefined && !updates.displayName.trim()) {
    throw new Error('displayName must not be empty.');
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
    qaDecision: nextDecision,
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
    analysisVerdict: existingMeta?.analysisVerdict,
    analysisVerified: existingMeta?.analysisVerified,
    analysisIssues: existingMeta?.analysisIssues,
    analysis: existingMeta?.analysis,
  };

  if (!isContainedPath(runDir, metadataPath)) {
    throw new Error('Refusing to write metadata outside archive directory.');
  }
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
    const runDir = resolveContainedExisting(ad, entry.name, 'directory');
    if (!runDir) continue;
    const hasSummary = Boolean(resolveContainedExisting(runDir, 'summary.json', 'file'));
    const hasMetadata = Boolean(resolveContainedExisting(runDir, 'metadata.json', 'file'));
    if (!hasSummary || !hasMetadata) continue;

    const stat = fs.statSync(runDir);
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
