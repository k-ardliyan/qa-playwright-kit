import { test, expect } from '@playwright/test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { validateSpecFile } from '../../../tools/mcp/src/tools/validate-generated-tests';

/**
 * Replay of the real tes-qa failure (sanitized): a QA-instance spec generated
 * on the pre-doctrine engine shipped 23 `test.skip(true, ...)` in one file,
 * copy-pasted header checks in filter/pagination scenarios, capture-only
 * bodies, and metadata-less tests — and every validator gate passed it.
 *
 * This file is the guard that must KEEP failing on that shape: if any of these
 * assertions start failing because a rule was loosened, the tes-qa failure
 * ships again. The healthy control mirrors the login spec shape that always
 * worked, proving the rules reject the pattern, not the feature.
 */

const BROKEN_SPEC = [
  '// spec: specs/payroll-process-test-plan.md',
  '// seed: tests/seed.spec.ts',
  '// req: requirements/hris/payroll/payroll-process.md',
  "import { test, expect } from '@/fixtures/base.fixture';",
  "import { setTestMetadata, captureActualResult } from '@/support/test-metadata';",
  '',
  "test.describe('Proses Penggajian', { tag: ['@hris', '@payroll'] }, () => {",
  "  test.describe.configure({ mode: 'serial' });",
  '',
  "  test('SC-01: Akses Halaman Proses Penggajian', async ({ page }) => {",
  "    setTestMetadata({ testId: 'TC-001', scenarioId: 'SC-01', module: 'hris', feature: 'payroll-process' });",
  "    await test.step('Buka halaman', async () => {",
  "      await page.goto('/hris/payroll-process');",
  '    });',
  "    await expect(page.getByRole('heading', { name: 'Proses Penggajian' })).toBeVisible();",
  "    await expect(page.getByRole('button', { name: 'Filter' })).toBeVisible();",
  '  });',
  '',
  "  test('SC-03: Buka Payroll Draft dan Lihat Langkah Proses', async ({ page }) => {",
  "    setTestMetadata({ testId: 'TC-003', scenarioId: 'SC-03', module: 'hris', feature: 'payroll-process' });",
  '',
  "    test.skip(true, 'UI belum dieksplorasi (form/dialog/stepper belum ada di selector catalog) — Explore lanjutan diperlukan');",
  '  });',
  '',
  "  test('SC-05: Bayar Satu Karyawan Menghasilkan Slip', async ({ page }) => {",
  "    await test.step('Buka daftar', async () => {",
  "      await page.goto('/hris/payroll-process');",
  '    });',
  "    await expect(page.getByText('Dibayar').first()).toBeVisible();",
  '  });',
  '',
  "  test('SC-08: Filter Daftar Proses Penggajian', async ({ page }) => {",
  "    setTestMetadata({ testId: 'TC-008', scenarioId: 'SC-08', module: 'hris', feature: 'payroll-process' });",
  "    await test.step('Buka halaman', async () => {",
  "      await page.goto('/hris/payroll-process');",
  '    });',
  "    await expect(page.getByRole('heading', { name: 'Proses Penggajian' })).toBeVisible();",
  "    await expect(page.getByRole('button', { name: 'Filter' })).toBeVisible();",
  "    captureActualResult('Daftar hanya menampilkan payroll yang cocok.');",
  '  });',
  '',
  "  test('SC-14: Payroll Dibayar Tidak Dapat Dihapus', async ({ page }) => {",
  "    setTestMetadata({ testId: 'TC-014', scenarioId: 'SC-14', module: 'hris', feature: 'payroll-process' });",
  "    await test.step('Buka detail payroll Dibayar', async () => {",
  "      await page.goto('/hris/payroll-process');",
  "      const paid = page.getByText('Dibayar').first();",
  '      if ((await paid.count()) === 0) {',
  "        captureActualResult('Belum ada payroll Dibayar — prasyarat tidak tersedia saat run ini.');",
  '        return;',
  '      }',
  '      await paid.click();',
  '    });',
  "    captureActualResult('Tombol Hapus Payroll tidak tersedia pada payroll Dibayar.');",
  '  });',
  '});',
].join('\n');

const HEALTHY_SPEC = [
  '// spec: specs/login-test-plan.md',
  '// seed: tests/seed.spec.ts',
  '// req: requirements/auth/login.md',
  "import { test, expect } from '@/fixtures/base.fixture';",
  "import { setTestMetadata } from '@/support/test-metadata';",
  '',
  "test.describe('Login', { tag: ['@auth'] }, () => {",
  "  test('SC-01: Login Sukses', async ({ page }) => {",
  "    setTestMetadata({ testId: 'TC-001', scenarioId: 'SC-01', module: 'auth', feature: 'login' });",
  "    await test.step('Buka halaman login', async () => {",
  "      await page.goto('/login');",
  '    });',
  "    await expect(page.getByRole('heading', { name: 'Masuk' })).toBeVisible();",
  '    await expect(page).toHaveURL(/login/);',
  '  });',
  "  test('SC-02: Menu Tampil Setelah Login', async ({ page }) => {",
  "    setTestMetadata({ testId: 'TC-002', scenarioId: 'SC-02', module: 'auth', feature: 'login' });",
  "    await test.step('Buka dashboard', async () => {",
  "      await page.goto('/dashboard');",
  '    });',
  "    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();",
  '  });',
  '});',
].join('\n');

function writeSpec(dir: string, name: string, body: string): string {
  const testsDir = path.join(dir, 'tests');
  fs.mkdirSync(testsDir, { recursive: true });
  const filePath = path.join(testsDir, name);
  fs.writeFileSync(filePath, body, 'utf-8');
  return filePath;
}

test.describe('tes-qa replay: validator rejects the pre-doctrine failure shape', () => {
  let repo: string;

  test.beforeEach(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), 'tes-qa-replay-'));
  });

  test.afterEach(() => {
    fs.rmSync(repo, { recursive: true, force: true });
  });

  test('the sanitized broken spec trips the per-test, skip-doctrine, and metadata rules', () => {
    const filePath = writeSpec(repo, 'payroll-process.spec.ts', BROKEN_SPEC);
    const violations = validateSpecFile(filePath, 'tests/payroll-process.spec.ts', repo);

    const errors = violations.filter((v) => (v.severity ?? 'error') === 'error');
    const ruleNames = errors.map((v) => v.ruleName);

    // SC-14: capture-only body, zero expect — the file-level rule used to pass
    // this because SC-01 asserted.
    expect(ruleNames.some((r) => r.includes('per test') && r.includes('SC-14'))).toBe(true);
    // SC-03: permanent skip burying unbuilt work in the grey bucket.
    expect(
      ruleNames.some((r) => r.startsWith('Skip doctrine rule') && r.includes('test.fixme')),
    ).toBe(true);
    // SC-05: metadata-less test inside a file that has plenty of calls.
    expect(ruleNames.some((r) => r.includes('Metadata rule') && r.includes('SC-05'))).toBe(true);

    expect(errors.length).toBe(3);

    // SC-08: copy-pasted SC-01 header checks, differing only in capture prose.
    const warnings = violations.filter((v) => v.severity === 'warning');
    const dup = warnings.find((v) => v.ruleName.startsWith('Duplicate body rule'));
    expect(dup).toBeDefined();
    expect(dup?.ruleName).toContain('SC-08');
    expect(dup?.ruleName).toContain('SC-01');
  });

  test('the healthy control spec (login shape) passes with zero violations', () => {
    const filePath = writeSpec(repo, 'login-user.spec.ts', HEALTHY_SPEC);
    const violations = validateSpecFile(filePath, 'tests/login-user.spec.ts', repo);
    expect(violations).toEqual([]);
  });
});
