/**
 * Cross-platform spawn of the local Playwright CLI.
 *
 * Node ≥ 18.20 / 20.12 refuses to spawn `.cmd` / `.bat` without a shell
 * (CVE-2024-27980 hardening): `spawn('npx.cmd', …, { shell: false })` fails
 * with EINVAL. Routing through `process.execPath` + the local entry point
 * keeps `shell: false` (no interpolation) and works on every platform.
 *
 * @module src/cli/spawn-playwright
 */

import * as path from 'node:path';
import { type ChildProcess, spawnSync } from 'node:child_process';

export interface PlaywrightSpawn {
  command: string;
  args: string[];
  shell: false;
}

/** Absolute path to the local Playwright test CLI entry. */
export function playwrightCliPath(repoRoot: string): string {
  return path.join(repoRoot, 'node_modules', '@playwright', 'test', 'cli.js');
}

/** Spawn descriptor for the local Playwright test CLI. Never uses a shell. */
export function playwrightSpawn(repoRoot: string, args: string[]): PlaywrightSpawn {
  return { command: process.execPath, args: [playwrightCliPath(repoRoot), ...args], shell: false };
}

/**
 * Kill a Playwright child AND its descendants.
 *
 * `child.kill()` only signals the direct process; Playwright workers and the
 * browser they launch survive as orphans and keep holding the port/profile.
 * Windows: `taskkill /T /F` walks the tree. POSIX: the child is spawned as a
 * group leader (`detached`), so signalling the negative pid hits the group.
 */
export function killTree(child: ChildProcess): void {
  const pid = child.pid;
  if (!pid) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true });
    return;
  }
  try {
    process.kill(-pid, 'SIGTERM');
  } catch {
    child.kill();
  }
}

/** Spawn options that make `killTree` able to reach the whole group on POSIX. */
export function treeSpawnOptions(): { detached: boolean } {
  return { detached: process.platform !== 'win32' };
}

/**
 * The single Playwright child slot for the dashboard.
 *
 * A spec run and an auth refresh both spawn Playwright against the same repo,
 * artifacts dir and `.auth/{env}/*.json` files. Two private guards cannot see
 * each other, so both would run at once and corrupt each other's output.
 * Claiming this slot is the one gate both paths route through.
 */
let activeChild: ChildProcess | null = null;

export function claimStudioChild(child: ChildProcess): boolean {
  if (activeChild) return false;
  activeChild = child;
  return true;
}

export function releaseStudioChild(child: ChildProcess): void {
  if (activeChild === child) activeChild = null;
}

export function studioChildRunning(): boolean {
  return activeChild !== null;
}
