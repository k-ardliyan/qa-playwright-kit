import { test, expect } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { EXIT } from '../exit-codes';

test.describe('Harness qa:run Contract & Typed Validation (Phase 5)', () => {
  const repoRoot = path.resolve(__dirname, '../../../');
  const qaRunBin = path.join(repoRoot, 'tools', 'scripts', 'qa-run.ts');
  const tsxBin = path.join(repoRoot, 'node_modules', '.bin', 'tsx');
  // These tests exercise the REQUIREMENT-validation contract of qa:run --dry-run,
  // not the preflight credential gate. Spawn with a clean env-derived APP_ENV:
  // sibling unit tests mutate process.env.APP_ENV (e.g. env-edit-lib) without
  // restoring it in every path, and the subprocess would inherit that leak —
  // resolving to an env whose credentials may be placeholders and failing
  // preflight before requirement validation runs.
  const spawnEnv = { ...process.env, APP_ENV: process.env.APP_ENV ?? 'dev' };

  test('validates requirement directly via in-process contract validator on --dry-run', () => {
    const result = spawnSync(
      tsxBin,
      [qaRunBin, 'requirements/auth/login-none.md', '--dry-run', '--no-open-dashboard'],
      {
        cwd: repoRoot,
        encoding: 'utf-8',
        shell: true,
        env: spawnEnv,
      },
    );

    expect(result.status).toBe(EXIT.OK);
    expect(result.stdout).toContain('Requirement valid');
    expect(result.stdout).toContain('score');
  });

  test('fails cleanly with exit code on invalid requirement during dry run', () => {
    // Temp requirement inside requirements/ (qa:run resolves against the repo
    // allowlist). A test must never depend on a documentation file.
    const stamp = `tmp-qa-run-bad-${process.pid}-${Date.now()}`;
    const relPath = `requirements/${stamp}.md`;
    const absPath = path.join(repoRoot, relPath);
    fs.writeFileSync(
      absPath,
      [
        '# Tanpa Prefix REQ',
        '',
        '## Metadata',
        '',
        '| Field | Nilai |',
        '| --- | --- |',
        '| Tags |  |',
        '| Prioritas |  |',
        '| Auth state |  |',
        '| Halaman awal |  |',
        '',
        '## Kriteria Penerimaan',
        '',
        '| ID | Kriteria |',
        '| --- | --- |',
        '|  | Login harus bekerja |',
        '',
        '## Skenario Uji',
        '',
        '### SC-01: Login',
        '',
        '| Field | Nilai |',
        '| --- | --- |',
        '| Covers | `AC-99` |',
        '| Langkah | 1. Coba login |',
        '| Hasil | Berhasil |',
        '',
      ].join('\n'),
    );

    try {
      const result = spawnSync(tsxBin, [qaRunBin, relPath, '--dry-run', '--no-open-dashboard'], {
        cwd: repoRoot,
        encoding: 'utf-8',
        shell: true,
        env: spawnEnv,
      });

      expect(result.status).toBe(EXIT.FIXABLE);
      const combinedOutput = (result.stdout ?? '') + '\n' + (result.stderr ?? '');
      expect(combinedOutput).toContain('Score: 0/100');
    } finally {
      fs.rmSync(absPath, { force: true });
    }
  });
});
