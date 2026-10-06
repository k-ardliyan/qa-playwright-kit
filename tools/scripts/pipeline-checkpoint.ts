/// <reference types="node" />
/**
 * Pipeline checkpoint — optional auto-commit of QA-zone outputs after each
 * successful pipeline stage (Plan/Model, Generate, Validate/Report, …).
 *
 * Why: the upgrade engine protects QA work from ITSELF, but requirement/plan/
 * spec files only become durable (git objects, push-able) once they are
 * COMMITTED. Real usage showed 20+ generated assets hanging in the index for
 * hours — one careless `git reset --hard` or a disk failure away from loss.
 * When QA opts in (`--auto-commit` or `QA_PIPELINE_AUTO_COMMIT=1`), the driver
 * commits each stage's outputs right after the stage completes, so the worst
 * case is "lose the current stage", never "lose everything".
 *
 * Scope discipline (this is what makes it safe):
 *   - ONLY files under `requirements/`, `specs/`, `tests/` (minus `tests/demo/`
 *     — upstream zone) are ever staged. Protected framework zones and
 *     `.upgrade-*` state are structurally out of reach.
 *   - No-op when nothing in scope changed (idempotent; safe to fire blindly).
 *   - Commit is plain (no --no-verify); if the pre-commit hook fails, the
 *     files stay staged and the caller reports honestly — same contract as
 *     the upgrade engine's `--commit`.
 *
 * @module scripts/pipeline-checkpoint
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { printWarn } from './format-error';

/** Env switch for the pipeline driver (opt-in; default OFF). */
export const PIPELINE_AUTO_COMMIT_ENV = 'QA_PIPELINE_AUTO_COMMIT';

/** Directory prefixes whose files a checkpoint may commit — QA zone only. */
export const CHECKPOINT_SCOPE_PREFIXES = ['requirements/', 'specs/', 'tests/'];

/** Upstream-owned paths inside `tests/` that a checkpoint must never commit. */
export const CHECKPOINT_EXCLUDED_PREFIXES = ['tests/demo/'];

export interface CheckpointInput {
  /** Semantic stage that just completed: explore|model|challenge|generate|validate. */
  stage: string;
  /** Pipeline run identity (goes into the Pipeline-Run trailer). */
  runId: string;
  /** Requirement path for the human-readable subject line. */
  requirementPath?: string;
}

export interface CheckpointResult {
  /** true when a commit was created. */
  committed: boolean;
  /** Commit SHA when committed; null when skipped or the commit failed. */
  sha: string | null;
  /** Files the checkpoint staged (empty when nothing was in scope). */
  files: string[];
  /** true when pre-commit hooks rejected the commit (files stay staged). */
  hookFailed: boolean;
}

/** Opt-in decision: explicit flag wins, then the env switch. Default OFF. */
export function shouldAutoCommit(
  env: NodeJS.ProcessEnv = process.env,
  flags?: { autoCommit?: boolean },
): boolean {
  if (flags?.autoCommit === true) return true;
  return env[PIPELINE_AUTO_COMMIT_ENV] === '1';
}

function git(repoRoot: string, args: string[]): { status: number; stdout: string; stderr: string } {
  const res = spawnSync('git', args, { cwd: repoRoot, encoding: 'utf-8', timeout: 300_000 });
  return { status: res.status ?? 1, stdout: res.stdout ?? '', stderr: res.stderr ?? '' };
}

function inCheckpointScope(file: string): boolean {
  const normalized = file.replace(/\\/g, '/');
  if (!CHECKPOINT_SCOPE_PREFIXES.some((p) => normalized === p || normalized.startsWith(p))) {
    return false;
  }
  return !CHECKPOINT_EXCLUDED_PREFIXES.some((p) => normalized.startsWith(p));
}

/**
 * Collect the checkpoint candidates from `git status --porcelain`.
 *
 * Porcelain COLLAPSES untracked directories into one entry (`?? tests/`) —
 * adding such an entry wholesale would sweep excluded paths (e.g. tests/demo/)
 * into the commit. Untracked directory entries are therefore expanded per-file
 * via `git ls-files -o --exclude-standard` (gitignore-respecting), then every
 * candidate is scope-filtered individually.
 */
function collectScopedFiles(repoRoot: string): string[] {
  const status = git(repoRoot, ['status', '--porcelain']);
  const entries = status.stdout
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0);
  const files = new Set<string>();
  for (const line of entries) {
    const rest = line.slice(3);
    const arrow = rest.indexOf(' -> ');
    const file = (arrow >= 0 ? rest.slice(arrow + 4) : rest).replace(/\\/g, '/');
    if (line.startsWith('??') && file.endsWith('/')) {
      const ls = git(repoRoot, ['ls-files', '-o', '--exclude-standard', '-z', '--', file]);
      for (const f of ls.stdout.split('\0')) {
        if (f.length === 0) continue;
        const normalized = f.replace(/\\/g, '/');
        if (inCheckpointScope(normalized)) files.add(normalized);
      }
      continue;
    }
    if (inCheckpointScope(file)) files.add(file);
  }
  return [...files];
}

/**
 * Commit the QA-zone files changed by the stage that just completed.
 * Idempotent: returns `committed: false` when nothing in scope changed.
 */
export function commitPipelineCheckpoint(
  repoRoot: string,
  input: CheckpointInput,
): CheckpointResult {
  const files = collectScopedFiles(repoRoot);

  if (files.length === 0) {
    return { committed: false, sha: null, files: [], hookFailed: false };
  }

  const add = git(repoRoot, ['add', '--', ...files]);
  if (add.status !== 0) {
    printWarn(`Checkpoint: gagal men-stage file (${add.stderr.trim()}) — dibiarkan apa adanya.`);
    return { committed: false, sha: null, files, hookFailed: false };
  }

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-checkpoint-'));
  try {
    const msgPath = path.join(dir, 'COMMIT_MSG');
    const shortId = input.runId.slice(0, 8);
    const subject = `chore(pipeline): ${input.stage} checkpoint — ${input.requirementPath ?? 'pipeline'} (run ${shortId})`;
    fs.writeFileSync(
      msgPath,
      [
        subject,
        '',
        `Auto-commit checkpoint (opt-in) after the '${input.stage}' stage completed.`,
        `Files: ${files.length}. Full run identity in the Pipeline-Run trailer.`,
        '',
      ].join('\n'),
      'utf-8',
    );
    const res = git(repoRoot, [
      'commit',
      '-F',
      msgPath,
      '--trailer',
      `Pipeline-Run: ${input.runId}`,
    ]);
    if (res.status !== 0) {
      // Fail honestly: files stay staged, nothing is lost, caller reports.
      printWarn(
        `Checkpoint commit ditolak (pre-commit hook?). File tetap STAGED — commit manual bila layak.`,
      );
      return { committed: false, sha: null, files, hookFailed: true };
    }
    const sha = git(repoRoot, ['rev-parse', 'HEAD']);
    return {
      committed: true,
      sha: sha.status === 0 ? sha.stdout.trim() : null,
      files,
      hookFailed: false,
    };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
