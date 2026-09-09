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

test.describe('P3 additions: health panels, triage, deep-links', () => {
  test('overview shows the failure-source mix and module health panels', async ({ page }) => {
    await gotoHash(page, '/');
    await expect(page.locator('body')).toContainText('Failure Source Mix');
    await expect(page.locator('.mix-bar')).toBeAttached();
    await expect(page.locator('body')).toContainText('Module Health');
    // Seed data: auth module exists in latest + archived runs.
    await expect(page.locator('.module-health-row').first()).toBeVisible();
  });

  test('latest detail page shows the triage strip for the failing run', async ({ page }) => {
    await page.goto('/latest');
    await page.waitForLoadState('domcontentloaded');
    // Seeded latest run has 1 failed test (wrong password).
    await expect(page.locator('.triage-strip')).toBeVisible();
    await expect(page.locator('.triage-group').first()).toBeVisible();
    // Suggested-decision button is present and wired to applyTriageDecision.
    const btn = page.locator('.triage-set-decision').first();
    await expect(btn).toBeVisible();
    expect(await btn.getAttribute('data-triage-decision')).toBeTruthy();
  });

  test('/history?decision=APPROVE deep-link preselects the filter', async ({ page }) => {
    await page.goto('/history?decision=APPROVE');
    await page.waitForLoadState('domcontentloaded');
    // Toolbar select is preselected.
    const decision = page.locator('#filter-history-decision');
    await expect(decision).toHaveValue('APPROVE');
    // Only the APPROVE row remains visible after the on-load filter.
    const visibleRows = page.locator('.history-row:visible');
    await expect(visibleRows).toHaveCount(1);
    await expect(visibleRows.first()).toContainText('APPROVE');
  });

  test('/latest?view=accordion deep-link activates the accordion server-side', async ({ page }) => {
    await page.goto('/latest?view=accordion');
    await page.waitForLoadState('domcontentloaded');
    const accordion = page.locator('#view-accordion');
    await expect(accordion).toHaveClass(/view-panel--active/);
    const table = page.locator('#view-table');
    await expect(table).toHaveClass(/view-panel--hidden/);
  });

  test('/latest?test=<id> deep-link opens the matching test card', async ({ page }) => {
    // Seeded failing test id in the latest run.
    await page.goto('/latest?test=SC-L2&view=accordion');
    await page.waitForLoadState('domcontentloaded');
    const card = page.locator('details#test-SC-L2');
    await expect(card).toBeAttached();
    await expect(card).toHaveAttribute('open', '');
  });

  test('/latest?test=<unknown-id> does not break the page', async ({ page }) => {
    const res = await page.goto('/latest?test=NOPE-404&view=accordion');
    expect(res?.status()).toBe(200);
    const card = page.locator('details#test-NOPE-404');
    await expect(card).toHaveCount(0);
  });
});
