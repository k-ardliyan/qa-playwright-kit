import { test, expect } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import * as path from 'node:path';
import { EXIT } from '../../scripts/exit-codes';

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const validateReqCli = path.join(repoRoot, 'tools', 'validators', 'validate-requirement.ts');
const tsxBin = path.join(repoRoot, 'node_modules', '.bin', 'tsx');

test.describe('validate-requirement CLI contract', () => {
  test('no args in non-interactive mode exits with USAGE (never hangs on TTY picker)', () => {
    const res = spawnSync(tsxBin, [validateReqCli], {
      cwd: repoRoot,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: true,
    });

    expect(res.status).toBe(EXIT.USAGE);
    const output = (res.stdout ?? '') + (res.stderr ?? '');
    expect(output).toContain('Argumen requirement file tidak ada');
  });

  test('validates existing sample requirement file successfully', () => {
    const res = spawnSync(tsxBin, [validateReqCli, 'requirements/auth/login-none.md'], {
      cwd: repoRoot,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: true,
    });

    expect(res.status).toBe(EXIT.OK);
    const output = (res.stdout ?? '') + (res.stderr ?? '');
    expect(output).toContain('Score: 100/100');
  });
});
