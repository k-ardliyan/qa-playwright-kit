/// <reference types="node" />
/**
 * Upgrade safety snapshot — a non-destructive checkpoint of dirty framework
 * files taken BEFORE the upgrade mutates anything.
 *
 * Why not `git stash`? `git stash push` REWRITES the worktree (drops local
 * changes and reverts files to HEAD); `git stash create` only captures tracked
 * content and leaves untracked files unprotected. The upgrade needs a
 * checkpoint that (a) includes untracked files, (b) never touches the worktree
 * or the real index, and (c) survives garbage collection.
 *
 * Mechanism (pure git plumbing, zero worktree/index writes):
 *   1. `GIT_INDEX_FILE=<temp> git read-tree HEAD`   — private throwaway index
 *   2. `GIT_INDEX_FILE=<temp> git add -- <files>`   — stage the DIRTY content
 *      (worktree version, including untracked and staged-but-uncommitted files)
 *   3. `GIT_INDEX_FILE=<temp> git write-tree`       — tree object of that state
 *   4. `git commit-tree <tree> -p HEAD -m ...`      — commit object (parent HEAD)
 *   5. `git update-ref refs/qa-kit/upgrade-snapshots/<ts>-<sha7> <commit>`
 *
 * Step 5 anchors the commit under a custom ref namespace, so `git gc` will
 * never prune it; the namespace is NOT a branch, so `git log`/status stay
 * untouched. Restore a file with:
 *   `git checkout <snapshot-commit> -- <path>`
 *
 * @module scripts/upgrade-snapshot
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';

export const SNAPSHOT_REF_PREFIX = 'refs/qa-kit/upgrade-snapshots';

/** How many historical snapshot refs to keep (older ones are pruned). */
export const SNAPSHOT_KEEP = 5;

export interface UpgradeSnapshot {
  /** Full ref name, e.g. refs/qa-kit/upgrade-snapshots/2026-10-06T01-02-03Z-abc1234 */
  ref: string;
  /** Commit SHA the ref points at (restore source). */
  commit: string;
}

interface GitResult {
  status: number;
  stdout: string;
  stderr: string;
}

function git(repoRoot: string, args: string[], env?: NodeJS.ProcessEnv): GitResult {
  const res = spawnSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf-8',
    timeout: 120_000,
    ...(env ? { env: { ...process.env, ...env } } : {}),
  });
  return { status: res.status ?? 1, stdout: res.stdout ?? '', stderr: res.stderr ?? '' };
}

/**
 * Snapshot the given files' CURRENT worktree content (tracked-modified,
 * staged, and untracked alike) into an immutable ref. Returns `null` when
 * there is nothing to snapshot, or when any plumbing step fails — a snapshot
 * is a safety net and must never itself fail the upgrade.
 */
export function createUpgradeSnapshot(repoRoot: string, files: string[]): UpgradeSnapshot | null {
  if (files.length === 0) return null;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-snapshot-'));
  const indexFile = path.join(tmp, 'index');
  try {
    if (git(repoRoot, ['read-tree', 'HEAD'], { GIT_INDEX_FILE: indexFile }).status !== 0) {
      return null;
    }
    for (const file of files) {
      if (git(repoRoot, ['add', '--', file], { GIT_INDEX_FILE: indexFile }).status !== 0) {
        return null;
      }
    }
    const tree = git(repoRoot, ['write-tree'], { GIT_INDEX_FILE: indexFile });
    if (tree.status !== 0) return null;
    const treeSha = tree.stdout.trim();

    const headTree = git(repoRoot, ['rev-parse', 'HEAD^{tree}']);
    if (headTree.status !== 0) return null;
    if (headTree.stdout.trim() === treeSha) return null; // nothing effectively dirty

    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const commitMsg = `qa-playwright-kit upgrade safety snapshot (${stamp})\n\nFiles: ${files
      .slice(0, 20)
      .join(', ')}${files.length > 20 ? ` … +${files.length - 20} more` : ''}`;
    const commit = git(repoRoot, ['commit-tree', treeSha, '-p', 'HEAD', '-m', commitMsg]);
    if (commit.status !== 0) return null;
    const commitSha = commit.stdout.trim();

    const ref = `${SNAPSHOT_REF_PREFIX}/${stamp}-${commitSha.slice(0, 7)}`;
    if (git(repoRoot, ['update-ref', ref, commitSha]).status !== 0) return null;

    pruneSnapshots(repoRoot);
    return { ref, commit: commitSha };
  } catch {
    return null;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/** List existing snapshot refs, newest first (ref names embed a UTC stamp). */
export function listSnapshotRefs(repoRoot: string): string[] {
  const res = git(repoRoot, ['for-each-ref', `${SNAPSHOT_REF_PREFIX}/`, '--format=%(refname)']);
  if (res.status !== 0) return [];
  return res.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .sort((a, b) => (a < b ? 1 : -1));
}

/** Delete snapshot refs beyond the newest {@link SNAPSHOT_KEEP}. */
function pruneSnapshots(repoRoot: string): void {
  for (const ref of listSnapshotRefs(repoRoot).slice(SNAPSHOT_KEEP)) {
    git(repoRoot, ['update-ref', '-d', ref]);
  }
}
