import { type ChildProcess, spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { existsSync } from 'node:fs';
import path from 'node:path';
import {
  playwrightSpawn,
  killTree,
  treeSpawnOptions,
  claimStudioChild,
  releaseStudioChild,
} from './spawn-playwright';
import { findRepoRoot } from '../shared/workspace-paths';

/** Resolved once: the server may be launched from a subdirectory (e.g. config/). */
const REPO_ROOT = findRepoRoot();
const SPEC_RE = /^tests\/[a-zA-Z0-9_./-]+\.spec\.ts$/;

let current: ChildProcess | null = null;

export function isAllowedSpec(specPath: string): boolean {
  if (!SPEC_RE.test(specPath)) return false;
  const abs = path.resolve(REPO_ROOT, specPath);
  const rel = path.relative(path.join(REPO_ROOT, 'tests'), abs);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

export function startStudioRun(
  specPath: string,
  emit: (event: string, data: unknown) => void,
): { ok: true } | { ok: false; error: string } {
  if (current) return { ok: false, error: 'run already active' };
  if (!isAllowedSpec(specPath)) return { ok: false, error: 'spec path not allowed' };
  if (!existsSync(path.resolve(REPO_ROOT, specPath))) return { ok: false, error: 'spec not found' };

  // No --reporter flag: the configured tuple (list, json, html, custom-reporter)
  // must run, or the run produces no test-summary.json and /export/portable 404s.
  const spawnSpec = playwrightSpawn(REPO_ROOT, ['test', specPath]);
  const child = spawn(spawnSpec.command, spawnSpec.args, {
    cwd: REPO_ROOT,
    shell: false,
    windowsHide: true,
    ...treeSpawnOptions(),
  });
  current = child;
  // Shared slot: refuse if an auth refresh already owns the Playwright child.
  if (!claimStudioChild(child)) {
    current = null;
    killTree(child);
    return { ok: false, error: 'auth refresh is running' };
  }

  const pipe = (stream: NodeJS.ReadableStream | null) => {
    if (!stream) return;
    createInterface({ input: stream }).on('line', (line) => emit('run-log', { line }));
  };
  pipe(child.stdout);
  pipe(child.stderr);

  child.on('error', (err) => emit('run-log', { line: err.message }));
  child.on('close', (code) => {
    releaseStudioChild(child);
    if (current === child) current = null;
    emit('run-done', { code });
  });

  return { ok: true };
}

export function stopStudioRun(): boolean {
  if (!current) return false;
  killTree(current);
  return true;
}

/** True while a spec child is alive — the dashboard watchdog must not shut down. */
export function isStudioRunActive(): boolean {
  return current !== null;
}
