/// <reference types="node" />
/**
 * Upgrade base — the COMMITTED upstream sync pointer.
 *
 * `.upgrade-base.json` records the upstream commit this repo last synced with.
 * Unlike `.upgrade-state.json` (gitignored, per-machine cache) this file is
 * COMMITTED, so every clone and every machine starts with an accurate base —
 * the same pattern Copier (`.copier-answers.yml`) and cruft (`.cruft.json`)
 * use. Without it, a fresh clone falls back to HEAD as the merge base, which
 * works (universal three-way merge) but misreports "updated" for QA-touched
 * files upstream never changed.
 *
 * The file lives at the repo root, OUTSIDE FRAMEWORK_PATHS: upstream never
 * ships it, so an upgrade never treats it as a target — the upgrade itself
 * rewrites it and stages it so the follow-up commit carries the new base.
 *
 * @module scripts/upgrade-base
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

export const UPGRADE_BASE_FILE = '.upgrade-base.json';

export interface UpgradeBase {
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
 * Read the committed base, or `null` when absent/unreadable/malformed.
 *
 * Tolerant on purpose: a corrupt file must degrade to the next source in the
 * precedence chain (`.upgrade-state.json`, then HEAD-as-base), never abort.
 */
export function readUpgradeBase(repoRoot: string): UpgradeBase | null {
  const file = path.join(repoRoot, UPGRADE_BASE_FILE);
  if (!fs.existsSync(file)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8')) as Partial<UpgradeBase>;
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

/** Write the committed base. Best-effort — a write failure never fails the upgrade. */
export function writeUpgradeBase(repoRoot: string, base: UpgradeBase): void {
  fs.writeFileSync(
    path.join(repoRoot, UPGRADE_BASE_FILE),
    `${JSON.stringify(base, null, 2)}\n`,
    'utf-8',
  );
}
