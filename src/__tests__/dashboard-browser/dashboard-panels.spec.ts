import { test, expect, type Page } from '@playwright/test';

/**
 * Dashboard browser suite (panels) — complements dashboard.spec.ts with the
 * surfaces the first spec left uncovered: AI Run Insights panel, analysis
 * status banner, quality trend, save modal → archive/save (analysis gate
 * APPROVE + rejection), and the SSE events endpoint.
 *
 * Same bootstrap: webServer boots the real dashboard server against the
 * QA_REPORT_DIR seeded by config/dashboard-seed.ts.
 *
 * Note: the hash router (frag-host, .hash-nav__link) only exists in the
 * static HTML report (components/dashboard/Dashboard.tsx), not in serve mode
 * pages — nav-active-state assertions therefore belong to a static-build test,
 * not this suite.
 */

async function gotoHash(page: Page, hash: string): Promise<void> {
  await page.goto(`/#${hash}`);
  await page.waitForLoadState('domcontentloaded');
}

test.describe('dashboard panels: analysis + AI insights', () => {
  test('analysis banner renders the seeded verdict badge', async ({ page }) => {
    await gotoHash(page, '/');
    await expect(page.locator('.analysis-status-banner')).toBeAttached();
    // The verdict badge renders as an analysis-badge modifier; the seeded
    // verdict is "complete" (LatestRunCard + banner both carry it).
    const badge = page.locator('.analysis-badge--complete').first();
    await expect(badge).toBeVisible();
    await expect(badge).toContainText(/AI ANALYSIS: COMPLETE/i);
    // Verified → the "review gate evidence" warning stays hidden.
    await expect(page.locator('.analysis-status-banner')).not.toContainText(
      /Review gate evidence/i,
    );
  });

  test('AI Run Insights panel lists deterministic and agent-authored insights', async ({
    page,
  }) => {
    await gotoHash(page, '/');
    const panel = page.locator('.ai-insights-panel');
    await expect(panel).toBeVisible();
    await expect(panel).toContainText('AI Run Insights');
    const items = page.locator('.ai-insight-item');
    // Seed provides 1 deterministic (analyzer) + 1 sidecar (reporter) insight.
    await expect(items).toHaveCount(2);
    await expect(items.nth(0)).toContainText(/SC-L2/);
    // Sidecar entry renders agent metadata (source chip + priority).
    await expect(items.nth(1)).toContainText(/SC-L2/);
    await expect(page.locator('.ai-note-src--reporter').first()).toBeVisible();
    await expect(page.locator('.insight-priority--high').first()).toBeVisible();
  });

  test('QualityTrend renders trend points from seeded history', async ({ page }) => {
    await gotoHash(page, '/');
    // Two archived runs feed the trend (heading includes the run count).
    const trendHeading = page.getByRole('heading', { name: /Pass Rate Trend/i });
    await expect(trendHeading).toBeVisible();
    await expect(trendHeading).toContainText(/2 runs/i);
    // Trend chart svg (role=img) + min/max summary from the seeded history.
    await expect(page.locator('.trend-chart-svg').first()).toBeAttached();
    await expect(page.locator('body')).toContainText(/Min: 50% · Max: 100%/);
  });
});

test.describe('dashboard save workflow (analysis gate)', () => {
  test('save modal opens, validates empty decision, and saves with APPROVE', async ({ page }) => {
    await gotoHash(page, '/');
    // Header Save Run button (visible because the latest run is unarchived).
    const saveBtn = page.locator('.btn-save-sm');
    await expect(saveBtn).toBeVisible();
    await saveBtn.click();

    const modal = page.locator('#save-modal');
    await expect(modal).toBeVisible();

    // Submit without a decision → inline validation, no POST.
    await page.locator('#btn-save-confirm').click();
    await expect(page.locator('#save-feedback')).toContainText(/select a QA Decision/i);

    // Fill the form and save. Seeded analysis declaration is complete with a
    // matching sidecar insight, so the APPROVE gate allows the save.
    await page.locator('#save-label').fill('Panels spec save probe');
    await page.locator('#save-decision').selectOption('APPROVE');
    await page.locator('#btn-save-confirm').click();
    await expect(page.locator('#save-feedback')).toContainText(/Saved! Run ID:/, {
      timeout: 10_000,
    });

    // Cleanup: delete the archive this test created so the deterministic seed
    // state survives for the other spec (file ordering is alphabetical).
    const savedRunId = (await page.locator('#save-feedback').textContent()) ?? '';
    const match = savedRunId.match(/run-[\d-]+/);
    expect(match).toBeTruthy();
    const del = await page.request.delete(`/api/archive/${match![0]}`);
    expect(del.status()).toBe(200);
  });

  test('archive/save without analysis evidence rejects APPROVE', async ({ request }) => {
    // No analysis declaration anywhere → gate must refuse APPROVE (the
    // seeded summary was already archived by the previous test, so this probe
    // has no summary at all — still a hard 4xx from the save route).
    const res = await request.post('/api/archive/save', {
      data: { decision: 'APPROVE', label: 'Gate probe run' },
    });
    const body = (await res.json()) as { ok?: boolean; error?: string };
    expect(res.status()).toBeGreaterThanOrEqual(400);
    expect(body.ok).not.toBe(true);
    expect(body.error).toBeTruthy();
  });
});

test.describe('dashboard SSE events', () => {
  test('/events opens an SSE stream (content-type event-stream)', async ({ page }) => {
    // Fetch the stream relative to the page origin via an anchor-free request:
    // goto('/') first so location.origin is a real http origin, then check the
    // SSE head and cancel the never-ending body.
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
    const contentType = await page.evaluate(async () => {
      const res = await fetch('/events');
      await res.body?.cancel();
      return res.headers.get('content-type') ?? '';
    });
    expect(contentType).toContain('text/event-stream');
  });
});
