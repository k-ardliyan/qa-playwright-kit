import { test, expect } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import * as path from 'node:path';
import { EXIT } from '../exit-codes';

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const envUseCli = path.join(repoRoot, 'tools', 'scripts', 'env-use.ts');
const tsxBin = path.join(repoRoot, 'node_modules', '.bin', 'tsx');

test.describe('env-use CLI contract & non-interactive behavior', () => {
  test('no args in non-interactive mode exits with USAGE (never hangs on TTY picker)', () => {
    const res = spawnSync(tsxBin, [envUseCli], {
      cwd: repoRoot,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: true,
    });

    expect(res.status).toBe(EXIT.USAGE);
    expect((res.stdout ?? '') + (res.stderr ?? '')).toContain('env:use');
  });

  test('--help exits with OK', () => {
    const res = spawnSync(tsxBin, [envUseCli, '--help'], {
      cwd: repoRoot,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: true,
    });

    expect(res.status).toBe(EXIT.OK);
    expect(res.stdout).toContain('env:use — Pin active environment profile');
  });

  test('unknown environment exits with USAGE', () => {
    const res = spawnSync(tsxBin, [envUseCli, 'invalid_env_name'], {
      cwd: repoRoot,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: true,
    });

    expect(res.status).toBe(EXIT.USAGE);
    const output = (res.stdout ?? '') + (res.stderr ?? '');
    expect(output).toContain('Unknown environment');
  });

  test('production pin without --i-know is blocked with USAGE', () => {
    const res = spawnSync(tsxBin, [envUseCli, 'production'], {
      cwd: repoRoot,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: true,
    });

    expect(res.status).toBe(EXIT.USAGE);
    const output = (res.stdout ?? '') + (res.stderr ?? '');
    expect(output).toContain('Production pin blocked');
  });
});
