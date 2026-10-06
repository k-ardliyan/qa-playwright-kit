/// <reference types="node" />
/**
 * framework-upgrade — Pull the framework zone from upstream into this repo.
 *
 * QA-facing command (`npm run upgrade`): no git knowledge required, no stash,
 * no manual merge, and QA work-in-progress NEVER needs to be committed — a
 * dirty worktree never blocks the run. Only framework-owned files are touched,
 * per-file, and the result lands STAGED so it can be reviewed or rolled back
 * with one command (`--commit` lets the tool create the follow-up commit).
 *
 * Safety is structural, not ceremonial:
 *   - gitignored files (config/environments/*.env, .auth/**, artifacts/**,
 *     requirements/login.md) never appear in a git diff → cannot be touched.
 *   - QA-tracked files (specs, POMs, plans) do not exist upstream → never a target.
 *   - Every apply run first records a SAFETY SNAPSHOT of the dirty framework
 *     files (upgrade-snapshot.ts — non-destructive, ref-anchored), so any
 *     pre-existing local state is recoverable no matter what happens next.
 *
 * Universal three-way merge (base = recorded base ?? HEAD):
 *   - Every file is merged via `git merge-file`, never plainly overwritten
 *     while local content exists. QA edits are merged, not clobbered; real
 *     conflicts are left with markers and NOT staged. Binary files (image/PDF)
 *     are never line-merged — `git merge-file` prints nothing for them, so
 *     writing its output would truncate the file; they surface as a `binary`
 *     conflict and stay byte-intact.
 *   - The base is the COMMITTED `.upgrade-base.json` pointer when present,
 *     else the per-machine `.upgrade-state.json` legacy record, else HEAD.
 *     Because merge always has a base (HEAD fallback), there is no "risky
 *     local commit" hard-block anymore: nothing can be silently reverted.
 *   - `git rerere` does NOT apply here: it is triggered by `git merge`/`rebase`,
 *     while this uses the plumbing `git merge-file` directly, so nothing is
 *     auto-recorded. Repeated conflicts are instead resolved once and kept by
 *     committing; `git rerere` only helps if a workflow uses real merges.
 *
 * Usage:
 *   npm run upgrade              # apply framework-zone changes from upstream
 *   npm run upgrade --commit     # ...and create the provenance commit when clean
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
import {
  readUpgradeBase,
  writeUpgradeBase,
  UPGRADE_BASE_FILE,
  type UpgradeBase,
} from './upgrade-base';
import { createUpgradeSnapshot, type UpgradeSnapshot } from './upgrade-snapshot';
import { acquireUpgradeLock, releaseUpgradeLock, UpgradeLockError } from './upgrade-commit-guard';

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

/**
 * True when `file` ever existed in the upstream history. In HEAD-fallback mode
 * the diff cannot tell "upstream deleted this" from "QA added this and upstream
 * never had it" — both show as D HEAD..FETCH_HEAD. History is the tiebreaker:
 * a file upstream never carried is QA's own, even inside the zone.
 */
function upstreamHistoryHasFile(repoRoot: string, file: string): boolean {
  return (
    git(repoRoot, ['log', '-n', '1', '--format=%H', 'FETCH_HEAD', '--', file]).stdout.trim()
      .length > 0
  );
}

export interface LocalFrameworkCommitCheck {
  /** Local commits (FETCH_HEAD..HEAD) touching files this upgrade would overwrite. */
  commits: string[];
  /** Of those files, the ones whose current content is NOT any upstream version. */
  riskyFiles: string[];
}

/**
 * ADIVSORY (never a block): detect local commits touching files this upgrade
 * will update. In HEAD-fallback mode (no recorded base) committed local work
 * cannot be told apart from upstream content, so the merge may move the
 * worktree away from it. That work is NOT lost — it lives in git history and
 * in the pre-apply safety snapshot — but QA must be told. The old hard-block
 * was the "commit → cannot upgrade" dead-end this engine removed.
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

function git(
  repoRoot: string,
  args: string[],
  opts?: { env?: NodeJS.ProcessEnv; timeoutMs?: number },
): GitResult {
  const res = spawnSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf-8',
    timeout: opts?.timeoutMs ?? 120_000,
    ...(opts?.env ? { env: { ...process.env, ...opts.env } } : {}),
  });
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
 * The base commit to diff/merge against, in precedence order:
 *   1. The COMMITTED `.upgrade-base.json` pointer (accurate on every clone).
 *   2. The legacy per-machine `.upgrade-state.json` record (migration path).
 *   3. `null` — callers then fall back to HEAD as the merge base.
 */
export function resolveBase(
  repoRoot: string,
  base: UpgradeBase | null,
  state: UpgradeState | null,
): string | null {
  if (base && commitExists(repoRoot, base.syncedCommit)) return base.syncedCommit;
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
  /** After a CLEAN apply (zero conflicts), create the provenance commit. */
  commit?: boolean;
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
    commit: parsed.values.commit ?? false,
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
      commit: { type: 'boolean', default: false },
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
  --commit             Setelah apply BERSIH (tanpa konflik), buat commit jejak upstream otomatis.
                       Konflik apapun = TIDAK pernah commit.
  --source <url|path>  Sumber framework (default: ${DEFAULT_SOURCE})
  --ref <ref>          Branch/tag sumber (default: ${DEFAULT_REF})
  --help, -h           Tampilkan bantuan ini

Aman secara struktur: hanya file framework yang disentuh, WIP QA tidak perlu
di-commit (snapshot keamanan direkam otomatis), dan hasilnya masuk STAGED
(bukan commit) kecuali --commit dipakai. Rollback kapan saja dengan:
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
 * UNIVERSAL three-way merge — the merge base is `opts.base` when recorded,
 * else HEAD, so EVERY case is covered without any hard-block on dirty state:
 * - Local content == base (QA never touched it) → plain overwrite (fast path,
 *   semantically identical to merging).
 * - Local content != base (QA edited it, committed or not) → three-way merge:
 *   clean results are written+staged, conflicts are left with markers and NOT
 *   staged. This includes uncommitted edits — nothing local is ever silently
 *   reverted; runUpgrade snapshots dirty files before calling this.
 * - Local file exists but has no base version (untracked at a path upstream
 *   added) → add/add merge against an empty base.
 * - Upstream deleted it → `git rm` when the local content matches the base; a
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
  const baseRev = opts.base ?? 'HEAD';
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

    const theirs = blobAt(repoRoot, 'FETCH_HEAD', file);
    if (theirs === null) {
      // Upstream dropped the path but the zone says "updated" — treat as conflict.
      conflicts.push({ file, kind: 'add-add' });
      continue;
    }
    const ours = fs.existsSync(abs) ? fs.readFileSync(abs, 'utf-8') : null;
    const baseContent = blobAt(repoRoot, baseRev, file);

    if (ours === null) {
      // File absent locally (upstream-added, or QA deleted it locally): plain add.
      toApply.push(file);
      continue;
    }
    const qaChanged = baseContent !== null && normalizeEol(ours) !== normalizeEol(baseContent);
    if (baseContent !== null && !qaChanged) {
      // Local content equals the base → nothing local to lose → plain overwrite.
      toApply.push(file);
      continue;
    }

    // Local content exists and is NOT the base version: merge, never clobber.
    // baseContent === null means the file is untracked here while upstream has
    // it — an add/add merge against an empty base.
    const addAdd = baseContent === null;
    // Binary files (images, PDFs) cannot be line-merged: never hand them to
    // git merge-file, whose empty output would truncate the file. Report a
    // conflict and leave the bytes untouched.
    if (
      looksBinary(ours) ||
      looksBinary(theirs) ||
      (baseContent !== null && looksBinary(baseContent))
    ) {
      conflicts.push({ file, kind: 'binary' });
      continue;
    }
    const result = mergeFile(
      normalizeEol(baseContent ?? ''),
      normalizeEol(ours),
      normalizeEol(theirs),
    );
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
      conflicts.push({ file, kind: addAdd ? 'add-add' : 'content' });
    }
  }

  if (!dryRun && toApply.length > 0) {
    const checkout = git(repoRoot, ['checkout', 'FETCH_HEAD', '--', ...toApply]);
    if (checkout.status !== 0) {
      throw new UpgradeError(`Gagal menerapkan perubahan:\n${checkout.stderr.trim()}`);
    }
  }

  // Deletions: only files upstream removed AND whose local content still matches
  // the base. A QA-modified path is kept — `git rm` would destroy local work.
  // baseRev is always resolvable (recorded base ?? HEAD). In HEAD-fallback mode
  // the diff cannot tell "upstream deleted this" from "QA added this and
  // upstream never had it" — the upstream-history check is the tiebreaker, so a
  // QA-owned file living inside the zone is never safe-deleted.
  for (const file of zone.deleted) {
    if (opts.base === null && !upstreamHistoryHasFile(repoRoot, file)) {
      kept.push(file);
      continue;
    }
    const abs = path.join(repoRoot, file);
    const baseContent = blobAt(repoRoot, baseRev, file);
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

/**
 * Create the provenance commit for a CLEAN sync (`--commit`).
 *
 * The env marker `QA_KIT_UPGRADE_COMMIT=1` lets the pre-commit commit-guard
 * allow THIS commit while still blocking any other commit made mid-upgrade
 * (the guard's whole point). Hook failure is not fatal: the caller keeps the
 * result staged and reports honestly.
 *
 * Returns the commit SHA, or null when the commit did not happen.
 */
function commitSyncedZone(
  repoRoot: string,
  remoteHead: string,
  outcome: UpgradeOutcome,
): string | null {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-commit-'));
  try {
    const msgPath = path.join(dir, 'COMMIT_MSG');
    const counts = `${outcome.updated.length} updated, ${outcome.deleted.length} deleted, ${outcome.kept.length} kept, ${outcome.preserved.length} preserved`;
    fs.writeFileSync(
      msgPath,
      [
        'chore: sync framework zone',
        '',
        `Upstream ${outcome.fromVersion ?? '?'} → ${outcome.toVersion ?? '?'} (${counts}).`,
        `Upstream head: ${remoteHead.slice(0, 12)}. Base: ${outcome.base ? outcome.base.slice(0, 12) : 'HEAD'}.`,
        '',
        'Committed by `npm run upgrade --commit` — framework zone only; QA files untouched.',
        '',
      ].join('\n'),
      'utf-8',
    );
    const res = git(
      repoRoot,
      ['commit', '-F', msgPath, '--trailer', `Upstream-Sync: ${remoteHead.slice(0, 12)}`],
      { env: { QA_KIT_UPGRADE_COMMIT: '1' }, timeoutMs: 600_000 },
    );
    if (res.status !== 0) return null;
    const sha = git(repoRoot, ['rev-parse', 'HEAD']);
    return sha.status === 0 ? sha.stdout.trim() : null;
  } catch {
    return null;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// ─── Main flow ───────────────────────────────────────────────────────────────

export interface UpgradeOutcome {
  exitCode: ExitCode;
  /** Updated framework files (empty when already up to date). */
  updated: string[];
  /** Files skipped because they carry a QA customization marker. */
  preserved: string[];
  /** Pre-apply safety snapshot of dirty framework files (null when clean). */
  snapshot: UpgradeSnapshot | null;
  /** Commit SHA created by --commit (null when not requested, or blocked). */
  commit: string | null;
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
 *
 * Apply mode runs under the upgrade LOCK (artifacts/.upgrade-lock.json): a
 * second concurrent apply is refused, and the pre-commit commit-guard denies
 * any other commit until this run releases the lock. Preview mode is
 * read-only and takes no lock.
 */
export function runUpgrade(repoRoot: string, options: UpgradeOptions): UpgradeOutcome {
  if (options.checkOnly) return runUpgradeUnlocked(repoRoot, options);
  try {
    acquireUpgradeLock(repoRoot);
  } catch (err) {
    if (err instanceof UpgradeLockError) throw new UpgradeError(err.message);
    throw err;
  }
  try {
    return runUpgradeUnlocked(repoRoot, options);
  } finally {
    releaseUpgradeLock(repoRoot);
  }
}

function runUpgradeUnlocked(repoRoot: string, options: UpgradeOptions): UpgradeOutcome {
  const outcome: UpgradeOutcome = {
    exitCode: EXIT.OK,
    updated: [],
    preserved: [],
    snapshot: null,
    commit: null,
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

  // 2. Fetch upstream. A dirty worktree NEVER blocks the run: applyZoneDiff
  // merges instead of clobbering, and step 6 snapshots dirty files first.
  // (Preview mode writes nothing and snapshots nothing.)
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

  // 4. Diff the framework zone. The base is the COMMITTED `.upgrade-base.json`
  // pointer when present, else the legacy per-machine `.upgrade-state.json`
  // record, else null (merge then falls back to HEAD per file) — accurate
  // "QA changed this" vs "upstream changed this" on every clone.
  const state = readUpgradeState(repoRoot);
  const baseRecord = readUpgradeBase(repoRoot);
  const base = resolveBase(repoRoot, baseRecord, state);
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

  // 4b. Advisory only — NEVER a block. Without a recorded base, local commits
  // touching to-be-updated files cannot be told apart from upstream content;
  // the merge may move the worktree away from them. That work is not lost
  // (git history + the pre-apply snapshot below), but QA must see it.
  if (base === null && zone.updated.length > 0) {
    const risky = findRiskyLocalFrameworkCommits(repoRoot, zone.updated);
    if (risky.riskyFiles.length > 0) {
      printWarn(
        [
          `${risky.commits.length} commit lokal menyentuh file framework yang akan di-update: ${risky.riskyFiles.slice(0, 10).join(', ')}`,
          'Worktree akan di-merge ke versi upstream. Konten commit itu TIDAK hilang — masih di riwayat git dan di snapshot keamanan pra-apply.',
        ].join('\n'),
      );
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
    outcome.nextAction = plan.conflicts.length > 0 ? 'resolve-conflicts' : 'review-and-commit';
    printOk(
      'Mode --check: tidak ada file yang diubah. Jalankan `npm run upgrade` untuk menerapkan.',
    );
    return outcome;
  }

  // 6. Apply — staged, never committed (unless --commit, handled in the summary).
  // Before the first mutation, snapshot the CURRENT content of every dirty
  // framework file (tracked-modified, staged, untracked alike) into an
  // immutable ref, so any pre-existing local state stays recoverable no matter
  // what the merge does.
  printStep(3, 5, 'Terapkan perubahan (masuk staged, bukan commit)');
  const dirtyZoneFiles = parsePorcelain(git(repoRoot, ['status', '--porcelain']).stdout)
    .filter((e) => inFrameworkZone(e.file))
    .map((e) => e.file);
  outcome.snapshot =
    dirtyZoneFiles.length > 0 ? createUpgradeSnapshot(repoRoot, dirtyZoneFiles) : null;
  if (outcome.snapshot) {
    printInfo(
      `Snapshot keamanan direkam: ${outcome.snapshot.ref} — pulihkan file mana pun dengan: git checkout ${outcome.snapshot.commit.slice(0, 12)} -- <file>`,
    );
  }
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

  // 10. Record the synced base so the NEXT upgrade can tell QA edits from
  // upstream. The per-machine cache stays gitignored; the COMMITTED pointer is
  // staged so the follow-up commit (manual, or automatic via --commit) carries
  // the new base — the Copier/cruft pattern: every clone starts accurate.
  outcome.syncedCommit = remoteHead;
  const syncedBase = {
    schemaVersion: 1 as const,
    upstream: options.source,
    ref: options.ref,
    syncedCommit: remoteHead,
    syncedAt: new Date().toISOString(),
  };
  try {
    writeUpgradeBase(repoRoot, syncedBase);
    git(repoRoot, ['add', '--', UPGRADE_BASE_FILE]);
  } catch (err) {
    printWarn(
      `Gagal menyimpan ${UPGRADE_BASE_FILE}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  try {
    writeUpgradeState(repoRoot, syncedBase);
  } catch (err) {
    printWarn(
      `Gagal menyimpan .upgrade-state.json: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // 11. Summary.
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
  } else if (options.commit === true) {
    // Clean apply + explicit --commit: create the provenance commit right here
    // so the synced state is durable immediately (no staged-limbo). Conflicts
    // never reach this branch — the resolve-conflicts branch above catches them.
    outcome.nextAction = 'review-and-commit';
    const committed = commitSyncedZone(repoRoot, remoteHead, outcome);
    if (committed !== null) {
      outcome.commit = committed;
      outcome.nextAction = 'nothing';
      printOk(`Commit provenance dibuat: ${committed.slice(0, 12)} (jejak Upstream-Sync)`);
    } else {
      printWarn(
        'Commit otomatis gagal (pre-commit hook?). Hasil tetap STAGED — periksa, lalu commit manual dengan trailer Upstream-Sync.',
      );
    }
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
  /** Pre-apply safety snapshot of dirty framework files (null when clean). */
  snapshot: { ref: string; commit: string } | null;
  /** Commit created by --commit (null when not requested, blocked, or clean-run without --commit). */
  commit: string | null;
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
      snapshot: null,
      commit: null,
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
  const rollback =
    outcome.snapshot === null
      ? 'git restore --staged --worktree .'
      : `git restore --staged --worktree . ; pulihkan file pra-upgrade dari snapshot: git checkout ${outcome.snapshot.commit} -- <file>`;
  return {
    status,
    from: outcome.fromVersion,
    to: outcome.toVersion,
    base: outcome.base,
    syncedCommit: outcome.syncedCommit,
    snapshot: outcome.snapshot,
    commit: outcome.commit,
    updated: outcome.updated,
    deleted: outcome.deleted,
    kept: outcome.kept,
    preserved: outcome.preserved,
    conflicts: outcome.conflicts,
    applied: outcome.updated.length,
    exitCode: outcome.exitCode,
    nextAction: outcome.nextAction,
    rollback,
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
