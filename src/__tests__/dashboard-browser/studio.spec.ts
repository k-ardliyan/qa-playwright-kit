import { test, expect, type Page } from '@playwright/test';
import { buildRequirementMarkdown } from '../../cli/routes/studio';

/**
 * Studio browser suite — boots the real dashboard HTTP server (webServer in
 * config/playwright/dashboard.ts, baseURL http://127.0.0.1:4567) and drives
 * the live /studio page rendered by src/cli/routes/studio.ts.
 *
 * Deliberately never clicks #runbtn (would spawn a real Playwright child
 * inside the test) nor #authbtn (would spawn a headed auth refresh).
 */

async function gotoStudio(page: Page): Promise<void> {
  await page.goto('/studio');
  await page.waitForLoadState('domcontentloaded');
}

/**
 * Every control on /studio is bound by one inline `<script>`. If it dies on a
 * parse error the page still answers 200 with the full markup, so a
 * markup-only assertion stays green while the page is completely dead. This
 * helper makes that failure visible: it fails on any page error, and on a
 * console error, after the given assertion has proven the script actually ran.
 */
async function expectCleanLoad(page: Page, run: () => Promise<void>): Promise<void> {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text());
  });

  await gotoStudio(page);
  await run();
  expect(pageErrors, 'page threw during load').toEqual([]);
  expect(consoleErrors, 'console errors during load').toEqual([]);
}

test.describe('studio page: form + requirement preview', () => {
  test('renders the Web Studio shell and every requirement input', async ({ page }) => {
    await expectCleanLoad(page, async () => {
      await expect(page.locator('h1')).toContainText('Web Studio');

      for (const id of [
        'slug',
        'title',
        'module',
        'feature',
        'authState',
        'halamanAwal',
        'scenarioTitle',
        'steps',
        'expected',
      ]) {
        await expect(page.locator(`#${id}`)).toBeVisible();
      }
    });
  });

  test('typing slug + title re-renders the markdown preview', async ({ page }) => {
    await gotoStudio(page);
    const preview = page.locator('#preview');
    await expect(preview).toBeVisible();

    await page.locator('#slug').fill('studio-preview-probe');
    await page.locator('#title').fill('Studio Preview Probe');
    // The page re-renders on 'input'; no sleeps, just expect polling.
    await expect(preview).toContainText('# REQ-XXX: Studio Preview Probe');
    await expect(preview).toContainText('**Feature:** studio-preview-probe');
    await expect(preview).toContainText('## Skenario Uji');
  });

  test('Tambah skenario appends a block and the preview matches the server builder', async ({
    page,
  }) => {
    await gotoStudio(page);
    await page.locator('#slug').fill('studio-multi');
    await page.locator('#scenarioTitle').fill('User opens login');
    await page.locator('#steps').fill('Buka halaman login');
    await page.locator('#expected').fill('Halaman login tampil');

    const blocks = page.locator('.scenario');
    await page.locator('#addScenario').click();
    await expect(blocks).toHaveCount(1);
    // The legacy single-scenario inputs are seeded into the first block and hidden.
    await expect(blocks.nth(0).locator('.sc-title')).toHaveValue('User opens login');
    await expect(page.locator('#legacy')).toBeHidden();
    await blocks.nth(0).locator('.sc-title').fill('User submits wrong password');
    await blocks.nth(0).locator('.sc-steps').fill('Isi password salah\nKlik submit');
    await blocks.nth(0).locator('.sc-expected').fill('Pesan error tampil');

    await page.locator('#addScenario').click();
    await expect(blocks).toHaveCount(2);

    const preview = await page.locator('#preview').textContent();
    expect(preview).toContain('### SC-01: User submits wrong password (@success)');
    expect(preview).toContain('### SC-02: studio-multi (@success)');
    expect(preview).toContain('- **Test ID:** TC-02');

    // Client builder must equal the server builder for the same input.
    const server = buildRequirementMarkdown({
      slug: 'studio-multi',
      title: '',
      module: '',
      feature: '',
      authState: 'authenticated',
      halamanAwal: '/',
      scenarioTitle: 'User opens login',
      steps: 'Buka halaman login',
      expected: 'Halaman login tampil',
      scenarios: [
        {
          title: 'User submits wrong password',
          steps: 'Isi password salah\nKlik submit',
          expected: 'Pesan error tampil',
        },
        { title: '', steps: '', expected: '' },
      ],
    });
    expect(preview).toBe(server);
  });
});

test.describe('studio page: auth + run controls', () => {
  test('environment select carries all four appEnv options', async ({ page }) => {
    await gotoStudio(page);
    await expect(page.locator('#envbtn')).toBeVisible();
    await expect(page.locator('#authbtn')).toBeVisible();

    const options = page.locator('#appenv option');
    await expect(options).toHaveText(['local', 'dev', 'staging', 'production']);
  });

  test('#speclist renders spec options from the API', async ({ page }) => {
    await gotoStudio(page);
    await expect(page.locator('#spec')).toBeVisible();
    await expect
      .poll(() => page.locator('#speclist option').count(), { timeout: 10_000 })
      .toBeGreaterThan(1);
    await expect(page.locator('#speclist option').nth(1)).toHaveText(/\.spec\.ts$/);
  });
});

test.describe('studio API contract (through the browser context)', () => {
  test('/api/studio/specs answers 200 with an array', async ({ page }) => {
    await gotoStudio(page);
    const res = await page.request.get('/api/studio/specs');
    expect(res.status()).toBe(200);
    const body = (await res.json()) as { specs?: string[] };
    expect(Array.isArray(body.specs)).toBe(true);
  });

  test('/api/studio/run refuses a spec path outside tests/', async ({ page }) => {
    await gotoStudio(page);
    const res = await page.request.post('/api/studio/run', {
      data: { spec: '../../etc/passwd' },
    });
    expect(res.status()).toBe(409);
    expect(await res.text()).toContain('not allowed');
  });
});
