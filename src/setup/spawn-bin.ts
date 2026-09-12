/**
 * Setup Wizard — cross-platform spawn primitives.
 *
 * Node ≥ 18.20 / 20.12 refuses to spawn `.cmd` / `.bat` without a shell
 * (CVE-2024-27980 hardening). Spawning `npm.cmd` with `shell: false` fails
 * with EINVAL and `status === null` — a silent, Windows-only failure that the
 * wizard used to report as "exit code null". Every wizard spawn goes through
 * here so that class cannot come back.
 *
 * @module src/setup/spawn-bin
 */

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
