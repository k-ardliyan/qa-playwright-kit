import { type ChildProcess, spawn } from 'node:child_process';
import {
  playwrightSpawn,
  killTree,
  treeSpawnOptions,
  claimStudioChild,
  releaseStudioChild,
} from './spawn-playwright';
import { findRepoRoot } from '../shared/workspace-paths';

let current: ChildProcess | null = null;
let lastCode: number | null = null;

/** argv for the Playwright auth setup project. Headed adds `--headed`. */
export function authArgs(headed: boolean): string[] {
  return [
    'test',
    'tests/auth.setup.ts',
    '--project=setup',
    '--workers=1',
    ...(headed ? ['--headed'] : []),
  ];
}

export function authRefreshState(): { running: boolean; lastCode: number | null } {
  return { running: current !== null, lastCode };
}

export function startAuthRefresh(headed: boolean): { ok: true } | { ok: false; error: string } {
  if (current) return { ok: false, error: 'auth already running' };

  const root = findRepoRoot();
  const spawnSpec = playwrightSpawn(root, authArgs(headed));
  const child = spawn(spawnSpec.command, spawnSpec.args, {
    cwd: root,
    shell: false,
    windowsHide: true,
    ...treeSpawnOptions(),
  });
  // Shared slot: a spec run must not start while auth is rewriting .auth/.
  if (!claimStudioChild(child)) {
    killTree(child);
    return { ok: false, error: 'a test run is already active' };
  }
  current = child;
  // ponytail: stdout/stderr not piped — auth logs can carry credentials
  child.on('close', (code) => {
    releaseStudioChild(child);
    if (current !== child) return;
    lastCode = code;
    current = null;
  });
  child.on('error', () => {
    releaseStudioChild(child);
    if (current !== child) return;
    lastCode = -1;
    current = null;
  });

  return { ok: true };
}
