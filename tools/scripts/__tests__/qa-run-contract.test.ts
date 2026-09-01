import { test, expect } from '@playwright/test';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { EXIT } from '../exit-codes';

test.describe('Harness qa:run Contract & Typed Validation (Phase 5)', () => {
  const repoRoot = path.resolve(__dirname, '../../../');
  const qaRunBin = path.join(repoRoot, 'tools', 'scripts', 'qa-run.ts');
  const tsxBin = path.join(repoRoot, 'node_modules', '.bin', 'tsx');

  test('validates requirement directly via in-process contract validator on --dry-run', () => {
    const result = spawnSync(
      tsxBin,
      [qaRunBin, 'requirements/auth/login-none.md', '--dry-run', '--no-open-dashboard'],
      {
        cwd: repoRoot,
        encoding: 'utf-8',
        shell: true,
      },
    );

    expect(result.status).toBe(EXIT.OK);
    expect(result.stdout).toContain('Requirement valid');
    expect(result.stdout).toContain('score');
  });

  test('fails cleanly with exit code on invalid requirement during dry run', () => {
    const result = spawnSync(
      tsxBin,
      [qaRunBin, 'requirements/_BAD_EXAMPLE.md', '--dry-run', '--no-open-dashboard'],
      {
        cwd: repoRoot,
        encoding: 'utf-8',
        shell: true,
      },
    );

    expect(result.status).toBe(EXIT.FIXABLE);
    const combinedOutput = (result.stdout ?? '') + '\n' + (result.stderr ?? '');
    expect(combinedOutput).toContain('Score: 0/100');
  });
});
