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
    // The verdict badge lives in the latest-run card; the separate status
    // banner is reserved for an unsatisfied gate and stays out of the way here.
    const badge = page.locator('.analysis-badge--complete').first();
    await expect(badge).toBeVisible();
    await expect(badge).toContainText(/AI analysis: complete/i);
    // Verified → the "review gate evidence" warning is not rendered at all.
    await expect(page.locator('body')).not.toContainText(/Review gate evidence/i);
  });

  test('AI Run Insights panel lists deterministic and agent-authored insights', async ({
    page,
  }) => {
    await gotoHash(page, '/');
    const panel = page.locator('.ai-insights-panel');
    await expect(panel).toBeVisible();
    await expect(panel).toContainText('AI Run Insights');
    const items = page.locator('.ai-insight-item');
    // Deterministic (summary.aiInsights) + agent-authored (sidecar runInsights)
    // both render; the seed supplies 2 of each.
    await expect(items).toHaveCount(4);
    await expect(panel).toContainText(/SC-L2/);
    // Agent-authored entries carry their source chip and priority.
    await expect(page.locator('.ai-note-src--reporter').first()).toBeVisible();
    await expect(page.locator('.insight-priority--high').first()).toBeVisible();
  });

  test('QualityTrend renders trend points from seeded history', async ({ page }) => {
    await gotoHash(page, '/');
    // Archived runs feed the trend (heading includes the run count).
    const trendHeading = page.getByRole('heading', { name: /Pass Rate Trend/i });
    await expect(trendHeading).toBeVisible();
    await expect(trendHeading).toContainText(/runs/i);
    // Trend chart svg (role=img) + min/max summary from the seeded history.
    await expect(page.locator('.trend-chart-svg').first()).toBeAttached();
    await expect(page.locator('body')).toContainText(/Min: 50% · Max: 100%/);
  });

  test('Flaky panel names the tests that passed only on a retry', async ({ page }) => {
    await gotoHash(page, '/');
    const panel = page.locator('.panel', { hasText: 'Flaky tests' });
    await expect(panel).toBeVisible();

    // The count alone says "there is a problem"; the NAME says which test,
    // which is the next question QA asks. Seed marks SC-L3 as retry-passed.
    await expect(panel).toContainText('Login with empty username');
    await expect(panel).toContainText(/1 passed on retry/);
    // A retry-pass is a stability warning, not a failure: no destructive mark.
    await expect(panel.locator('.flaky-row--more')).toHaveCount(0);
  });
});

test.describe('dashboard exports', () => {
  test('Markdown export downloads a formatter-stable report', async ({ request }) => {
    const res = await request.get('/export/markdown');
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toContain('text/markdown');
    expect(res.headers()['content-disposition']).toContain('attachment');

    const md = await res.text();
    expect(md).toContain('# QA Report');
    // Official counts come from the summary, not a recomputation.
    expect(md).toMatch(/\*\*Result:\*\* \d+% passed/);
    // Tables survive the formatter: aligned columns with a separator row.
    // (The repo formatter pads the separator, so match its shape, not "| --- |".)
    expect(md).toMatch(/^\|\s*-+\s*\|/m);
    expect(md).toContain('| Field');
  });
});

test.describe('dashboard save workflow (analysis gate)', () => {
  test('save modal opens, validates empty decision, and saves with APPROVE', async ({ page }) => {
    // Save lives on the latest report's masthead (it acts on the LATEST run),
    // not in the global header.
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/latest');
    await page.waitForLoadState('domcontentloaded');
    const saveBtn = page.locator('.hero__run-actions .btn-save-sm');
    await expect(saveBtn).toBeVisible();
    await saveBtn.click();

    const modal = page.locator('#save-modal');
    await expect(modal).toBeVisible();

    // On /latest the triage strip preselects a QA decision, so clear it first —
    // otherwise this "empty decision" probe would silently submit a real one.
    await page.locator('#save-decision').selectOption('');
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
  test('report-updated reloads the current tab without opening another page', async ({ page }) => {
    await page.addInitScript(() => {
      const sources: Array<{
        listeners: Record<string, Array<(event?: { data: string }) => void>>;
      }> = [];
      class TestEventSource {
        listeners: Record<string, Array<(event?: { data: string }) => void>> = {};
        constructor() {
          sources.push(this);
        }
        addEventListener(name: string, listener: (event?: { data: string }) => void) {
          (this.listeners[name] ??= []).push(listener);
        }
        close() {}
      }
      Object.defineProperty(window, 'EventSource', { configurable: true, value: TestEventSource });
      Object.defineProperty(window, '__testEventSources', { configurable: true, value: sources });
    });

    await page.goto('/dashboard');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.getByRole('heading', { name: 'Quality health' })).toBeVisible();
    const navigation = page.waitForEvent('framenavigated');
    await page.evaluate(() => {
      const sources = (
        window as unknown as {
          __testEventSources: Array<{
            listeners: Record<string, Array<(event?: { data: string }) => void>>;
          }>;
        }
      ).__testEventSources;
      for (const listener of sources.at(-1)?.listeners['report-updated'] ?? []) listener();
    });
    await navigation;
    await expect(page).toHaveURL(/\/dashboard(?:#\/)?$/);
    await expect(page.getByRole('heading', { name: 'Quality health' })).toBeVisible();
    expect(await page.context().pages()).toHaveLength(1);
  });

  test('a new server instance reloads this tab once after a watch restart', async ({ page }) => {
    await page.addInitScript(() => {
      const sources: Array<{
        listeners: Record<string, Array<(event?: { data: string }) => void>>;
      }> = [];
      class TestEventSource {
        listeners: Record<string, Array<(event?: { data: string }) => void>> = {};
        constructor() {
          sources.push(this);
        }
        addEventListener(name: string, listener: (event?: { data: string }) => void) {
          (this.listeners[name] ??= []).push(listener);
        }
        close() {}
      }
      Object.defineProperty(window, 'EventSource', { configurable: true, value: TestEventSource });
      Object.defineProperty(window, '__testEventSources', { configurable: true, value: sources });
    });

    await page.goto('/dashboard');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.getByRole('heading', { name: 'Quality health' })).toBeVisible();
    await page.evaluate(() => {
      const sources = (
        window as unknown as {
          __testEventSources: Array<{
            listeners: Record<string, Array<(event?: { data: string }) => void>>;
          }>;
        }
      ).__testEventSources;
      const ready = sources.at(-1)?.listeners['server-ready'] ?? [];
      for (const listener of ready) listener({ data: JSON.stringify({ instanceId: 'first' }) });
    });

    const navigation = page.waitForEvent('framenavigated');
    await page.evaluate(() => {
      const sources = (
        window as unknown as {
          __testEventSources: Array<{
            listeners: Record<string, Array<(event?: { data: string }) => void>>;
          }>;
        }
      ).__testEventSources;
      const ready = sources.at(-1)?.listeners['server-ready'] ?? [];
      for (const listener of ready) listener({ data: JSON.stringify({ instanceId: 'restarted' }) });
    });
    await navigation;
    await expect(page).toHaveURL(/\/dashboard(?:#\/)?$/);
    expect(await page.context().pages()).toHaveLength(1);
  });

  test('/events opens an SSE stream and identifies the server instance', async ({ page }) => {
    // Fetch the stream relative to the page origin via an anchor-free request:
    // goto('/') first so location.origin is a real http origin, then check the
    // SSE head and cancel the never-ending body.
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
    const result = await page.evaluate(async () => {
      const response = await fetch('/events');
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let body = '';
      while (!body.includes('event: server-ready')) {
        const chunk = await reader?.read();
        if (!chunk || chunk.done) break;
        body += decoder.decode(chunk.value, { stream: true });
      }
      await reader?.cancel();
      return { contentType: response.headers.get('content-type') ?? '', body };
    });
    expect(result.contentType).toContain('text/event-stream');
    expect(result.body).toContain('event: server-ready');
    expect(result.body).toMatch(/"instanceId":"[\w-]+"/);
  });
});
