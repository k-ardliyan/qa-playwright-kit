/**
 * MCP tool: `pipeline_status`.
 *
 * One-call orientation for QA: reads the pipeline state file, the last test
 * summary, and the auth session dir, then answers "where am I and is the
 * environment ready?" — replacing the 3 separate reads an agent previously
 * had to make before deciding to resume or start fresh.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { getRepoRoot } from '../utils/safety';
import { mcpWorkspace } from '../utils/workspace-paths';
import { readTextFile } from '../utils/file-reader';
import { safeJsonParse } from '../utils/json-parser';
import { computeSourceHash } from '../contracts';

interface AppEnvResolution {
  appEnv: string;
  source: string;
}

interface AppEnvResolverOptions {
  repoRoot: string;
  pinFileContents?: string | null;
  ci?: boolean;
}

type AppEnvResolver = (options: AppEnvResolverOptions) => AppEnvResolution;

const KNOWN_APP_ENVS = new Set(['local', 'dev', 'staging', 'production']);
const ACTIVE_ENV_FILENAME = '.active-env';

/**
 * Optional test/runtime seam. Handler callers use defaults; tests can inject a
 * temporary workspace without changing output shape or reading credential data.
 */
export interface PipelineStatusOptions {
  repoRoot?: string;
  pinFileContents?: string | null;
  ci?: boolean;
}

function fallbackResolveAppEnv(options: AppEnvResolverOptions): AppEnvResolution {
  const rawOs = process.env.APP_ENV?.trim();
  if (rawOs) {
    return KNOWN_APP_ENVS.has(rawOs)
      ? { appEnv: rawOs, source: 'os' }
      : { appEnv: 'local', source: 'invalid_os' };
  }

  const ci = options.ci ?? process.env.CI === 'true';
  if (!ci) {
    const pinPath = path.join(options.repoRoot, 'config', 'environments', ACTIVE_ENV_FILENAME);
    const rawPin =
      options.pinFileContents !== undefined
        ? options.pinFileContents
        : fs.existsSync(pinPath)
          ? fs.readFileSync(pinPath, 'utf8')
          : null;
    const pin = rawPin?.trim();
    if (pin) {
      return KNOWN_APP_ENVS.has(pin)
        ? { appEnv: pin, source: 'pin' }
        : { appEnv: 'local', source: 'invalid_pin' };
    }
  }

  return { appEnv: 'local', source: 'default' };
}

function loadAppEnvResolver(workspaceRoot: string): AppEnvResolver {
  try {
    // Keep nested MCP package buildable without importing root-only runtime code.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require(path.join(workspaceRoot, 'src', 'utils', 'app-env')) as {
      resolveAppEnv?: AppEnvResolver;
    };
    if (typeof mod.resolveAppEnv === 'function') return mod.resolveAppEnv;
  } catch {
    // Standalone MCP package: use boundary-safe fallback with same precedence.
  }
  return fallbackResolveAppEnv;
}

export interface PipelineStatusOutput {
  status: 'success' | 'no_state';
  message: string;
  state?: {
    runId: string;
    status: string;
    currentPhase: string | null;
    completedPhases: string[];
    orchestrationMode: string;
    requirementPath: string;
    lastUpdated: string;
    /** True when the requirement file on disk still matches the hashed version. */
    requirementUpToDate: boolean | null;
    /** Relative artifact paths recorded by the state file that no longer exist. */
    missingArtifacts: string[];
  };
  lastRun?: {
    total: number;
    passed: number;
    failed: number;
    skipped: number;
    passRate: number;
    timestamp: string;
  } | null;
  environment?: {
    appEnv: string;
    authDir: string | null;
    authRoles: string[];
  };
}

const PHASE_ORDER = ['plan', 'generate', 'execute', 'heal', 'report'];

/** Report dir uses the test-only QA_REPORT_DIR override or canonical workspace path. */
function resolveReportsDir(repoRoot: string): string {
  const override = process.env['QA_REPORT_DIR'];
  return override ? path.resolve(override) : path.join(repoRoot, mcpWorkspace.reportsRel);
}

function readState(repoRoot: string, reportsDir: string): { data: Record<string, unknown> } | null {
  const candidate = path.join(reportsDir, 'pipeline-state.json');
  if (!fs.existsSync(candidate)) return null;
  const parsed = safeJsonParse<Record<string, unknown>>(readTextFile(candidate));
  return parsed.ok ? { data: parsed.data } : null;
}

function checkArtifacts(repoRoot: string, state: Record<string, unknown>): string[] {
  const artifacts = state.artifacts;
  if (typeof artifacts !== 'object' || artifacts === null) return [];
  const missing: string[] = [];
  for (const files of Object.values(artifacts as Record<string, unknown>)) {
    if (!Array.isArray(files)) continue;
    for (const rel of files) {
      if (typeof rel !== 'string' || rel.length === 0) continue;
      if (!fs.existsSync(path.resolve(repoRoot, rel))) {
        missing.push(rel);
      }
    }
  }
  return missing;
}

export function pipelineStatus(options: PipelineStatusOptions = {}): PipelineStatusOutput {
  const repoRoot = options.repoRoot ?? getRepoRoot();

  // ── Auth environment (always reported) ──────────────────────────────────
  const resolved = loadAppEnvResolver(repoRoot)({
    repoRoot,
    pinFileContents: options.pinFileContents,
    ci: options.ci,
  });
  const appEnv = resolved.appEnv;
  const authDir = path.join(repoRoot, '.auth', appEnv);
  const authRoles = fs.existsSync(authDir)
    ? fs
        .readdirSync(authDir)
        .filter((f) => f.endsWith('.json'))
        .map((f) => f.replace(/\.json$/, ''))
    : [];

  const environment: PipelineStatusOutput['environment'] = {
    appEnv,
    authDir: authRoles.length > 0 ? path.relative(repoRoot, authDir).replace(/\\/g, '/') : null,
    authRoles,
  };

  // ── Pipeline state ──────────────────────────────────────────────────────
  const reportsDir = resolveReportsDir(repoRoot);
  const stateFile = readState(repoRoot, reportsDir);
  if (!stateFile) {
    return {
      status: 'no_state',
      message:
        'No pipeline state found. Start a fresh run: Plan phase for your requirement (see AGENTS.md pipeline).',
      lastRun: null,
      environment,
    };
  }

  const s = stateFile.data;
  const requirementPath = typeof s.requirementPath === 'string' ? s.requirementPath : '';
  const requirementUpToDate = (() => {
    // Staleness is only knowable when a hash was recorded; otherwise null.
    const hash = typeof s.requirementHash === 'string' ? s.requirementHash : '';
    if (!hash || !requirementPath) return null;
    const abs = path.resolve(repoRoot, requirementPath);
    if (!fs.existsSync(abs)) return false;
    try {
      const sourceText = fs.readFileSync(abs, 'utf-8');
      return computeSourceHash(sourceText) === hash;
    } catch {
      return null;
    }
  })();

  const state: PipelineStatusOutput['state'] = {
    runId: typeof s.runId === 'string' ? s.runId : '',
    status: typeof s.status === 'string' ? s.status : 'unknown',
    currentPhase: typeof s.currentPhase === 'string' ? s.currentPhase : null,
    completedPhases: Array.isArray(s.completedPhases)
      ? (s.completedPhases as string[]).filter((p) => PHASE_ORDER.includes(p))
      : [],
    orchestrationMode: typeof s.orchestrationMode === 'string' ? s.orchestrationMode : 'manual',
    requirementPath,
    lastUpdated: typeof s.timestamp === 'string' ? s.timestamp : '',
    requirementUpToDate,
    missingArtifacts: checkArtifacts(repoRoot, s),
  };

  // ── Last run summary ────────────────────────────────────────────────────
  const summaryPath = path.join(reportsDir, 'test-summary.json');
  let lastRun: PipelineStatusOutput['lastRun'] = null;
  if (fs.existsSync(summaryPath)) {
    const parsed = safeJsonParse<{
      total?: unknown;
      passed?: unknown;
      failed?: unknown;
      skipped?: unknown;
      passRate?: unknown;
      timestamp?: unknown;
    }>(readTextFile(summaryPath));
    if (
      parsed.ok &&
      typeof parsed.data.total === 'number' &&
      typeof parsed.data.passed === 'number' &&
      typeof parsed.data.failed === 'number' &&
      typeof parsed.data.skipped === 'number' &&
      typeof parsed.data.passRate === 'number' &&
      typeof parsed.data.timestamp === 'string'
    ) {
      lastRun = {
        total: parsed.data.total,
        passed: parsed.data.passed,
        failed: parsed.data.failed,
        skipped: parsed.data.skipped,
        passRate: parsed.data.passRate,
        timestamp: parsed.data.timestamp,
      };
    }
  }

  // ── Actionable guidance ─────────────────────────────────────────────────
  const nextSteps: string[] = [];
  if (state.status === 'running' || state.status === 'paused') {
    if (state.missingArtifacts.length > 0) {
      nextSteps.push(
        `${state.missingArtifacts.length} artifact(s) recorded in state are missing on disk — affected phases are invalid, re-run them.`,
      );
    }
    if (state.requirementUpToDate === false) {
      nextSteps.push(
        'Requirement changed since this run started — start a fresh run instead of resuming.',
      );
    }
    const remaining = PHASE_ORDER.filter((p) => !state.completedPhases.includes(p));
    nextSteps.push(`Resume from phase: ${remaining[0] ?? 'report'}.`);
  } else if (state.status === 'failed') {
    nextSteps.push('Last run failed — inspect unresolved failures before restarting.');
  } else if (lastRun && lastRun.failed === 0) {
    nextSteps.push(
      'All tests passed — review dashboard and record qaDecision (archive via archive_report).',
    );
  }

  return {
    status: 'success',
    message:
      nextSteps.length > 0
        ? `Pipeline ${state.status} (phase: ${state.currentPhase ?? '-'}). ${nextSteps.join(' ')}`
        : `Pipeline ${state.status} (phase: ${state.currentPhase ?? '-'}).`,
    state,
    lastRun,
    environment,
  };
}
