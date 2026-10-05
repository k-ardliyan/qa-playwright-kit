/// <reference types="node" />
/**
 * Upgrade state — the recorded upstream base.
 *
 * `npm run upgrade` diffs the framework zone between the last synced upstream
 * commit and the new one, so it can tell "QA changed this" from "upstream
 * changed this" instead of guessing. Without a base it falls back to comparing
 * against HEAD (the pre-existing behavior).
 *
 * Deliberately GITIGNORED (per-machine), like `.wizard-state.json`: it records
 * where THIS machine last synced, not a project-wide fact. Lives at the repo
 * root, outside FRAMEWORK_PATHS, so it is never a dirty-guard target and is
 * never overwritten by an upgrade.
 *
 * @module scripts/upgrade-state
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

export const UPGRADE_STATE_FILE = '.upgrade-state.json';

export interface UpgradeState {
  schemaVersion: 1;
  /** Upstream source URL or path the base commit came from. */
  upstream: string;
  /** Branch/tag of the upstream source. */
  ref: string;
  /** Commit SHA of the last upstream sync — the three-way-merge base. */
  syncedCommit: string;
  /** ISO timestamp of when the sync happened. */
  syncedAt: string;
}

/**
 * Read the recorded base, or `null` when absent/unreadable/malformed.
 *
 * Tolerant on purpose: a corrupt state file must degrade to the no-base
 * fallback (compare against HEAD), never abort the upgrade.
 */
export function readUpgradeState(repoRoot: string): UpgradeState | null {
  const file = path.join(repoRoot, UPGRADE_STATE_FILE);
  if (!fs.existsSync(file)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8')) as Partial<UpgradeState>;
    if (
      parsed.schemaVersion !== 1 ||
      typeof parsed.syncedCommit !== 'string' ||
      parsed.syncedCommit.length === 0
    ) {
      return null;
    }
    return {
      schemaVersion: 1,
      upstream: typeof parsed.upstream === 'string' ? parsed.upstream : '',
      ref: typeof parsed.ref === 'string' ? parsed.ref : '',
      syncedCommit: parsed.syncedCommit,
      syncedAt: typeof parsed.syncedAt === 'string' ? parsed.syncedAt : '',
    };
  } catch {
    return null;
  }
}

/** Write the recorded base. Best-effort — a write failure never fails the upgrade. */
export function writeUpgradeState(repoRoot: string, state: UpgradeState): void {
  fs.writeFileSync(
    path.join(repoRoot, UPGRADE_STATE_FILE),
    `${JSON.stringify(state, null, 2)}\n`,
    'utf-8',
  );
}
