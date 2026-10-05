/**
 * Setup Wizard — cross-platform spawn primitives.
 *
 * Node ≥ 18.20 / 20.12 refuses to spawn `.cmd` / `.bat` without a shell
 * (CVE-2024-27980 hardening). Spawning `npm.cmd` with `shell: false` fails
 * with EINVAL and `status === null` — a silent, Windows-only failure that the
 * wizard used to report as "exit code null".
 *
 * `shell: true` is NOT a fix either: it requires `cmd.exe` on PATH, and hosts
 * that ship their own Node (Hermes, portable installs) fail with ENOENT while
 * still reporting `status === null`. The portable route is npm's own JS entry
 * run by the current Node binary — no shell, no `.cmd` shim. Every npm spawn
 * goes through `npmSpawn()` so that class cannot come back.
 *
 * @module src/setup/spawn-bin
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

export interface BinSpawn {
  command: string;
  args: string[];
  shell: boolean;
}

/** Spawn descriptor for a command name (e.g. `npm` / `npm.cmd`). */
export function binSpawn(
  command: string,
  args: string[],
  platform: NodeJS.Platform = process.platform,
): BinSpawn {
  return { command, args, shell: platform === 'win32' };
}

/** Absolute path to a local `node_modules/.bin/<name>` entry. */
export function localBin(
  repoRoot: string,
  name: string,
  platform: NodeJS.Platform = process.platform,
): string {
  const bin = path.join(repoRoot, 'node_modules', '.bin', name);
  return platform === 'win32' ? `${bin}.cmd` : bin;
}

/** `npm` on POSIX, `npm.cmd` on Windows. */
export function npmCommand(platform: NodeJS.Platform = process.platform): string {
  return platform === 'win32' ? 'npm.cmd' : 'npm';
}

/**
 * Shell-free spawn descriptor for a locally installed package entry.
 *
 * Arguments reach the child as argv entries, so a path containing spaces stays
 * ONE argument. The `npx` + `shell: true` shape re-split
 * `--output-dir=<repo>\artifacts\...` at every space on Windows and
 * `@playwright/mcp` exited with `too many arguments` — the whole browser MCP
 * server never started, on a machine whose only sin was a space in the repo
 * path.
 *
 * Returns null when the entry is absent (fresh clone before `npm install`), so
 * callers can fall back to `npmSpawn(['exec', '--yes', '--', <spec>, ...args])`
 * — also shell-free.
 */
export function localPackageSpawn(
  repoRoot: string,
  entryRelPath: string,
  args: string[],
  execPath: string = process.execPath,
): BinSpawn | null {
  const entry = path.join(repoRoot, ...entryRelPath.split('/'));
  if (!fs.existsSync(entry)) return null;
  return { command: execPath, args: [entry, ...args], shell: false };
}

/**
 * One-line description of a spawn plan for error messages, quoting only the
 * entries that need it. Spawn failures used to report a bare `err.message`, so
 * the command that actually ran was invisible without reading mcp-stderr.log.
 */
export function describeSpawn(plan: BinSpawn): string {
  return [plan.command, ...plan.args]
    .map((part) => (/\s/.test(part) ? `"${part}"` : part))
    .join(' ');
}

/**
 * Absolute path to npm's own JS entry, next to the running Node binary.
 * Returns null when the layout is unknown (then callers fall back to `npm.cmd`).
 */
export function resolveNpmCli(execPath: string = process.execPath): string | null {
  const candidates = [
    path.join(path.dirname(execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    path.join(path.dirname(execPath), '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
}

// ─── Shell-string path quoting ───────────────────────────────────────────────
//
// Terminal-launcher commands embed the repo path inside a `cmd.exe` / `bash -c`
// / AppleScript string. Left raw, a path containing the platform's quote char
// (`"` on Windows, `'` on POSIX) closes the quote early and the rest of the
// command is mis-parsed — silently, on a machine whose only sin is an unusual
// install path. Each helper targets exactly one shell's escaping rules.

/**
 * Quote a path for `cmd.exe` (Windows `start "" cmd /k "cd /d <path> && …"`).
 * Doubles every internal `"` — the cmd.exe escape — and wraps in quotes.
 */
export function quoteCmdPath(p: string): string {
  return `"${p.replace(/"/g, '""')}"`;
}

/** Quote a path for a POSIX shell single-quoted context: `'` → `'\''`. */
export function quotePosixPath(p: string): string {
  return `'${p.replace(/'/g, `'\\''`)}'`;
}

/** Escape a path for an AppleScript double-quoted literal: `\` and `"`. */
export function quoteAppleScriptPath(p: string): string {
  return p.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/**
 * Portable spawn descriptor for npm: `[process.execPath, [npmCli, ...args]]`
 * when npm's JS entry is resolvable, else the platform command with a shell.
 * `shell` is always false on the portable path, so nothing is interpolated.
 */
export function npmSpawn(
  args: string[],
  execPath: string = process.execPath,
): { command: string; args: string[]; shell: boolean } {
  const cli = resolveNpmCli(execPath);
  if (cli) return { command: execPath, args: [cli, ...args], shell: false };
  return binSpawn(npmCommand(), args);
}

/**
 * Absolute path to npx's own JS entry, next to the running Node binary.
 * Returns null when the layout is unknown (then callers fall back to `npx.cmd`).
 */
export function resolveNpxCli(execPath: string = process.execPath): string | null {
  const candidates = [
    path.join(path.dirname(execPath), 'node_modules', 'npm', 'bin', 'npx-cli.js'),
    path.join(path.dirname(execPath), '..', 'lib', 'node_modules', 'npm', 'bin', 'npx-cli.js'),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
}

/**
 * Portable spawn descriptor for npx — same rationale as npmSpawn(). Prefers
 * `[process.execPath, [npxCli, ...args]]` (no shell) and only falls back to the
 * `npx.cmd` + shell shape when the JS entry cannot be located.
 */
export function npxSpawn(
  args: string[],
  execPath: string = process.execPath,
): { command: string; args: string[]; shell: boolean } {
  const cli = resolveNpxCli(execPath);
  if (cli) return { command: execPath, args: [cli, ...args], shell: false };
  return binSpawn(process.platform === 'win32' ? 'npx.cmd' : 'npx', args);
}
