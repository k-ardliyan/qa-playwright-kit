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
