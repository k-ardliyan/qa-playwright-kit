import { type ChildProcess, spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  playwrightSpawn,
  killTree,
  treeSpawnOptions,
  claimStudioChild,
  releaseStudioChild,
} from './spawn-playwright';
import { findRepoRoot } from '../shared/workspace-paths';
import { upsertEnvContent } from '../utils/env-text';
import { type StudioRunSettings, normalizeRunSettings } from './studio-run-settings';

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
  specPath: string | string[],
  emit: (event: string, data: unknown) => void,
  settings?: StudioRunSettings,
): { ok: true } | { ok: false; error: string } {
  if (current) return { ok: false, error: 'run already active' };

  // One or many specs — every path goes through the same sandbox check.
  const specs = (Array.isArray(specPath) ? specPath : [specPath]).filter(
    (s): s is string => typeof s === 'string' && s.trim().length > 0,
  );
  if (specs.length === 0) return { ok: false, error: 'no spec selected' };
  for (const spec of specs) {
    if (!isAllowedSpec(spec)) return { ok: false, error: `spec path not allowed: ${spec}` };
    if (!existsSync(path.resolve(REPO_ROOT, spec)))
      return { ok: false, error: `spec not found: ${spec}` };
  }

  // Per-run browser knobs (slow-mo / headless / viewport / serial) merged into
  // the child env + argv only — nothing is written to disk. Invalid values are
  // dropped with a warning line rather than failing the run.
  const { env: runEnv, warnings } = normalizeRunSettings(settings ?? {});

  // No --reporter flag: the configured tuple (list, json, html, custom-reporter)
  // must run, or the run produces no test-summary.json and /export/portable 404s.
  const args = ['test', ...specs];
  if (settings?.serial === true) args.push('--workers=1');
  const spawnSpec = playwrightSpawn(REPO_ROOT, args);
  const child = spawn(spawnSpec.command, spawnSpec.args, {
    cwd: REPO_ROOT,
    shell: false,
    windowsHide: true,
    env: Object.keys(runEnv).length > 0 ? { ...process.env, ...runEnv } : process.env,
    ...treeSpawnOptions(),
  });
  current = child;
  // Shared slot: refuse if an auth refresh already owns the Playwright child.
  if (!claimStudioChild(child)) {
    current = null;
    killTree(child);
    return { ok: false, error: 'auth refresh is running' };
  }

  for (const warning of warnings) emit('run-log', { line: `⚠ ${warning}` });
  if (Object.keys(runEnv).length > 0) {
    const shown = Object.entries(runEnv)
      .map(([k, v]) => `${k}=${v}`)
      .join(' ');
    emit('run-log', { line: `▶ Menjalankan dengan ${shown}` });
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

/**
 * Persist run knobs (slow-mo / headless / viewport) into the active env file so
 * they apply to future runs and the CLI too. Uses the same per-key upsert the
 * wizard/env:edit use — keys are replaced in place, everything else untouched.
 */
export function persistRunSettings(
  settings: StudioRunSettings,
  appEnv: string,
): { ok: true; keys: string[]; warnings: string[] } | { ok: false; error: string } {
  const { env: upserts, warnings } = normalizeRunSettings(settings);
  const keys = Object.keys(upserts);
  if (keys.length === 0) {
    return { ok: false, error: 'tidak ada setelan valid untuk disimpan' };
  }
  const envPath = path.join(REPO_ROOT, 'config', 'environments', `${appEnv}.env`);
  if (!existsSync(envPath)) {
    return { ok: false, error: `file env tidak ditemukan: config/environments/${appEnv}.env` };
  }
  try {
    const content = readFileSync(envPath, 'utf-8');
    const next = upsertEnvContent(content, upserts);
    writeFileSync(envPath, next, 'utf-8');
    return { ok: true, keys, warnings };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
