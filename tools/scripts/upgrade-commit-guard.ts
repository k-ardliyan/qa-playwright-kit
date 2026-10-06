/// <reference types="node" />
/**
 * Upgrade commit guard — mechanical enforcement that nothing commits while an
 * upgrade is running (Progent/GuardAgent principle: policies are enforced
 * deterministically at the tool boundary, not by prompting the agent).
 *
 * Two halves live here:
 *
 * 1. THE LOCK. `npm run upgrade` (apply mode) acquires
 *    `artifacts/.upgrade-lock.json` {pid, startedAt} for the whole run and
 *    releases it in a `finally`. A live lock means: mid-upgrade, results are
 *    staged/half-merged and committing would freeze a broken state.
 *
 * 2. THE HOOK CHECK. `.husky/pre-commit` calls this script first. Verdict:
 *    - no lock                      → allow
 *    - lock + env QA_KIT_UPGRADE_COMMIT=1 → allow (the upgrade tool's own
 *      `--commit` runs the pre-commit hook too — it must pass through)
 *    - lock + owning pid alive      → DENY (exit 1): "jangan commit, biarkan
 *      upgrade yang menyelesaikan pekerjaannya"
 *    - lock + owning pid dead       → stale; auto-clear and allow
 *
 * Fail-safe direction: an unexpected error in this script FAILS OPEN (allow,
 * warning on stderr) — the guard defends against accidental commits, not
 * adversarial ones, and must never brick a repo whose tools are mid-upgrade.
 * Only the explicit deny verdict exits 1.
 *
 * @module scripts/upgrade-commit-guard
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

export const UPGRADE_LOCK_FILE = path.join('artifacts', '.upgrade-lock.json');

/** Env marker that identifies the upgrade tool's own --commit child. */
export const UPGRADE_COMMIT_ENV = 'QA_KIT_UPGRADE_COMMIT';

export class UpgradeLockError extends Error {}

interface UpgradeLock {
  pid: number;
  startedAt: string;
}

function lockPath(repoRoot: string): string {
  return path.join(repoRoot, UPGRADE_LOCK_FILE);
}

/** Tolerant lock read: absent/corrupt → null, never throws. */
export function readUpgradeLock(repoRoot: string): UpgradeLock | null {
  const file = lockPath(repoRoot);
  if (!fs.existsSync(file)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8')) as Partial<UpgradeLock>;
    if (typeof parsed.pid !== 'number' || !Number.isInteger(parsed.pid)) return null;
    return {
      pid: parsed.pid,
      startedAt: typeof parsed.startedAt === 'string' ? parsed.startedAt : '',
    };
  } catch {
    return null;
  }
}

/** Best-effort liveness probe (works on Windows: EPERM = alive but foreign). */
export function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * Acquire the upgrade lock for THIS process. Throws {@link UpgradeLockError}
 * when another live upgrade holds it. A stale lock (dead pid) is overwritten.
 */
export function acquireUpgradeLock(repoRoot: string): void {
  const existing = readUpgradeLock(repoRoot);
  if (existing && isProcessAlive(existing.pid)) {
    throw new UpgradeLockError(
      `Upgrade lain sedang berjalan (pid ${existing.pid}, mulai ${existing.startedAt}). Tunggu sampai selesai.`,
    );
  }
  fs.mkdirSync(path.dirname(lockPath(repoRoot)), { recursive: true });
  fs.writeFileSync(
    lockPath(repoRoot),
    `${JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }, null, 2)}\n`,
    'utf-8',
  );
}

/** Release the upgrade lock. Best-effort — never throws. */
export function releaseUpgradeLock(repoRoot: string): void {
  try {
    fs.rmSync(lockPath(repoRoot), { force: true });
  } catch {
    // self-healing: a leaked lock with a dead pid is auto-cleared by the guard
  }
}

export type CommitVerdict = 'allow' | 'deny' | 'stale-cleared';

/**
 * Decide whether a commit may proceed right now. Pure decision logic — the
 * CLI wrapper turns 'deny' into exit code 1.
 */
export function checkCommitAllowed(
  repoRoot: string,
  env: NodeJS.ProcessEnv = process.env,
): CommitVerdict {
  const lock = readUpgradeLock(repoRoot);
  if (!lock) return 'allow';
  if (env[UPGRADE_COMMIT_ENV] === '1') return 'allow'; // the upgrade tool's own commit
  if (!isProcessAlive(lock.pid)) {
    // Stale lock from a crashed run — clear it and let the commit through.
    releaseUpgradeLock(repoRoot);
    return 'stale-cleared';
  }
  return 'deny';
}

// ─── CLI (called from .husky/pre-commit) ─────────────────────────────────────

if (require.main === module) {
  const repoRoot = process.cwd();
  let verdict: CommitVerdict;
  try {
    verdict = checkCommitAllowed(repoRoot);
  } catch (err) {
    // Fail OPEN: a broken guard must never brick commits. See the header.
    process.stderr.write(
      `⚠ upgrade-commit-guard error (commit diizinkan): ${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exit(0);
  }
  if (verdict === 'deny') {
    process.stderr.write(
      [
        '✖ Commit DITOLAK: `npm run upgrade` sedang berjalan.',
        '  Hasil upgrade sedang di-merge/staged — meng-commit sekarang akan membekukan keadaan setengah jadi.',
        '  Tunggu upgrade selesai, lalu ikuti nextAction dari JSON-nya (biasanya commit otomatis via --commit).',
      ].join('\n'),
    );
    process.exit(1);
  }
  process.exit(0);
}
