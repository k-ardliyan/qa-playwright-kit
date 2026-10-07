import * as fs from 'node:fs';
import * as path from 'node:path';
import { createToolError, getRepoRoot, resolveAllowedPath } from '../utils/safety';
import { computeSourceHash } from '../contracts';
import { compileRequirementFromText } from './compile-requirement';
import type { Diagnostic } from '../contracts';

export interface UpdateRequirementArgs {
  /** Repo-relative requirement path (requirements/<name>.md). Must exist. */
  requirementPath?: string;
  /** The FULL new requirement markdown — a whole-file replacement, not a patch. */
  content?: string;
  /**
   * Optimistic lock: the sourceHash the caller read BEFORE editing. When given
   * and it no longer matches the file on disk, the update is rejected — the
   * file changed underneath the agent (lost-update guard).
   */
  previousHash?: string;
  /** Why the requirement is being revised (echoed in the message). */
  reason?: string;
}

export interface UpdateRequirementOutput {
  status: 'success' | 'error';
  requirementPath?: string;
  /** Hash of the content BEFORE the update (what the plan was pinned to). */
  previousHash?: string;
  /** Hash of the NEW content — downstream plans must re-pin to this. */
  newHash?: string;
  backupPath?: string;
  /** compile_requirement diagnostics for the NEW content — visible immediately. */
  diagnostics?: Diagnostic[];
  message: string;
  error?: { code: string; message: string };
}

/**
 * MCP tool `update_requirement` — the sanctioned REVISE REQUIREMENT path.
 *
 * synthesize_requirement refuses to overwrite (it creates new files), so the
 * post-report revision loop was previously a free-hand agent edit with no
 * backup, no provenance, and no re-validation. This tool replaces the loop:
 * whole-file write with an optimistic hash lock, a `.bak` backup, an eager
 * re-compile (diagnostics surface NOW, not at the next pipeline stage), and
 * hash provenance so the agent knows downstream plans must re-pin.
 */
export function updateRequirement(
  args: UpdateRequirementArgs | Record<string, unknown> | undefined,
): UpdateRequirementOutput {
  const raw = (args ?? {}) as Record<string, unknown>;
  const requirementPath = typeof raw.requirementPath === 'string' ? raw.requirementPath : '';
  const content = typeof raw.content === 'string' ? raw.content : '';
  const previousHash = typeof raw.previousHash === 'string' ? raw.previousHash : undefined;
  const reason = typeof raw.reason === 'string' ? raw.reason.trim() : '';

  if (!requirementPath.trim()) {
    const err = createToolError(
      'INVALID_INPUT',
      'Provide `requirementPath` (requirements/<feature>.md).',
    );
    return { status: 'error', message: err.error.message, error: err.error };
  }
  if (!content.trim()) {
    const err = createToolError(
      'INVALID_INPUT',
      'Provide `content` — the FULL new requirement markdown (whole-file replacement, not a patch).',
    );
    return { status: 'error', message: err.error.message, error: err.error };
  }

  const resolved = resolveAllowedPath(requirementPath, 'requirements', { mustExist: true });
  if (!resolved.ok) {
    return {
      status: 'error',
      message: resolved.error.message,
      error: resolved.error,
    };
  }
  const targetAbs = resolved.absolutePath;
  const relativePath = path.relative(getRepoRoot(), targetAbs).replace(/\\/g, '/');

  const currentRaw = fs.readFileSync(targetAbs, 'utf-8');
  const currentHash = computeSourceHash(currentRaw);
  if (previousHash !== undefined && previousHash !== currentHash) {
    const err = createToolError(
      'INVALID_INPUT',
      `Lost-update guard: expected previousHash "${previousHash.slice(0, 12)}" but the file currently hashes to "${currentHash.slice(0, 12)}" — it changed after you read it. Re-read the file (compile_requirement), re-apply your revision on the fresh content, and retry.`,
    );
    return {
      status: 'error',
      requirementPath: relativePath,
      previousHash: currentHash,
      message: err.error.message,
      error: err.error,
    };
  }

  // Backup idiom from generate_page_object: keep the previous version next to
  // the file so a bad revision is one copy away from restored.
  const bakPath = `${targetAbs}.bak`;
  fs.copyFileSync(targetAbs, bakPath);
  fs.writeFileSync(targetAbs, content, 'utf-8');

  const newHash = computeSourceHash(content);
  const compiled = compileRequirementFromText(content, relativePath);
  const diagnostics = (compiled.diagnostics ?? []) as Diagnostic[];
  const errorCount = diagnostics.filter((d) => d.severity === 'error').length;

  const reasonSuffix = reason ? ` Reason: ${reason}.` : '';
  const message =
    `Requirement updated: ${relativePath}. Previous hash ${currentHash.slice(0, 12)} → new hash ${newHash.slice(0, 12)}; ` +
    `recompile the plan against the new hash (PLAN_STALE_REQUIREMENT guards it).` +
    ` Compile check: ${errorCount === 0 ? 'clean' : `${errorCount} error(s) — fix before running the pipeline`}.${reasonSuffix}`;

  return {
    status: 'success',
    requirementPath: relativePath,
    previousHash: currentHash,
    newHash,
    backupPath: path.relative(getRepoRoot(), bakPath).replace(/\\/g, '/'),
    diagnostics,
    message,
  };
}
