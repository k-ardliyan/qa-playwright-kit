#!/usr/bin/env node
/**
 * skills-mirror-check.ts — byte parity gate for the local skills mirror.
 *
 * `skills/qa-playwright-kit/` is mirrored to `.agents/skills/qa-playwright-kit/`
 * by `npm run setup` / `setup:check` (src/setup/agent-sync.ts). The mirror is
 * gitignored, so it can silently drift from the canonical pack when skills are
 * edited without re-running setup:check — an agent loading through `.agents/`
 * then reads outdated contracts. This gate fails when ANY file differs or is
 * missing on either side, and points at the fix (setup:check), not a manual
 * copy.
 *
 * Check-only. Exit 0 when identical (or when the mirror does not exist yet —
 * a fresh checkout is legitimate), exit 1 on drift.
 * Run: npm run check:skills-mirror
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = process.cwd();
/**
 * Which skill pack to check. Tests pass `--pack <name>` on the command line;
 * because Windows `shell: true` spawns can re-flow argv through npx, the env
 * var SKILLS_MIRROR_PACK is accepted as an equivalent override.
 */
const PACK_FLAG = process.argv.indexOf('--pack');
const PACK =
  (PACK_FLAG > 0 && PACK_FLAG + 1 < process.argv.length
    ? process.argv[PACK_FLAG + 1]
    : undefined) ||
  process.env.SKILLS_MIRROR_PACK ||
  'qa-playwright-kit';
const CANONICAL = path.join(ROOT, 'skills', PACK);
const MIRROR = path.join(ROOT, '.agents', 'skills', PACK);

interface DiffEntry {
  kind: 'missing-in-mirror' | 'missing-in-canonical' | 'content-drift';
  rel: string;
}

/** Relative POSIX paths of every file under dir. */
function listFiles(dir: string, prefix = ''): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...listFiles(path.join(dir, entry.name), rel));
    else if (entry.isFile()) out.push(rel);
  }
  return out.sort();
}

function diffMirror(): DiffEntry[] {
  const canonicalFiles = listFiles(CANONICAL);
  const mirrorFiles = listFiles(MIRROR);
  const mirrorSet = new Set(mirrorFiles);
  const canonicalSet = new Set(canonicalFiles);
  const diffs: DiffEntry[] = [];

  for (const rel of canonicalFiles) {
    if (!mirrorSet.has(rel)) {
      diffs.push({ kind: 'missing-in-mirror', rel });
      continue;
    }
    const a = fs.readFileSync(path.join(CANONICAL, rel));
    const b = fs.readFileSync(path.join(MIRROR, rel));
    if (!a.equals(b)) diffs.push({ kind: 'content-drift', rel });
  }
  for (const rel of mirrorFiles) {
    if (!canonicalSet.has(rel)) diffs.push({ kind: 'missing-in-canonical', rel });
  }
  return diffs;
}

function main(): void {
  if (!fs.existsSync(CANONICAL)) {
    console.error(`✗ canonical skill pack missing: ${path.relative(ROOT, CANONICAL)}`);
    process.exit(1);
  }
  if (!fs.existsSync(MIRROR)) {
    // Fresh checkout / never ran setup — not drift, nothing to compare yet.
    console.log(
      `✓ skills mirror not present yet (${path.relative(ROOT, MIRROR)}) — nothing to compare. Run npm run setup:check to create it.`,
    );
    process.exit(0);
  }

  const diffs = diffMirror();
  if (diffs.length === 0) {
    console.log('✓ skills mirror in sync with skills/qa-playwright-kit');
    process.exit(0);
  }

  console.error(`✗ skills mirror DRIFTED (${diffs.length} file(s)):\n`);
  for (const d of diffs) {
    console.error(`  • [${d.kind}] ${d.rel}`);
  }
  console.error(
    '\nFix: run `npm run setup:check` (it re-mirrors skills/ → .agents/skills/), then re-run this gate.',
  );
  process.exit(1);
}

const invokedAsCli = path
  .basename(process.argv[1] ?? '')
  .replace(/\\/g, '/')
  .startsWith('skills-mirror-check');
if (invokedAsCli) main();

export { diffMirror, listFiles };
