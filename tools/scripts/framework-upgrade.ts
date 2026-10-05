/// <reference types="node" />
/**
 * framework-upgrade — Pull the framework zone from upstream into this repo.
 *
 * QA-facing command (`npm run upgrade`): no git knowledge required, no stash,
 * no merge. Only framework-owned files are overwritten, per-file, and the
 * result lands STAGED so it can be reviewed or rolled back with one command.
 *
 * Safety is structural, not ceremonial:
 *   - gitignored files (config/environments/*.env, .auth/**, artifacts/**,
 *     requirements/login.md) never appear in a git diff → cannot be touched.
 *   - QA-tracked files (specs, POMs, plans) do not exist upstream → never a target.
 *   - Dirty guard runs BEFORE any write: `git checkout <tree> -- f` silently
 *     discards local modifications and silently overwrites untracked files
 *     (both verified by probe), so a dirty worktree aborts the run.
 *
 * Three-way merge (when a base is recorded in `.upgrade-state.json`):
 *   - QA edits are merged, not clobbered (`git merge-file`); real conflicts are
 *     left with markers and NOT staged. Binary files (image/PDF) are never
 *     line-merged — `git merge-file` prints nothing for them, so writing its
 *     output would truncate the file; they surface as a `binary` conflict and
 *     stay byte-intact.
 *   - `git rerere` does NOT apply here: it is triggered by `git merge`/`rebase`,
 *     while this uses the plumbing `git merge-file` directly, so nothing is
 *     auto-recorded. Repeated conflicts are instead resolved once and kept by
 *     committing; `git rerere` only helps if a workflow uses real merges.
 *
 * Usage:
 *   npm run upgrade              # apply framework-zone changes from upstream
 *   npm run upgrade:check        # preview only — touches nothing
 *   npm run upgrade --json       # one JSON line on stdout (agent contract)
 *
 * @module scripts/framework-upgrade
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync, type StdioOptions } from 'node:child_process';
import { parseArgs } from 'node:util';
import { EXIT, type ExitCode } from './exit-codes';
import { printOk, printWarn, printInfo, printStep, setHumanSink, humanWrite } from './format-error';
import { npmCommand } from '../../src/setup/spawn-bin';
import { syncAgentSkillsAndMcp } from '../../src/setup/agent-sync';
import { readUpgradeState, writeUpgradeState, type UpgradeState } from './upgrade-state';

/** Default upstream. Override with --source <url|path> (private repo / local clone). */
export const DEFAULT_SOURCE = 'https://github.com/k-ardliyan/qa-playwright-kit.git';

/** Default branch to pull from. */
export const DEFAULT_REF = 'main';

/** File generated per-QA; only replaced when it carries no customization marker. */
export const PRESERVE_MARKER = 'CUSTOM_AUTH_FLOW';
export const PRESERVE_MARKER_LEGACY = 'KUSTOM_LOGIN_FLOW';
export const GENERATED_AUTH_SETUP = 'src/support/auth.setup.ts';

/**
 * Framework-owned paths — the only files `upgrade` may overwrite.
 * Anything not listed here (QA specs, POMs, plans, requirements, data they
 * added) is never a target, even when upstream changes it.
 */
export const FRAMEWORK_PATHS: string[] = [
  'src',
  'tools',
  'config',
  'docs',
  'skills',
  '.github',
  '.husky',
  '.vscode',
  'specs/_TEMPLATE.md',
  'requirements/_TEMPLATE.md',
  'requirements/auth',
  'tests/demo',
  'tests/data',
  'tests/fixtures',
  'tests/README.md',
  'tests/seed.spec.ts',
  'tests/pages/BasePage.ts',
  GENERATED_AUTH_SETUP,
  // Root files
  'AGENTS.md',
  'README.md',
  'CHANGELOG.md',
  'CONTRIBUTING.md',
  '.gitignore',
  '.gitattributes',
  '.mcp.json',
  'biome.json',
  'tsconfig.json',
  'eslint.playwright.config.mjs',
  'playwright.config.ts',
  'package.json',
  'package-lock.json',
  '.nvmrc',
  '.claudeignore',
];

/** Thrown for every condition QA must fix themselves (mapped to EXIT.FIXABLE). */
export class UpgradeError extends Error {}

export interface ZoneDiff {
  /** Modified / added / renamed paths inside the framework zone (dest of rename). */
  updated: string[];
  /** Paths the upstream tree no longer has. Reported, never deleted automatically. */
  deleted: string[];
  /** Paths the diff touched that are NOT framework-owned (never applied). */
  outside: string[];
}

export interface PorcelainEntry {
  status: string;
  file: string;
}

// ─── Pure helpers (unit-testable without git) ────────────────────────────────

/** `git status --porcelain` → parsed entries. Handles rename `R  old -> new`. */
export function parsePorcelain(output: string): PorcelainEntry[] {
  return output
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0)
    .map((line) => {
      const status = line.slice(0, 2);
      const rest = line.slice(3);
      const arrow = rest.indexOf(' -> ');
      return { status, file: arrow >= 0 ? rest.slice(arrow + 4) : rest };
    });
}

/** True when `file` is inside one of the framework paths (exact match or prefix). */
export function inFrameworkZone(file: string, paths: string[] = FRAMEWORK_PATHS): boolean {
  const normalized = file.replace(/\\/g, '/');
  return paths.some((p) => normalized === p || normalized.startsWith(`${p}/`));
}

/** `git diff --name-status` → framework-zone diff. Unlisted paths go to `outside`. */
export function computeZoneDiff(output: string, paths: string[] = FRAMEWORK_PATHS): ZoneDiff {
  const diff: ZoneDiff = { updated: [], deleted: [], outside: [] };
  for (const rawLine of output.split('\n')) {
    const line = rawLine.trim();
    if (line.length === 0) continue;
    const parts = line.split('\t');
    const code = parts[0]?.charAt(0) ?? '';
    let target = parts[1] ?? '';
    if (code === 'R' || code === 'C') target = parts[2] ?? target;
    if (target.length === 0) continue;

    if (!inFrameworkZone(target, paths)) {
      diff.outside.push(target);
    } else if (code === 'D') {
      diff.deleted.push(target);
    } else {
      diff.updated.push(target);
    }
  }
  return diff;
}

/**
 * True when `content` carries the QA customization marker as its own LINE.
 *
 * Line-anchored on purpose: a docstring MENTION of the marker (the generated
 * file's own header teaches it) must not mark the file. A substring test made
 * every generated file look customized — it was born marked.
 */
const MARKER_LINE_RE = new RegExp(`^\\s*// (${PRESERVE_MARKER}|${PRESERVE_MARKER_LEGACY})\\b`, 'm');

export function hasCustomizationMarker(content: string): boolean {
  return MARKER_LINE_RE.test(content);
}

/**
 * Decide whether a generated file must be preserved instead of overwritten.
 * Only `src/support/auth.setup.ts` is conditional; every other path is plain.
 */
export function shouldPreserveGeneratedFile(relPath: string, content: string): boolean {
  if (relPath.replace(/\\/g, '/') !== GENERATED_AUTH_SETUP) return false;
  return hasCustomizationMarker(content);
}

/**
 * Dirty guard. Only files INSIDE the framework zone can be silently
 * overwritten by `git checkout FETCH_HEAD -- <file>`, so only those abort.
 * QA's own work-in-progress (specs, POMs, plans — all outside the zone) never
 * blocks an upgrade and can never be lost: it is never a target.
 *
 * A marker-bearing `src/support/auth.setup.ts` is waived: `applyZoneDiff`
 * preserves that file (shouldPreserveGeneratedFile), so blocking on it is pure
 * friction — the normal flow is "QA edits the generated login flow locally,
 * upgrade must not touch it". `markerAwareBaseDir` lets the guard read the
 * file's content; without it (or when the file is missing) the guard stays
 * conservative and blocks.
 *
 * `git checkout <tree> -- f` silently discards local modifications AND
 * silently overwrites untracked files at the same path (both verified by probe).
 */
export function assertCleanWorktree(
  entries: PorcelainEntry[],
  targets: string[],
  markerAwareBaseDir?: string,
): void {
  const zoneDirty = entries.filter((e) => inFrameworkZone(e.file, targets));
  if (zoneDirty.length === 0) return;

  const isMarkerPreserved = (e: PorcelainEntry): boolean => {
    if (!markerAwareBaseDir) return false;
    const abs = path.join(markerAwareBaseDir, e.file);
    if (!fs.existsSync(abs)) return false;
    try {
      return shouldPreserveGeneratedFile(e.file, fs.readFileSync(abs, 'utf-8'));
    } catch {
      return false;
    }
  };

  const blocked = zoneDirty.filter((e) => !isMarkerPreserved(e));
  const waived = zoneDirty.filter((e) => isMarkerPreserved(e));
  if (blocked.length === 0) return;

  const tracked = blocked.filter((e) => !e.status.includes('?'));
  const untracked = blocked.filter((e) => e.status.includes('?'));

  const lines: string[] = [];
  if (tracked.length > 0) {
    lines.push(`Perubahan belum di-commit pada file framework (${tracked.length}):`);
    lines.push(...tracked.slice(0, 10).map((e) => `  ${e.status.trim()} ${e.file}`));
    if (tracked.length > 10) lines.push(`  … dan ${tracked.length - 10} lainnya`);
  }
  if (untracked.length > 0) {
    lines.push(`File lokal belum di-track di path yang akan di-update (${untracked.length}):`);
    lines.push(...untracked.slice(0, 10).map((e) => `  ${e.file}`));
    if (untracked.length > 10) lines.push(`  … dan ${untracked.length - 10} lainnya`);
  }
  if (waived.length > 0) {
    lines.push(
      `Dilewati (punya // ${PRESERVE_MARKER}, upgrade tidak menimpanya): ${waived
        .map((e) => e.file)
        .join(', ')}`,
    );
  }
  lines.push('Commit atau kembalikan dulu perubahan itu, lalu jalankan ulang: npm run upgrade');
  lines.push(
    `Kustomisasi permanen pada ${GENERATED_AUTH_SETUP}? Tambahkan // ${PRESERVE_MARKER} di baris atas file itu — upgrade melewatinya otomatis.`,
  );
  throw new UpgradeError(lines.join('\n'));
}

/** Blob SHA of a path at HEAD (empty when the path does not exist there). */
function headBlob(repoRoot: string, file: string): string {
  return git(repoRoot, ['rev-parse', `HEAD:${file}`]).stdout.trim();
}

/**
 * True when `blob` is a version that exists in the upstream history of `file`.
 * A repo that synced a previous upgrade carries upstream content in a local
 * commit — that content is NOT local work and is safe to overwrite.
 */
function isUpstreamVersion(repoRoot: string, file: string, blob: string): boolean {
  const shas = git(repoRoot, ['log', '--format=%H', '-n', '50', 'FETCH_HEAD', '--', file])
    .stdout.split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  return shas.some((sha) => git(repoRoot, ['rev-parse', `${sha}:${file}`]).stdout.trim() === blob);
}

export interface LocalFrameworkCommitCheck {
  /** Local commits (FETCH_HEAD..HEAD) touching files this upgrade would overwrite. */
  commits: string[];
  /** Of those files, the ones whose current content is NOT any upstream version. */
  riskyFiles: string[];
}

/**
 * Detect local work that `git checkout FETCH_HEAD -- <file>` would silently revert.
 *
 * Only files in the overwrite set matter: a locally customized file that
 * upstream did not touch is never a target, so it cannot be lost. And a local
 * commit that merely synced a previous upgrade carries upstream content, which
 * `isUpstreamVersion` recognizes — so repeated upgrades keep working.
 *
 * Marker-bearing `src/support/auth.setup.ts` is excluded: the apply step
 * preserves it, so it is never at risk.
 */
export function findRiskyLocalFrameworkCommits(
  repoRoot: string,
  overwriteFiles: string[],
): LocalFrameworkCommitCheck {
  if (overwriteFiles.length === 0) return { commits: [], riskyFiles: [] };

  const commits = git(repoRoot, [
    'log',
    '--format=%h %s',
    'FETCH_HEAD..HEAD',
    '--',
    ...overwriteFiles,
  ])
    .stdout.split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (commits.length === 0) return { commits: [], riskyFiles: [] };

  const changed = git(repoRoot, [
    'log',
    '--name-only',
    '--format=',
    'FETCH_HEAD..HEAD',
    '--',
    ...overwriteFiles,
  ])
    .stdout.split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const riskyFiles = [...new Set(changed)].filter((file) => {
    const normalized = file.replace(/\\/g, '/');
    const abs = path.join(repoRoot, file);
    if (
      normalized === GENERATED_AUTH_SETUP &&
      fs.existsSync(abs) &&
      shouldPreserveGeneratedFile(normalized, fs.readFileSync(abs, 'utf-8'))
    ) {
      return false; // apply skips it — no risk
    }
    const blob = headBlob(repoRoot, normalized);
    if (blob.length === 0) return true; // deleted locally, would be restored
    return !isUpstreamVersion(repoRoot, normalized, blob);
  });

  return { commits, riskyFiles };
}

/** First `## ` section title of a CHANGELOG (the newest release entry). */
export function firstChangelogSection(changelog: string): string | null {
  const match = changelog.match(/^##\s+.*$/m);
  return match ? match[0].trim() : null;
}

/** Read the `version` field out of a package.json text. */
export function packageVersion(json: string): string | null {
  try {
    const parsed = JSON.parse(json) as { version?: unknown };
    return typeof parsed.version === 'string' ? parsed.version : null;
  } catch {
    return null;
  }
}

// ─── Git / npm plumbing ──────────────────────────────────────────────────────

interface GitResult {
  status: number;
  stdout: string;
  stderr: string;
}

function git(repoRoot: string, args: string[]): GitResult {
  const res = spawnSync('git', args, { cwd: repoRoot, encoding: 'utf-8', timeout: 120_000 });
  return { status: res.status ?? 1, stdout: res.stdout ?? '', stderr: res.stderr ?? '' };
}

/** True when `sha` resolves to a commit in this repo (base is still usable). */
export function commitExists(repoRoot: string, sha: string): boolean {
  return git(repoRoot, ['cat-file', '-e', `${sha}^{commit}`]).status === 0;
}

/** Blob content of `file` at `rev` (null when the path does not exist there). */
function blobAt(repoRoot: string, rev: string, file: string): string | null {
  const res = git(repoRoot, ['show', `${rev}:${file}`]);
  return res.status === 0 ? res.stdout : null;
}

/**
 * Normalize line endings for content comparison and merging.
 *
 * Git stores LF, but a Windows worktree with `core.autocrlf` checks out CRLF —
 * so a byte compare would report EVERY file as "QA-modified" and make every
 * three-way merge conflict. Compare on LF only.
 */
function normalizeEol(text: string): string {
  return text.replace(/\r\n/g, '\n');
}

/**
 * The base commit to diff against: the recorded upstream sync when it still
 * resolves here, else HEAD (the pre-existing behavior — no base recorded).
 */
export function resolveBase(repoRoot: string, state: UpgradeState | null): string | null {
  if (state && commitExists(repoRoot, state.syncedCommit)) return state.syncedCommit;
  return null;
}

/**
 * Run an npm script and stream its output.
 *
 * Spawning `npm.cmd` is NOT portable: with `shell: false` Node >=18.20 refuses
 * `.cmd` (EINVAL, CVE-2024-27980 hardening) and with `shell: true` a host
 * without `cmd.exe` on PATH fails ENOENT — both leave `status === null` and the
 * step silently does nothing.
 *
 * The npm-CLI resolution lives HERE (not only in `src/setup/spawn-bin.ts`)
 * because this script runs against a repo whose framework files may still be
 * the OLD version — `npmSpawn` may not exist there yet. Self-contained = the
 * bootstrap upgrade works before the upgrade lands.
 */
export function resolveNpmCli(execPath: string = process.execPath): string | null {
  const candidates = [
    path.join(path.dirname(execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    path.join(path.dirname(execPath), '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
}

/**
 * When true, npm child output is routed to stderr so stdout stays reserved for
 * the single JSON line (see the NDJSON contract in main()).
 */
let jsonMode = false;

/** Enable `--json` output routing for the rest of the process. */
export function setJsonMode(on: boolean): void {
  jsonMode = on;
}

function runNpm(repoRoot: string, args: string[], timeoutMs = 600_000): boolean {
  printInfo(`Menjalankan: npm ${args.join(' ')} (mohon tunggu)...`);
  // In JSON mode the child's stdout must NOT pollute our stdout line, so route
  // it to stderr alongside its stderr.
  const stdio: StdioOptions = jsonMode ? ['inherit', process.stderr, 'inherit'] : 'inherit';
  const cli = resolveNpmCli();
  const res = cli
    ? spawnSync(process.execPath, [cli, ...args], {
        cwd: repoRoot,
        shell: false,
        stdio,
        timeout: timeoutMs,
      })
    : spawnSync(npmCommand(), args, {
        cwd: repoRoot,
        shell: process.platform === 'win32',
        stdio,
        timeout: timeoutMs,
      });

  if (res.error || res.status === null) {
    printWarn(
      `Gagal menjalankan npm ${args.join(' ')}: ${res.error?.message ?? 'proses tidak mengembalikan exit code'}`,
    );
    return false;
  }
  return res.status === 0;
}

// ─── Options & help ──────────────────────────────────────────────────────────

export interface UpgradeOptions {
  checkOnly: boolean;
  source: string;
  ref: string;
  /** Emit one JSON line on stdout (agent contract); human logs go to stderr. */
  json?: boolean;
}

export function parseUpgradeArgs(argv: string[]): UpgradeOptions | null {
  let parsed: ReturnType<typeof parseUpgradeCliArgs>;
  try {
    parsed = parseUpgradeCliArgs(argv);
  } catch (err) {
    throw new UpgradeError(err instanceof Error ? err.message : String(err));
  }

  if (parsed.values.help) return null;

  return {
    checkOnly: parsed.values.check ?? false,
    source: parsed.values.source ?? DEFAULT_SOURCE,
    ref: parsed.values.ref ?? DEFAULT_REF,
    json: parsed.values.json ?? false,
  };
}

function parseUpgradeCliArgs(argv: string[]) {
  return parseArgs({
    args: argv,
    options: {
      check: { type: 'boolean', default: false },
      source: { type: 'string' },
      ref: { type: 'string' },
      json: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
    strict: true,
    allowPositionals: false,
  });
}

export function printUpgradeHelp(): void {
  process.stdout.write(`qa-playwright-kit upgrade — update framework tanpa git stash / merge

Usage:
  npm run upgrade [options]

Options:
  --check              Preview saja: tampilkan versi + file yang berubah, tanpa menulis apa pun
  --json               Output satu baris JSON di stdout (untuk agent); log manusia ke stderr
  --source <url|path>  Sumber framework (default: ${DEFAULT_SOURCE})
  --ref <ref>          Branch/tag sumber (default: ${DEFAULT_REF})
  --help, -h           Tampilkan bantuan ini

Aman secara struktur: hanya file framework yang disentuh, hasilnya masuk STAGED
(bukan commit). Rollback kapan saja dengan:
  git restore --staged --worktree .
`);
}

// ─── Apply (staged, never committed) ─────────────────────────────────────────

export interface ApplyConflict {
  file: string;
  /** `content` = both sides edited the same lines; `add-add` = no usable base;
   *  `binary` = not line-mergeable (image/PDF) — left byte-intact. */
  kind: 'content' | 'add-add' | 'binary';
}

export interface ApplyResult {
  applied: string[];
  preserved: string[];
  /** Files removed because upstream deleted them and QA never touched them. */
  deleted: string[];
  /** Upstream-deleted files left alone because QA modified them. */
  kept: string[];
  /** Files left with conflict markers — never staged; QA/agent resolves. */
  conflicts: ApplyConflict[];
}

/**
 * Apply a framework-zone diff to the worktree. Changes land in the INDEX
 * (staged) — rollback is `git restore --staged --worktree .`.
 *
 * Three cases per file:
 * - QA never touched it → `git checkout FETCH_HEAD -- <file>` (plain overwrite).
 * - QA edited it and a base exists → three-way merge (`git merge-file`): clean
 *   results are written+staged, conflicts are left with markers and NOT staged.
 * - Upstream deleted it → `git rm` only when QA never touched it; a
 *   QA-modified file is KEPT (never deleted) and reported.
 *
 * `src/support/auth.setup.ts` is skipped when it carries a QA customization
 * marker; otherwise it is backed up to `.bak` before being replaced.
 */
export function applyZoneDiff(
  repoRoot: string,
  zone: ZoneDiff,
  opts: { base: string | null; dryRun?: boolean } = { base: null },
): ApplyResult {
  const dryRun = opts.dryRun === true;
  const preserved: string[] = [];
  const deleted: string[] = [];
  const kept: string[] = [];
  const conflicts: ApplyConflict[] = [];
  /** Plain overwrites — resolved by `git checkout FETCH_HEAD --`. */
  const toApply: string[] = [];
  /** Files already written+staged (three-way merge) — must NOT be re-checked-out. */
  const merged: string[] = [];

  for (const file of zone.updated) {
    const abs = path.join(repoRoot, file);
    if (file === GENERATED_AUTH_SETUP && fs.existsSync(abs)) {
      if (shouldPreserveGeneratedFile(file, fs.readFileSync(abs, 'utf-8'))) {
        preserved.push(file);
        continue;
      }
      if (!dryRun) {
        fs.copyFileSync(abs, `${abs}.bak`);
        printInfo(`Backup ${file} → ${file}.bak`);
      }
    }

    // Three-way merge only when a base exists AND QA changed the file since it.
    const baseContent = opts.base ? blobAt(repoRoot, opts.base, file) : null;
    const ours = fs.existsSync(abs) ? fs.readFileSync(abs, 'utf-8') : null;
    const qaChanged =
      baseContent !== null && ours !== null && normalizeEol(ours) !== normalizeEol(baseContent);

    if (qaChanged) {
      const theirs = blobAt(repoRoot, 'FETCH_HEAD', file);
      if (theirs === null) {
        // Upstream dropped the path but the zone says "updated" — treat as conflict.
        conflicts.push({ file, kind: 'add-add' });
        continue;
      }
      // Binary files (images, PDFs) cannot be line-merged: never hand them to
      // git merge-file, whose empty output would truncate the file. Report a
      // conflict and leave the bytes untouched.
      if (looksBinary(ours) || looksBinary(baseContent) || looksBinary(theirs)) {
        conflicts.push({ file, kind: 'binary' });
        continue;
      }
      const result = mergeFile(normalizeEol(baseContent), normalizeEol(ours), normalizeEol(theirs));
      if (result.failed) {
        // git could not merge (e.g. unsupported content) — do NOT write `content`.
        conflicts.push({ file, kind: 'content' });
        continue;
      }
      if (result.clean) {
        if (!dryRun) {
          fs.writeFileSync(abs, result.content, 'utf-8');
          git(repoRoot, ['add', '--', file]);
        }
        merged.push(file);
      } else {
        if (!dryRun) fs.writeFileSync(abs, result.content, 'utf-8');
        conflicts.push({ file, kind: 'content' });
      }
      continue;
    }

    toApply.push(file);
  }

  if (!dryRun && toApply.length > 0) {
    const checkout = git(repoRoot, ['checkout', 'FETCH_HEAD', '--', ...toApply]);
    if (checkout.status !== 0) {
      throw new UpgradeError(`Gagal menerapkan perubahan:\n${checkout.stderr.trim()}`);
    }
  }

  // Deletions: only files upstream removed AND QA never touched. A QA-modified
  // path is kept — `git rm` would destroy local work.
  //
  // Requires a base: without one we cannot tell an upstream-owned file from a QA
  // file that merely lives in a framework dir, so we fall back to the old
  // behavior (report only, never delete).
  for (const file of zone.deleted) {
    if (!opts.base) {
      kept.push(file);
      continue;
    }
    const abs = path.join(repoRoot, file);
    const baseContent = blobAt(repoRoot, opts.base, file);
    const ours = fs.existsSync(abs) ? fs.readFileSync(abs, 'utf-8') : null;
    const qaChanged =
      baseContent !== null && ours !== null && normalizeEol(ours) !== normalizeEol(baseContent);
    if (qaChanged) {
      kept.push(file);
      continue;
    }
    if (dryRun) {
      deleted.push(file);
      continue;
    }
    const rm = git(repoRoot, ['rm', '-q', '--', file]);
    if (rm.status === 0) {
      deleted.push(file);
    } else {
      kept.push(file);
    }
  }

  return { applied: [...toApply, ...merged], preserved, deleted, kept, conflicts };
}

/**
 * Three-way merge of one file via `git merge-file -p <ours> <base> <theirs>`.
 *
 * `-p` writes to stdout, so the worktree file is only touched by the caller.
 * Exit code is the conflict count (0 = clean) — see git-merge-file(1).
 *
 * `failed` is set when git itself could not merge (status < 0 or > 127), which
 * happens for binary content: git refuses and prints nothing. The caller MUST
 * NOT write `content` in that case — an empty stdout would truncate the file.
 * Binary files therefore surface as a conflict and are left byte-intact.
 */
export function mergeFile(
  base: string,
  ours: string,
  theirs: string,
): { clean: boolean; content: string; failed: boolean } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-merge-'));
  try {
    const basePath = path.join(dir, 'base');
    const oursPath = path.join(dir, 'ours');
    const theirsPath = path.join(dir, 'theirs');
    fs.writeFileSync(basePath, base, 'utf-8');
    fs.writeFileSync(oursPath, ours, 'utf-8');
    fs.writeFileSync(theirsPath, theirs, 'utf-8');
    const res = spawnSync('git', ['merge-file', '-p', oursPath, basePath, theirsPath], {
      encoding: 'utf-8',
      timeout: 60_000,
    });
    const status = res.status ?? 255;
    // 0 = clean; 1..127 = that many conflicts; anything else = git could not
    // merge (binary/unsupported) and stdout is unusable.
    const failed = status < 0 || status > 127 || (status !== 0 && (res.stdout ?? '') === '');
    return { clean: status === 0, content: res.stdout ?? '', failed };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** True when `text` looks like binary content (NUL byte or invalid UTF-8). */
export function looksBinary(text: string): boolean {
  return text.includes('\u0000') || text.includes('\ufffd');
}

// ─── Main flow ───────────────────────────────────────────────────────────────

export interface UpgradeOutcome {
  exitCode: ExitCode;
  /** Updated framework files (empty when already up to date). */
  updated: string[];
  /** Files skipped because they carry a QA customization marker. */
  preserved: string[];
  /** Local commits that would be reverted — non-empty means do not proceed. */
  riskyFiles: string[];
  /** Upstream-deleted files that were removed (QA never touched them). */
  deleted: string[];
  /** Upstream-deleted files left alone because QA modified them. */
  kept: string[];
  /** Files left with conflict markers, awaiting QA/agent resolution. */
  conflicts: ApplyConflict[];
  /** Upstream base commit used for the diff (null = fell back to HEAD). */
  base: string | null;
  /** Commit SHA of the upstream version just synced (for provenance). */
  syncedCommit: string | null;
  /** One-word next step for the driving agent. */
  nextAction: 'nothing' | 'review-and-commit' | 'resolve-conflicts' | 'fix-environment';
  fromVersion: string | null;
  toVersion: string | null;
}

/**
 * Run the whole upgrade flow. `checkOnly` stops after the preview.
 * Returns the outcome instead of exiting, so the harness can assert on it.
 */
export function runUpgrade(repoRoot: string, options: UpgradeOptions): UpgradeOutcome {
  const outcome: UpgradeOutcome = {
    exitCode: EXIT.OK,
    updated: [],
    preserved: [],
    riskyFiles: [],
    deleted: [],
    kept: [],
    conflicts: [],
    base: null,
    syncedCommit: null,
    nextAction: 'nothing',
    fromVersion: null,
    toVersion: null,
  };

  // 1. git repo?
  const topLevel = git(repoRoot, ['rev-parse', '--show-toplevel']);
  if (topLevel.status !== 0) {
    throw new UpgradeError(
      [
        'Folder ini bukan git repository — tidak ada riwayat untuk di-update.',
        'Minta maintainer menyiapkan repo QA dari template (atau jalankan: git init + commit awal).',
      ].join('\n'),
    );
  }

  // 2. Dirty guard — BEFORE any write (preview mode writes nothing, so it is exempt).
  if (!options.checkOnly) {
    const status = git(repoRoot, ['status', '--porcelain']);
    assertCleanWorktree(parsePorcelain(status.stdout), FRAMEWORK_PATHS, repoRoot);
  }

  // 3. Fetch upstream.
  printStep(1, 5, `Ambil versi terbaru dari ${options.source} (${options.ref})`);
  const fetch = git(repoRoot, ['fetch', '--quiet', options.source, options.ref]);
  if (fetch.status !== 0) {
    throw new UpgradeError(
      [
        `Gagal mengambil versi terbaru dari ${options.source} (${options.ref}).`,
        fetch.stderr.trim() ||
          'Periksa koneksi internet / akses repo, atau pakai --source <path-lokal>.',
      ].join('\n'),
    );
  }
  const remoteHead = git(repoRoot, ['rev-parse', 'FETCH_HEAD']).stdout.trim();
  if (remoteHead.length === 0) {
    throw new UpgradeError(
      `Tidak bisa membaca FETCH_HEAD dari ${options.source} (${options.ref}).`,
    );
  }

  // 4. Diff the framework zone. The base is the recorded upstream sync when
  // available (accurate "QA changed this" vs "upstream changed this"), else HEAD.
  const state = readUpgradeState(repoRoot);
  const base = resolveBase(repoRoot, state);
  outcome.base = base;
  const diffBase = base ?? 'HEAD';
  const diffOutput = git(repoRoot, [
    'diff',
    '--name-status',
    diffBase,
    'FETCH_HEAD',
    '--',
    ...FRAMEWORK_PATHS,
  ]);
  if (diffOutput.status !== 0) {
    throw new UpgradeError(
      [
        'Gagal membandingkan versi lokal dengan upstream.',
        diffOutput.stderr.trim() || `${diffBase}..FETCH_HEAD tidak bisa di-diff.`,
      ].join('\n'),
    );
  }
  const zone = computeZoneDiff(diffOutput.stdout);
  outcome.updated = zone.updated;
  outcome.fromVersion = packageVersion(git(repoRoot, ['show', 'HEAD:package.json']).stdout);
  outcome.toVersion = packageVersion(git(repoRoot, ['show', 'FETCH_HEAD:package.json']).stdout);

  if (zone.updated.length === 0 && zone.deleted.length === 0) {
    printOk('Sudah versi terbaru — tidak ada file framework yang berubah.');
    outcome.nextAction = 'nothing';
    return outcome;
  }

  // 4b. Local framework work that this overwrite would silently revert.
  // Only a fallback: with a recorded base, `applyZoneDiff` three-way merges
  // QA edits instead of clobbering them, so there is nothing to block on.
  if (base === null) {
    const risky = findRiskyLocalFrameworkCommits(repoRoot, zone.updated);
    outcome.riskyFiles = risky.riskyFiles;
    if (risky.riskyFiles.length > 0) {
      const detail = [
        `${risky.commits.length} commit lokal mengubah file framework yang akan di-update:`,
        ...risky.commits.slice(0, 5).map((c) => `  ${c}`),
        `  file: ${risky.riskyFiles.slice(0, 10).join(', ')}`,
        'Update akan mengembalikan file itu ke versi upstream dan perubahan lokal hilang.',
        'Push dulu (bila layak masuk upstream), atau pindahkan perubahan ke luar zona framework.',
        `Kustomisasi permanen pada ${GENERATED_AUTH_SETUP}? Tambahkan // ${PRESERVE_MARKER} di baris atas file itu — update melewatinya otomatis.`,
      ];
      if (options.checkOnly) {
        printWarn(detail.join('\n'));
        outcome.exitCode = EXIT.FIXABLE;
        outcome.nextAction = 'fix-environment';
      } else {
        throw new UpgradeError(detail.join('\n'));
      }
    }
  }

  // 5. Preview. A dry-run of applyZoneDiff yields the exact plan (incl. conflicts
  // and safe-deletes) without touching the worktree.
  const plan = applyZoneDiff(repoRoot, zone, { base, dryRun: true });
  printStep(2, 5, 'Ringkasan perubahan');
  printInfo(
    `Versi framework: ${outcome.fromVersion ?? '(tidak terbaca)'} → ${outcome.toVersion ?? '(tidak terbaca)'}`,
  );
  printInfo(
    base
      ? `Base: ${base.slice(0, 12)} (sinkron terakhir)`
      : 'Base: HEAD (belum ada catatan sinkron)',
  );
  const changelog = firstChangelogSection(
    git(repoRoot, ['show', 'FETCH_HEAD:CHANGELOG.md']).stdout,
  );
  if (changelog) printInfo(`Perubahan terbaru: ${changelog.replace(/^#+\s*/, '')}`);
  for (const file of plan.applied) humanWrite(`  M ${file}\n`);
  for (const file of plan.deleted) humanWrite(`  D ${file}\n`);
  for (const c of plan.conflicts) {
    printWarn(`Konflik (${c.kind}): ${c.file} — akan dibiarkan bermarker untuk diselesaikan.`);
  }
  if (plan.kept.length > 0) {
    printWarn(
      `${plan.kept.length} file dihapus upstream tetapi DIPERTAHANKAN lokal (dimodifikasi, atau tanpa base):`,
    );
    for (const file of plan.kept) humanWrite(`  ! ${file}\n`);
  }
  if (zone.outside.length > 0) {
    printInfo(`${zone.outside.length} file di luar zona framework tidak disentuh (milik QA).`);
  }

  if (options.checkOnly) {
    outcome.conflicts = plan.conflicts;
    outcome.deleted = plan.deleted;
    outcome.kept = plan.kept;
    outcome.preserved = plan.preserved;
    // A risky-check block already set fix-environment; do not overwrite it.
    if (outcome.nextAction !== 'fix-environment') {
      outcome.nextAction = plan.conflicts.length > 0 ? 'resolve-conflicts' : 'review-and-commit';
    }
    printOk(
      'Mode --check: tidak ada file yang diubah. Jalankan `npm run upgrade` untuk menerapkan.',
    );
    return outcome;
  }

  // 6. Apply — staged, never committed.
  printStep(3, 5, 'Terapkan perubahan (masuk staged, bukan commit)');
  const applyResult = applyZoneDiff(repoRoot, zone, { base });
  outcome.preserved = applyResult.preserved;
  outcome.deleted = applyResult.deleted;
  outcome.kept = applyResult.kept;
  outcome.conflicts = applyResult.conflicts;
  for (const file of applyResult.preserved) {
    printWarn(
      `${file} punya kustomisasi QA (// ${PRESERVE_MARKER} atau // ${PRESERVE_MARKER_LEGACY}) — TIDAK ditimpa. Periksa manual bila upstream mengubahnya.`,
    );
  }
  for (const c of applyResult.conflicts) {
    printWarn(
      `KONFLIK pada ${c.file} — dibiarkan bermarker dan TIDAK di-stage. Selesaikan lalu \`git add\`.`,
    );
  }

  // 7. Dependencies + env check.
  printStep(4, 5, 'Dependency & environment');
  if (!runNpm(repoRoot, ['install'])) {
    printWarn('npm install gagal — perbaiki dulu, lalu jalankan ulang: npm run upgrade');
  }
  if (!runNpm(repoRoot, ['run', 'setup:check'])) {
    printWarn('Setup belum lengkap (env/kredensial). Jalankan: npm run setup');
  }

  // 8. Skills + MCP configs + MCP server build.
  // Guarded: this runs against a repo whose framework files were just updated,
  // but the module was imported from the OLD version — a missing export or a
  // throw here must not kill an otherwise successful upgrade.
  printStep(5, 5, 'Sinkronisasi skills, MCP config, dan build server');
  let mcpBuilt = false;
  try {
    if (typeof syncAgentSkillsAndMcp === 'function') {
      const sync = syncAgentSkillsAndMcp(repoRoot);
      for (const error of sync.errors) printWarn(error);
      mcpBuilt = sync.mcpServerBuilt;
    } else {
      printInfo('Helper sinkronisasi belum ada di versi ini.');
    }
  } catch (err) {
    printWarn(`Sinkronisasi skills/MCP gagal: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Verify the ARTIFACT, not the helper's report. During a bootstrap upgrade the
  // helper in memory is still the OLD version, and the old one silently fails to
  // build on Windows (EINVAL spawning npm.cmd) — the dist file is the truth.
  const mcpDist = path.join(repoRoot, 'tools', 'mcp', 'dist', 'index-mcp.js');
  if (!fs.existsSync(mcpDist)) {
    printInfo('MCP server belum ter-build — membangun sekarang...');
    mcpBuilt = runNpm(repoRoot, ['run', 'mcp:build'], 300_000);
    if (!mcpBuilt) printWarn('Build MCP server gagal. Jalankan manual: npm run mcp:build');
  }
  if (mcpBuilt) printOk('MCP server siap: tools/mcp/dist/index-mcp.js');

  // 9. Auth sessions — verify only, never delete.
  printInfo('Memeriksa sesi login (tidak dihapus, hanya diverifikasi)...');
  if (!runNpm(repoRoot, ['run', 'auth:verify'], 180_000)) {
    printWarn('Sebagian sesi login tidak valid. Refresh dengan: npm run auth:setup');
  }

  // 10. Summary.
  humanWrite('\n');
  printOk(
    `Upgrade selesai: ${outcome.fromVersion ?? '?'} → ${outcome.toVersion ?? '?'} (${applyResult.applied.length} file).`,
  );
  if (outcome.deleted.length > 0) {
    printInfo(`${outcome.deleted.length} file framework yang dibuang upstream ikut dihapus.`);
  }
  if (outcome.kept.length > 0) {
    printWarn(`Dipertahankan (dimodifikasi lokal / tanpa base): ${outcome.kept.join(', ')}`);
  }
  if (outcome.preserved.length > 0) {
    printWarn(`Dilewati (kustom QA): ${outcome.preserved.join(', ')}`);
  }
  if (outcome.conflicts.length > 0) {
    outcome.nextAction = 'resolve-conflicts';
    printWarn(
      `${outcome.conflicts.length} file KONFLIK (belum di-stage): ${outcome.conflicts
        .map((c) => `${c.file} [${c.kind}]`)
        .join(', ')}`,
    );
    printInfo('Selesaikan marker, lalu `git add <file>`. Batal: git restore --staged --worktree .');
  } else {
    outcome.nextAction = 'review-and-commit';
    printInfo('Hasil update masih STAGED. Periksa dengan: git diff --cached');
    // Provenance: recommend a trailer so `git log` shows which upstream commit
    // this sync came from. Git only reads custom trailers reliably when the key
    // is configured; --trailer passes it explicitly, so no config is needed.
    printInfo(
      `Commit dengan jejak upstream:\n    git commit -m "chore: sync framework" --trailer "Upstream-Sync: ${remoteHead.slice(0, 12)}"`,
    );
    printInfo('Batal → rollback: git restore --staged --worktree .');
  }
  printInfo('Restart IDE/agent agar MCP server memuat build baru.');

  // Record the synced base so the NEXT upgrade can tell QA edits from upstream.
  outcome.syncedCommit = remoteHead;
  try {
    writeUpgradeState(repoRoot, {
      schemaVersion: 1,
      upstream: options.source,
      ref: options.ref,
      syncedCommit: remoteHead,
      syncedAt: new Date().toISOString(),
    });
  } catch (err) {
    printWarn(
      `Gagal menyimpan .upgrade-state.json: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  return outcome;
}

// ─── CLI entry ───────────────────────────────────────────────────────────────

/** Machine-readable result emitted as the single stdout line in `--json` mode. */
export interface UpgradeJsonResult {
  status: 'ok' | 'conflicts' | 'blocked' | 'up-to-date' | 'error';
  from: string | null;
  to: string | null;
  base: string | null;
  /** Upstream commit just synced — provenance for the follow-up commit. */
  syncedCommit: string | null;
  updated: string[];
  deleted: string[];
  kept: string[];
  preserved: string[];
  conflicts: ApplyConflict[];
  applied: number;
  exitCode: ExitCode;
  nextAction: UpgradeOutcome['nextAction'];
  rollback: string;
  error?: string;
}

/** Map an outcome (or an error) to the JSON contract the driving agent reads. */
export function toJsonResult(outcome: UpgradeOutcome | null, error?: string): UpgradeJsonResult {
  if (!outcome) {
    return {
      status: 'error',
      from: null,
      to: null,
      base: null,
      syncedCommit: null,
      updated: [],
      deleted: [],
      kept: [],
      preserved: [],
      conflicts: [],
      applied: 0,
      exitCode: EXIT.FIXABLE,
      nextAction: 'fix-environment',
      rollback: 'git restore --staged --worktree .',
      error: error ?? 'unknown error',
    };
  }
  const status: UpgradeJsonResult['status'] =
    outcome.conflicts.length > 0
      ? 'conflicts'
      : outcome.exitCode !== EXIT.OK
        ? 'blocked'
        : outcome.updated.length === 0 && outcome.deleted.length === 0
          ? 'up-to-date'
          : 'ok';
  return {
    status,
    from: outcome.fromVersion,
    to: outcome.toVersion,
    base: outcome.base,
    syncedCommit: outcome.syncedCommit,
    updated: outcome.updated,
    deleted: outcome.deleted,
    kept: outcome.kept,
    preserved: outcome.preserved,
    conflicts: outcome.conflicts,
    applied: outcome.updated.length,
    exitCode: outcome.exitCode,
    nextAction: outcome.nextAction,
    rollback: 'git restore --staged --worktree .',
  };
}

async function main(): Promise<void> {
  const repoRoot = process.cwd();
  const json = process.argv.slice(2).includes('--json');
  if (json) {
    // Human narration to stderr; stdout is reserved for the single JSON line.
    setHumanSink(process.stderr);
    setJsonMode(true);
  }

  let options: UpgradeOptions | null;
  try {
    options = parseUpgradeArgs(process.argv.slice(2));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (json) process.stdout.write(`${JSON.stringify(toJsonResult(null, msg))}\n`);
    else {
      printWarn(msg);
      printUpgradeHelp();
    }
    process.exit(EXIT.USAGE);
  }
  if (options === null) {
    printUpgradeHelp();
    process.exit(EXIT.OK);
  }

  try {
    const outcome = runUpgrade(repoRoot, options);
    if (json) process.stdout.write(`${JSON.stringify(toJsonResult(outcome))}\n`);
    process.exit(outcome.exitCode);
  } catch (err) {
    if (err instanceof UpgradeError) {
      if (json) process.stdout.write(`${JSON.stringify(toJsonResult(null, err.message))}\n`);
      else printWarn(err.message);
      process.exit(EXIT.FIXABLE);
    }
    throw err;
  }
}

if (require.main === module) {
  main().catch((err) => {
    process.stderr.write(`Fatal error: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(EXIT.ESCALATE);
  });
}
