import * as fs from 'node:fs';
import * as path from 'node:path';
import { getRepoRoot } from '../utils/safety';
import { mcpWorkspace } from '../utils/workspace-paths';
import { readTextFile } from '../utils/file-reader';
import { safeJsonParse } from '../utils/json-parser';
import { loadNotesFile, noteKeyCandidates, latestTestNotesPath } from '../utils/test-notes';
import { readPendingRun } from '../utils/run-context';

export interface TestSummary {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  passRate: number;
  timestamp: string;
  // === Table View extensions (populated by custom reporter) ===
  /** 'general' = no role scope; 'role-aware' = tests grouped by role */
  reportMode?: 'general' | 'role-aware';
  /** Roles found in scope across all collected tests */
  rolesInScope?: string[];
  /** Full per-test case data for Reporter Agent and pipeline report */
  testCases?: CollectedTestCase[];
  /** Deterministic cross-scenario AI insights baked by the custom reporter */
  aiInsights?: string[];
  /** Safe run context from custom reporter (no secrets) */
  runMeta?: RunMeta;
}

/** Suggested / annotated root cause class for QA exit decisions. */
export type FailureSource = 'app' | 'test' | 'requirement' | 'env' | 'ai_generation' | 'unknown';

/** Safe run context — never embed secrets. */
export interface RunMeta {
  appEnv: string;
  runId?: string;
  requirementPath?: string;
  ci: boolean;
  totalDurationMs: number;
  generatedAt: string;
}

/** Flat per-test-case record written to test-summary.json by custom reporter */
export interface CollectedTestCase {
  testId: string;
  scenarioId: string;
  title: string;
  role: string;
  status: string;
  priority: 'high' | 'medium' | 'low';
  duration: number;
  inputData: Record<string, string>;
  expectedResult: string;
  actualResult: string;
  affectedLayer: Array<'FE' | 'BE' | 'DB' | 'API'>;
  attachmentCount: number;
  hasTrace: boolean;
  /** Present on unhealthy tests when custom reporter ran */
  failureSource?: FailureSource;
  /** QA free-text note — merged from the test-notes sidecar when present */
  qaNotes?: string;
  /** AI-authored insight — deterministic + agent narrative, sidecar merged */
  aiNotes?: string;
}

export interface RoleSummary {
  passing: number;
  failing: number;
  skipped: number;
}

export interface FeatureSummary {
  passing: number;
  failing: number;
}

/** Per-module test result breakdown — Opsi B: module contains nested features. */
export interface ModuleSummary {
  passing: number;
  failing: number;
  features: Record<string, FeatureSummary>;
}

export interface GetTestSummaryOutput {
  status: 'success' | 'no_results' | 'error';
  summary?: TestSummary;
  /** Per-role breakdown — only present when test files follow *-<role>.spec.ts naming */
  byRole?: Record<string, RoleSummary>;
  /** Per-module breakdown — derived from module field in test-summary.json or requirement folder */
  byModule?: Record<string, ModuleSummary>;
  /** Full per-test-case data from custom reporter — only present when reportMode is set */
  testCases?: CollectedTestCase[];
  /** Report mode from custom reporter — 'general' or 'role-aware' */
  reportMode?: 'general' | 'role-aware';
  /** Roles in scope from custom reporter */
  rolesInScope?: string[];
  /** Safe run context from custom reporter when present */
  runMeta?: RunMeta;
  /** Deterministic cross-scenario AI insights from the reporter */
  aiInsights?: string[];
  /** Run-level agent insights from the notes sidecar (overview panel source) */
  runInsights?: Array<{
    text: string;
    source: string;
    kind?: string;
    status?: string;
    priority?: string;
    confidence?: string;
    at?: string;
  }>;
  /** Canonical archive runId (run-YYYYMMDD-HHmmss-SSS) for notes tooling */
  archiveRunId?: string;
  /** Pending pipeline run id when a pipeline run is active (pre-run notes bind to it) */
  pipelineRunId?: string;
  message: string;
}

function resolveSummaryPath(): string {
  return path.join(mcpWorkspace.reportsDir, 'test-summary.json');
}

/** Canonical archive runId (run-YYYYMMDD-HHmmss-SSS) from a run timestamp. */
function canonicalArchiveRunId(timestamp?: string): string | null {
  if (!timestamp) return null;
  const d = new Date(timestamp);
  if (Number.isNaN(d.getTime())) return null;
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  return `run-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}-${pad(d.getMilliseconds(), 3)}`;
}

/**
 * Merge the notes sidecar (QA free-text + agent AI notes) into the flat test
 * cases — notes are written AFTER the reporter runs, so every consumer must
 * overlay them here. Key resolution includes the `user` ↔ `general` alias.
 */
function mergeSidecarNotes(testCases: CollectedTestCase[]): {
  testCases: CollectedTestCase[];
  runInsights: GetTestSummaryOutput['runInsights'];
} {
  const notes = loadNotesFile(latestTestNotesPath());
  const merged = testCases.map((tc) => {
    for (const key of noteKeyCandidates(tc.scenarioId, tc.testId, tc.role)) {
      const entry = notes.notes[key];
      if (!entry) continue;
      const qaNotes = entry.qaNotes.trim() || undefined;
      const agentAi = entry.aiNotes.trim();
      const aiNotes = [agentAi, tc.aiNotes?.trim()].filter(Boolean).join('\n') || undefined;
      if (qaNotes || aiNotes)
        return { ...tc, ...(qaNotes ? { qaNotes } : {}), ...(aiNotes ? { aiNotes } : {}) };
      break;
    }
    return tc;
  });
  return { testCases: merged, runInsights: notes.runInsights };
}

/**
 * Attempt to build byRole and byModule breakdowns from test-summary.json testCases.
 * byRole: from role field on each test case.
 * byModule: from module field on each test case (set by custom reporter via annotation).
 * Does not scan legacy directories when the canonical summary is unavailable.
 */
function buildBreakdowns(): {
  byRole: Record<string, RoleSummary>;
  byModule: Record<string, ModuleSummary>;
} {
  const byRole: Record<string, RoleSummary> = {};
  const byModule: Record<string, ModuleSummary> = {};

  // Primary: read from test-summary.json testCases (most accurate)
  const summaryPath = resolveSummaryPath();
  if (fs.existsSync(summaryPath)) {
    try {
      const raw = readTextFile(summaryPath);
      const parsed = safeJsonParse<{
        testCases?: Array<{
          role?: string;
          module?: string;
          feature?: string;
          status?: string;
        }>;
      }>(raw);
      if (parsed.ok && Array.isArray(parsed.data.testCases)) {
        for (const tc of parsed.data.testCases) {
          const status = tc.status ?? 'unknown';
          const passing = status === 'passed' ? 1 : 0;
          const failing = status === 'failed' || status === 'timedOut' ? 1 : 0;
          const skipped = status === 'skipped' ? 1 : 0;

          // byRole
          const role = tc.role;
          if (role) {
            if (!byRole[role]) byRole[role] = { passing: 0, failing: 0, skipped: 0 };
            byRole[role].passing += passing;
            byRole[role].failing += failing;
            byRole[role].skipped += skipped;
          }

          // byModule (Opsi B: nested features)
          const mod = tc.module ?? '-';
          const feat = tc.feature ?? '-';
          if (!byModule[mod]) byModule[mod] = { passing: 0, failing: 0, features: {} };
          byModule[mod].passing += passing;
          byModule[mod].failing += failing;
          if (!byModule[mod].features[feat])
            byModule[mod].features[feat] = { passing: 0, failing: 0 };
          byModule[mod].features[feat].passing += passing;
          byModule[mod].features[feat].failing += failing;
        }
        return { byRole, byModule };
      }
    } catch {
      // Canonical summary is authoritative.
    }
  }

  return { byRole, byModule };
}

export function getTestSummary(): GetTestSummaryOutput {
  const repoRoot = getRepoRoot();
  const absolutePath = resolveSummaryPath();

  if (!fs.existsSync(absolutePath)) {
    const rel = path.relative(repoRoot, absolutePath).replace(/\\/g, '/');
    return {
      status: 'no_results',
      message: `${rel} not found. Run tests first to generate the custom reporter summary.`,
    };
  }

  try {
    const raw = readTextFile(absolutePath);
    const parsed = safeJsonParse<TestSummary>(raw);
    if (!parsed.ok) {
      return { status: 'error', message: parsed.error.message };
    }

    const summary = parsed.data;
    if (
      typeof summary.total !== 'number' ||
      typeof summary.passed !== 'number' ||
      typeof summary.failed !== 'number' ||
      typeof summary.skipped !== 'number' ||
      typeof summary.passRate !== 'number' ||
      typeof summary.timestamp !== 'string'
    ) {
      return {
        status: 'error',
        message:
          'test-summary.json is missing required fields: total, passed, failed, skipped, passRate, timestamp.',
      };
    }

    const timestampMs = Date.parse(summary.timestamp);
    if (Number.isNaN(timestampMs)) {
      return { status: 'error', message: 'test-summary.json has an invalid timestamp.' };
    }

    const mtime = fs.statSync(absolutePath).mtime.toISOString();
    const { byRole, byModule } = buildBreakdowns();

    const result: GetTestSummaryOutput = {
      status: 'success',
      summary,
      message: `Summary: ${summary.passed}/${summary.total} passed (${summary.passRate}% pass rate, timestamp ${summary.timestamp}, file modified ${mtime}).`,
    };

    if (Object.keys(byRole).length > 0) result.byRole = byRole;
    if (Object.keys(byModule).length > 0) result.byModule = byModule;

    // Expose table-view extensions from custom reporter if present
    if (summary.reportMode) result.reportMode = summary.reportMode;
    if (summary.rolesInScope && summary.rolesInScope.length > 0) {
      result.rolesInScope = summary.rolesInScope;
    }
    if (Array.isArray(summary.testCases) && summary.testCases.length > 0) {
      const { testCases: merged, runInsights } = mergeSidecarNotes(summary.testCases);
      result.testCases = merged;
      if (runInsights && runInsights.length > 0) result.runInsights = runInsights;
    }
    if (Array.isArray(summary.aiInsights) && summary.aiInsights.length > 0) {
      result.aiInsights = summary.aiInsights;
    }
    if (summary.runMeta && typeof summary.runMeta === 'object') {
      result.runMeta = summary.runMeta;
    }
    // Canonical archive identity for notes tooling (record_ai_note runId etc.)
    const archiveRunId = canonicalArchiveRunId(summary.timestamp);
    if (archiveRunId) result.archiveRunId = archiveRunId;
    const pending = readPendingRun();
    if (pending) result.pipelineRunId = pending.runId;

    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error reading test summary';
    return { status: 'error', message };
  }
}
