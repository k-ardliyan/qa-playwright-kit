/**
 * MCP tool: `workflow_run`.
 *
 * Drives the native semantic workflow (Explore → Model → Challenge → Generate
 * → Validate) through the production driver `tools/scripts/workflow-run.ts`.
 * The driver is the single place that wires the real MCP tool functions into
 * the WorkflowController adapters — this tool is a thin shell over it.
 *
 * The tool returns the structured WorkflowResponse (workflowStage,
 * workflowStatus, nextRequiredAction) so the AI can act on a block instead of
 * guessing. It never fabricates evidence or gate results.
 */

import { spawnSync } from 'node:child_process';
import * as path from 'node:path';
import { getRepoRoot } from '../utils/safety';

export interface WorkflowRunArgs {
  requirementPath: string;
  stage?: 'explore' | 'model' | 'challenge' | 'generate' | 'validate';
  orchestrationMode?: 'manual' | 'automatic';
  evidence?: string[];
  /** Explicit run identity — pass back with resume=true to continue a run. */
  runId?: string;
  /** Continue the persisted run identified by runId. */
  resume?: boolean;
  /** Restrict the run to these roles (role-aware requirements). */
  roleFilter?: string[];
}

export interface WorkflowRunOutput {
  status: 'success' | 'error' | 'in-progress';
  runId: string;
  workflowStage: string | null;
  workflowStatus: string;
  nextRequiredAction?: string;
  phase: string;
  errors?: Array<{ code: string; message: string; retryable: boolean }>;
  result?: unknown;
  message?: string;
}

export function workflowRun(args: WorkflowRunArgs | undefined): WorkflowRunOutput {
  if (!args || typeof args !== 'object') {
    return {
      status: 'error',
      runId: '',
      workflowStage: null,
      workflowStatus: 'blocked',
      phase: 'all',
      errors: [
        {
          code: 'INVALID_INPUT',
          message: 'workflow_run requires a requirementPath argument.',
          retryable: false,
        },
      ],
    };
  }

  if (typeof args.requirementPath !== 'string' || args.requirementPath.length === 0) {
    return {
      status: 'error',
      runId: '',
      workflowStage: null,
      workflowStatus: 'blocked',
      phase: 'all',
      errors: [
        {
          code: 'INVALID_INPUT',
          message: 'workflow_run requires a non-empty requirementPath.',
          retryable: false,
        },
      ],
    };
  }

  // Task 7.2: validate paths at the MCP boundary before spawning anything.
  // Never pass unchecked user data into a child process.
  const repoRoot = getRepoRoot();
  const pathValidation = validateBoundaryPaths(args, repoRoot);
  if (!pathValidation.ok) {
    return {
      status: 'error',
      runId: '',
      workflowStage: null,
      workflowStatus: 'blocked',
      phase: 'all',
      errors: [
        {
          code: 'WORKFLOW_PATH_REJECTED',
          message: pathValidation.error,
          retryable: false,
        },
      ],
    };
  }

  const driver = path.join(repoRoot, 'tools', 'scripts', 'workflow-run.ts');

  const argv = ['tsx', driver, args.requirementPath];
  if (args.orchestrationMode === 'automatic') argv.push('--automatic');
  if (args.stage) argv.push('--stage', args.stage);
  if (args.runId) argv.push('--run-id', args.runId);
  if (args.resume) argv.push('--resume');
  for (const role of args.roleFilter ?? []) {
    if (typeof role === 'string' && role.length > 0) {
      argv.push('--role', role);
    }
  }
  for (const evidence of args.evidence ?? []) {
    if (typeof evidence === 'string' && evidence.length > 0) {
      argv.push('--evidence', evidence);
    }
  }

  // Task 7.1: no shell interpolation — spawn Node directly with the tsx CLI.
  // On Windows, npx.cmd cannot be spawned with shell:false (EINVAL), so route
  // through process.execPath + the local tsx entry + the driver script.
  const tsxCli = path.join(repoRoot, 'node_modules', 'tsx', 'dist', 'cli.cjs');
  const result = spawnSync(process.execPath, [tsxCli, driver, ...argv.slice(2)], {
    cwd: repoRoot,
    encoding: 'utf-8',
    shell: false,
    timeout: 600_000,
    windowsHide: true,
  });

  if (result.error) {
    return {
      status: 'error',
      runId: '',
      workflowStage: null,
      workflowStatus: 'failed',
      phase: 'all',
      errors: [
        {
          code: 'WORKFLOW_DRIVER_SPAWN_FAILED',
          message: `Failed to spawn workflow driver: ${result.error.message}`,
          retryable: true,
        },
      ],
    };
  }

  const stdout = (result.stdout ?? '').trim();
  const stderr = (result.stderr ?? '').trim();

  // Task 7.3: NEVER regex-extract JSON from stdout. The driver writes logs to
  // stderr and a SINGLE JSON response as the last stdout line (NDJSON contract:
  // one known record type per line). Parse only the final line as JSON.
  const lines = stdout.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const lastLine = lines[lines.length - 1];
  if (lastLine) {
    try {
      const parsed = JSON.parse(lastLine) as WorkflowRunOutput;
      return {
        ...parsed,
        ...(stderr ? { message: stderr.slice(0, 500) } : {}),
      };
    } catch {
      // fall through to the raw-output error below
    }
  }

  return {
    status: 'error',
    runId: '',
    workflowStage: null,
    workflowStatus: 'failed',
    phase: 'all',
    errors: [
      {
        code: 'WORKFLOW_DRIVER_OUTPUT_INVALID',
        message: `Workflow driver produced no parseable response. stderr: ${stderr.slice(0, 500)}`,
        retryable: true,
      },
    ],
  };
}

/**
 * Validate every user-supplied path before it reaches the driver.
 * Requirement must live under requirements/; evidence under
 * artifacts/selector-catalog/. Rejects traversal, absolute paths, and
 * unexpected file types. runId is restricted to a safe charset.
 */
export function validateBoundaryPaths(
  args: WorkflowRunArgs,
  repoRoot: string,
): { ok: true } | { ok: false; error: string } {
  const req = args.requirementPath.replace(/\\/g, '/');
  if (path.isAbsolute(req)) {
    return { ok: false, error: 'requirementPath must be repo-relative (absolute paths rejected).' };
  }
  if (!req.startsWith('requirements/')) {
    return { ok: false, error: "requirementPath must be under 'requirements/'." };
  }
  if (req.includes('..')) {
    return { ok: false, error: 'requirementPath must not contain parent traversal (..).' };
  }
  if (!req.endsWith('.md')) {
    return { ok: false, error: 'requirementPath must end with .md.' };
  }

  for (const evidence of args.evidence ?? []) {
    if (typeof evidence !== 'string' || evidence.length === 0) continue;
    const ev = evidence.replace(/\\/g, '/');
    if (path.isAbsolute(ev)) {
      return { ok: false, error: 'evidence paths must be repo-relative (absolute rejected).' };
    }
    if (!ev.startsWith('artifacts/selector-catalog/')) {
      return {
        ok: false,
        error: "evidence paths must be under 'artifacts/selector-catalog/'.",
      };
    }
    if (ev.includes('..')) {
      return { ok: false, error: 'evidence paths must not contain parent traversal (..).' };
    }
  }

  if (args.runId !== undefined && !/^[A-Za-z0-9._-]+$/.test(args.runId)) {
    return { ok: false, error: 'runId contains unsupported characters.' };
  }

  return { ok: true };
}
