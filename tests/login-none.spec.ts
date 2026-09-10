// spec: tests/login-none.spec.ts
// seed: tests/seed.spec.ts
// plan: specs/login-none-test-plan.md
// req: requirements/auth/login-none.md
import { test, expect } from '@/fixtures/base.fixture';
import { authStatePath } from '@/support/auth-paths';
import { setTestMetadata, captureActualResult } from '@/support/test-metadata';

/**
 * login-none — manual-path dogfood spec (semantic workflow run probe-manual-004).
 * Plan: specs/login-none-test-plan.md · Requirement: requirements/auth/login-none.md
 *
 * The login steps ARE the test subject here (@auth requirement), so this spec
 * runs UNAUTHENTICATED (login: 'unauthenticated' — fresh context, no
 * storageState) and performs the real UI login inside the tests.
 * Focused smoke subset: SC-07 (happy path) + SC-14 (protected redirect).
 */

test.describe('Login — none', () => {
  test.describe.configure({ mode: 'serial' });
  test.use({ storageState: { cookies: [], origins: [] } });

  test('TC-LOGIN-007: SC-07: Login Berhasil dengan Kredensial Valid', async ({ page }) => {
    setTestMetadata({
      testId: 'TC-LOGIN-007',
      scenarioId: 'SC-07',
      priority: 'HIGH',
      expectedResult:
        'URL pathname mengandung /dashboard dan tidak mengandung /login; form login tidak terlihat lagi',
      inputData: { identifier: 'valid', password: 'valid' },
      role: 'user',
      affectedLayer: ['FE', 'BE'],
    });

    await test.step('Buka halaman login', async () => {
      await page.goto('/login');
      await expect(page.getByRole('textbox', { name: 'Enter username' })).toBeVisible();
    });

    await test.step('Isi kredensial valid dan submit', async () => {
      await page
        .getByRole('textbox', { name: 'Enter username' })
        .fill(process.env.TEST_USER_USERNAME || process.env.TEST_USER_EMAIL || '');
      await page
        .getByRole('textbox', { name: 'Enter password' })
        .fill(process.env.TEST_USER_PASSWORD || '');
      await page.getByRole('button', { name: 'Login' }).click();
      await expect(page).not.toHaveURL(/\/login(\?|$)/, { timeout: 20_000 });
    });

    await test.step('Assert redirect ke /dashboard', async () => {
      await expect(page).toHaveURL(/dashboard/i);
    });

    captureActualResult('URL di /dashboard, form login tidak terlihat');
  });

  test('TC-LOGIN-014: SC-14: Akses Halaman Protected Tanpa Login Mengarahkan ke Login', async ({
    page,
    browser,
  }) => {
    setTestMetadata({
      testId: 'TC-LOGIN-014',
      scenarioId: 'SC-14',
      priority: 'HIGH',
      expectedResult: 'Diarahkan ke /login tanpa menampilkan konten protected',
      role: 'user',
      affectedLayer: ['FE', 'BE'],
    });

    // Fresh context with NO storage at all (localStorage JWT included) —
    // clearCookies() alone leaves SPA tokens in localStorage.
    const freshContext = await browser.newContext();
    const freshPage = await freshContext.newPage();

    await test.step('Akses protected page tanpa sesi', async () => {
      await freshPage.goto('/dashboard');
    });

    await test.step('Assert diarahkan ke /login', async () => {
      await expect(freshPage).toHaveURL(/login/i, { timeout: 20_000 });
    });

    await freshContext.close();
    captureActualResult('Diarahkan ke /login tanpa konten protected');
  });
});
