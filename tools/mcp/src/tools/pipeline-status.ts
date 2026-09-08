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
import { probeAuthRoles, type AuthRoleStatus } from '../utils/auth-probe';
import { computeSourceHash } from '../contracts';
import { ensurePendingRun } from '../utils/run-context';

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

export type McpWorkflowStage = 'explore' | 'model' | 'challenge' | 'generate' | 'validate';

/**
 * Derive semantic workflow stage from the physical pipeline phase.
 */
export function deriveWorkflowStage(currentPhase: string | null): McpWorkflowStage | undefined {
  if (!currentPhase) return undefined;
  switch (currentPhase) {
    case 'plan':
      return 'model';
    case 'generate':
      return 'generate';
    case 'execute':
    case 'heal':
    case 'report':
      return 'validate';
    default:
      return undefined;
  }
}

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
  /** Pending pipeline run id (run-YYYYMMDD-HHmmss-SSS) when a run is active —
   *  pass this as `runId` to note tools so pre-run notes bind to this run. */
  pipelineRunId?: string;
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
    /** Semantic workflow stage derived from current physical phase. */
    workflowStage?: McpWorkflowStage;
    /** Native semantic workflow envelope (qa.workflow/v1) when present. */
    workflow?: {
      schemaVersion: string;
      mode: 'semantic-v1' | 'physical-compat';
      currentStage: McpWorkflowStage | null;
      currentSubstage?: 'execute' | 'heal' | 'report-analyze' | 'qa-review';
      stageStatus: Record<string, string>;
      exploreDecision?: string;
      challengeDecision?: string;
      lastFeedback?: { loopTarget: string; failureSource: string; reason: string };
    };
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
    /** Role names present in `.auth/{appEnv}/` (filename listing). */
    authRoles: string[];
    /**
     * Static per-role readiness (cookie TTL / structural probe). `null` = unknown —
     * session lives in localStorage (no TTL on disk); verify with `auth:verify`
     * or a live check before trusting it. `false` = expired/malformed → re-run
     * `npm run auth:setup` (real UI login — never inject storage state).
     */
    authRoleStatus: AuthRoleStatus[];
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

const WORKFLOW_STAGE_NAMES = ['explore', 'model', 'challenge', 'generate', 'validate'];

/** Extract per-stage status from the workflow envelope (honest: never fabricate). */
function extractStageStatuses(raw: unknown): Record<string, string> {
  const stages = (raw as Record<string, unknown> | null)?.stages;
  if (typeof stages !== 'object' || stages === null) return {};
  const out: Record<string, string> = {};
  for (const name of WORKFLOW_STAGE_NAMES) {
    const entry = (stages as Record<string, unknown>)[name];
    if (typeof entry === 'object' && entry !== null) {
      const status = (entry as Record<string, unknown>).status;
      if (typeof status === 'string') out[name] = status;
    }
  }
  return out;
}

/** Extract a stage decision status (explore/challenge) when recorded. */
function extractDecision(raw: unknown, key: 'explore' | 'challenge'): string | undefined {
  const entry = (raw as Record<string, unknown> | null)?.[key];
  if (typeof entry === 'object' && entry !== null) {
    const status = (entry as Record<string, unknown>).status;
    if (typeof status === 'string') return status;
  }
  return undefined;
}

/** Extract the last feedback decision when recorded. */
function extractLastFeedback(
  raw: unknown,
): { loopTarget: string; failureSource: string; reason: string } | undefined {
  const fb = (raw as Record<string, unknown> | null)?.lastFeedback;
  if (typeof fb !== 'object' || fb === null) return undefined;
  const rec = fb as Record<string, unknown>;
  if (typeof rec.loopTarget !== 'string' || typeof rec.failureSource !== 'string') {
    return undefined;
  }
  return {
    loopTarget: rec.loopTarget,
    failureSource: rec.failureSource,
    reason: typeof rec.reason === 'string' ? rec.reason : '',
  };
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
  const authRoleStatus = probeAuthRoles(authDir);
  const authRoles = authRoleStatus.map((r) => r.role);

  const environment: PipelineStatusOutput['environment'] = {
    appEnv,
    authDir: authRoles.length > 0 ? path.relative(repoRoot, authDir).replace(/\\/g, '/') : null,
    authRoles,
    authRoleStatus,
  };

  // Auth readiness warnings apply in every branch — a pre-flight "no_state"
  // read is exactly when an agent decides whether sessions are usable.
  const authWarnings: string[] = [];
  const notReadyRoles = authRoleStatus.filter((r) => r.ready === false);
  const unknownRoles = authRoleStatus.filter((r) => r.ready === null);
  if (notReadyRoles.length > 0) {
    authWarnings.push(
      `Auth session expired/malformed for role(s): ${notReadyRoles.map((r) => r.role).join(', ')} — re-run: npm run auth:setup (real UI login; never inject storage state).`,
    );
  }
  if (unknownRoles.length > 0) {
    authWarnings.push(
      `Auth readiness unknown for role(s): ${unknownRoles.map((r) => r.role).join(', ')} — session may live in localStorage (no cookie TTL on disk); verify with: npm run auth:verify.`,
    );
  }

  // ── Pipeline state ──────────────────────────────────────────────────────
  const reportsDir = resolveReportsDir(repoRoot);
  const stateFile = readState(repoRoot, reportsDir);
  if (!stateFile) {
    return {
      status: 'no_state',
      message:
        (authWarnings.length > 0 ? `${authWarnings.join(' ')} ` : '') +
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

  const currentPhase = typeof s.currentPhase === 'string' ? s.currentPhase : null;
  const rawWorkflow = s.workflow;
  const workflow =
    typeof rawWorkflow === 'object' &&
    rawWorkflow !== null &&
    typeof (rawWorkflow as Record<string, unknown>).schemaVersion === 'string'
      ? {
          schemaVersion: (rawWorkflow as Record<string, unknown>).schemaVersion as string,
          mode:
            (rawWorkflow as Record<string, unknown>).mode === 'semantic-v1'
              ? ('semantic-v1' as const)
              : ('physical-compat' as const),
          currentStage:
            typeof (rawWorkflow as Record<string, unknown>).currentStage === 'string'
              ? ((rawWorkflow as Record<string, unknown>).currentStage as McpWorkflowStage)
              : null,
          currentSubstage:
            typeof (rawWorkflow as Record<string, unknown>).currentSubstage === 'string'
              ? ((rawWorkflow as Record<string, unknown>).currentSubstage as
                  | 'execute'
                  | 'heal'
                  | 'report-analyze'
                  | 'qa-review')
              : undefined,
          stageStatus: extractStageStatuses(rawWorkflow),
          exploreDecision: extractDecision(rawWorkflow, 'explore'),
          challengeDecision: extractDecision(rawWorkflow, 'challenge'),
          lastFeedback: extractLastFeedback(rawWorkflow),
        }
      : undefined;

  const state: PipelineStatusOutput['state'] = {
    runId: typeof s.runId === 'string' ? s.runId : '',
    status: typeof s.status === 'string' ? s.status : 'unknown',
    currentPhase,
    completedPhases: Array.isArray(s.completedPhases)
      ? (s.completedPhases as string[]).filter((p) => PHASE_ORDER.includes(p))
      : [],
    orchestrationMode: typeof s.orchestrationMode === 'string' ? s.orchestrationMode : 'manual',
    requirementPath,
    lastUpdated: typeof s.timestamp === 'string' ? s.timestamp : '',
    requirementUpToDate,
    missingArtifacts: checkArtifacts(repoRoot, s),
    workflowStage: workflow?.currentStage ?? deriveWorkflowStage(currentPhase),
    ...(workflow ? { workflow } : {}),
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
  const nextSteps: string[] = [...authWarnings];

  // While a pipeline is actively running, make sure pre-run notes (Generator/
  // Plan phase) are bound to the run identity the reporter will adopt.
  let pipelineRunId: string | null = null;
  if (state.status === 'running') {
    try {
      pipelineRunId = ensurePendingRun().runId;
    } catch {
      // Non-blocking — note writers fall back to latest-run attribution
    }
  }
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
    // Native semantic runs resume by stage, not by physical phase.
    if (workflow) {
      const blockedStage = WORKFLOW_STAGE_NAMES.find(
        (name) =>
          workflow.stageStatus[name] === 'blocked' || workflow.stageStatus[name] === 'failed',
      );
      if (blockedStage) {
        nextSteps.push(
          `Workflow stage '${blockedStage}' is ${workflow.stageStatus[blockedStage]} — fix the blocker, then resume the semantic run.`,
        );
      } else {
        const nextStage = WORKFLOW_STAGE_NAMES.find(
          (name) =>
            workflow.stageStatus[name] === 'idle' || workflow.stageStatus[name] === 'required',
        );
        nextSteps.push(
          nextStage
            ? `Next workflow stage: ${nextStage}.`
            : 'All workflow stages complete — record the QA decision (archive_report).',
        );
      }
    } else {
      const remaining = PHASE_ORDER.filter((p) => !state.completedPhases.includes(p));
      nextSteps.push(`Resume from phase: ${remaining[0] ?? 'report'}.`);
    }
  } else if (state.status === 'blocked') {
    // PC-06: a blocked run has no active process and waits for a fix or
    // decision — surface the next required action instead of a phantom run.
    nextSteps.push(
      'Last run is blocked — fix the blocker (Plan/Generate/Validate input), then resume with the same runId.',
    );
  } else if (state.status === 'failed') {
    nextSteps.push('Last run failed — inspect unresolved failures before restarting.');
  } else if (lastRun && lastRun.failed === 0) {
    nextSteps.push(
      'All tests passed — review dashboard and record qaDecision (archive via archive_report).',
    );
  }

  const stageLabel = workflow?.currentStage
    ? `stage: ${workflow.currentStage} (${workflow.stageStatus[workflow.currentStage] ?? 'unknown'})`
    : `phase: ${state.currentPhase ?? '-'}`;

  return {
    status: 'success',
    message:
      nextSteps.length > 0
        ? `Pipeline ${state.status} (${stageLabel}). ${nextSteps.join(' ')}`
        : `Pipeline ${state.status} (${stageLabel}).`,
    state,
    lastRun,
    environment,
    ...(pipelineRunId ? { pipelineRunId } : {}),
  };
}
