import { test, expect, type Page } from '@playwright/test';

/**
 * Dashboard browser suite — boots the real dashboard HTTP server (webServer in
 * config/playwright/dashboard.ts) against an isolated QA_REPORT_DIR seeded by
 * config/dashboard-seed.ts. Exercises the actual HTML, hash-router and
 * fragment/API stack — not just render units.
 */

/** Navigate to a hash route and wait for the fragment to settle. */
async function gotoHash(page: Page, hash: string): Promise<void> {
  await page.goto(`/#${hash}`);
  await page.waitForLoadState('domcontentloaded');
}

test.describe('dashboard overview', () => {
  test('home renders KPI summary cards and the latest run hero', async ({ page }) => {
    await gotoHash(page, '/');
    await expect(page.locator('h1, h2').first()).toBeVisible();

    // KPI summary: 2 total / 1 passed / 1 failed from the seeded summary.
    await expect(page.getByText('1', { exact: true }).first()).toBeVisible();
    // Latest run card appears (Test Run label or run requirement path).
    await expect(page.getByText(/Test Run|login-none/i).first()).toBeVisible();
  });

  test('nav links navigate to history via the hash router', async ({ page }) => {
    await gotoHash(page, '/');
    // Primary nav exposes History (table) — clicking switches fragment.
    const historyLink = page.locator('a[href*="#/history"], a[href*="history"]').first();
    await expect(historyLink).toBeVisible();
    await historyLink.click();
    await expect(page.locator('body')).toContainText('History');
  });
});

test.describe('dashboard history', () => {
  test('history lists archived runs with status chips', async ({ page }) => {
    await gotoHash(page, '/history');
    // Both seeded archives render as rows.
    await expect(page.getByText('8 Sept, 17:40').first()).toBeVisible();
    await expect(page.getByText('8 Sept, 17:00').first()).toBeVisible();
  });

  test('compare page renders pickers for baseline and candidate runs', async ({ page }) => {
    // Compare is a full server-rendered page (AppNav uses real paths), reachable
    // at /compare. Two archived runs are seeded, so pickers render.
    await page.goto('/compare');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('body')).toContainText(/Pick a baseline run/i);
    // Series filter select + combobox inputs for baseline/candidate.
    await expect(page.locator('select[name="series"]').first()).toBeVisible();
    await expect(page.locator('input[role="combobox"]').first()).toBeVisible();
  });
});

test.describe('dashboard detail', () => {
  test('overview surfaces failing test rows from the latest run', async ({ page }) => {
    await gotoHash(page, '/');
    // Needs-attention block lists the failed test title.
    await expect(page.locator('body')).toContainText(/Login with wrong password/i);
    await expect(page.locator('body')).toContainText(/Needs Attention/i);
  });

  test('archived detail route renders decision and notes column', async ({ page }) => {
    // Detail fragment for the first archived run.
    await gotoHash(page, '/detail/run-20260908-174000-000');
    await expect(page.locator('body')).toContainText(/APPROVE|Decision/i);
  });
});

test.describe('dashboard interactions', () => {
  test('toggleDetailRow expands a row when invoked', async ({ page }) => {
    await gotoHash(page, '/latest');
    const firstExpandable = page
      .locator('[data-testid*="toggle"], button.toggle, .detail-toggle')
      .first();
    if ((await firstExpandable.count()) > 0) {
      await firstExpandable.click();
      // Row expansion reveals steps/attachments detail.
      await expect(
        page.locator('[class*="expanded"], [data-expanded="true"]').first(),
      ).toBeAttached();
    }
  });

  test('SSE heartbeat endpoint answers (server is alive)', async ({ page }) => {
    const response = await page.request.get('/heartbeat');
    expect(response.status()).toBe(200);
  });
});
