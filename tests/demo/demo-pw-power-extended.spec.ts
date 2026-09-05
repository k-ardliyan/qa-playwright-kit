import { test, expect } from '@/fixtures/base.fixture';
import { setTestMetadata, captureActualResult } from '@/support/test-metadata';
import {
  mockServerError,
  mockJson,
  unmockAll,
  expectAriaSnapshot,
  expectVisual,
  freezeTime,
  resumeRealTime,
} from '@/support/pw';

/**
 * Extended power demo: network failure UI, visual snapshot, clock freeze.
 * Self-contained — no real backend.
 */
const ORIGIN = 'https://pw-power.local';

test.describe('Playwright Power Extended', {
  tag: ['@demo', '@pw-power', '@network', '@visual'],
}, () => {
  test('network 500 surfaces error banner + visual region', async ({ page }) => {
    setTestMetadata({
      testId: 'TC-PW-POWER-03',
      priority: 'HIGH',
      affectedLayer: ['FE', 'API'],
      expectedResult: 'Error banner visible after mocked 500; visual snapshot of banner stable',
      inputData: { api: `${ORIGIN}/api/invoices`, status: '500' },
    });

    // Optional: block service workers so route always sees the request
    // test.use({ serviceWorkers: 'block' }) — project-level if needed

    await test.step('Mock list API 500', async () => {
      await mockServerError(page, '**/api/invoices**', 500, { error: 'Internal Server Error' });
    });

    await test.step('Load fixture page', async () => {
      await page.setContent(`<!DOCTYPE html>
<html lang="en"><body>
  <main>
    <h1>Invoices</h1>
    <div id="banner" role="alert" hidden>idle</div>
    <table id="grid"><tbody></tbody></table>
    <button id="load" type="button">Refresh</button>
  </main>
  <script>
    document.getElementById('load').onclick = async () => {
      const banner = document.getElementById('banner');
      try {
        const r = await fetch('${ORIGIN}/api/invoices');
        if (!r.ok) {
          banner.hidden = false;
          banner.textContent = 'Gagal memuat: ' + r.status;
          return;
        }
        banner.hidden = true;
      } catch (e) {
        banner.hidden = false;
        banner.textContent = 'Gagal memuat: network';
      }
    };
  </script>
</body></html>`);
    });

    await test.step('Trigger load and assert error UI', async () => {
      await page.getByRole('button', { name: 'Refresh' }).click();
      const banner = page.getByRole('alert');
      await expect(banner).toBeVisible();
      await expect(banner).toContainText('Gagal memuat');
      await expect(banner).toContainText('500');
    });

    await test.step('Visual snapshot of alert region', async () => {
      await expectVisual(page.getByRole('alert'), {
        name: 'invoice-error-banner.png',
        maxDiffPixelRatio: 0.05,
      });
    });

    await test.step('ARIA structure still has main + heading', async () => {
      await expectAriaSnapshot(
        page.getByRole('main'),
        `
          - main:
            - heading "Invoices" [level=1]
            - alert: /Gagal memuat/
            - table
            - button "Refresh"
        `,
      );
    });

    await unmockAll(page);
    captureActualResult('500 error banner + visual + ARIA confirmed');
  });

  test('clock freeze keeps fixed timestamp label', async ({ page }) => {
    setTestMetadata({
      testId: 'TC-PW-POWER-04',
      priority: 'MEDIUM',
      affectedLayer: ['FE'],
      expectedResult: 'Frozen clock shows fixed date label',
      inputData: { frozenAt: '2030-01-15T10:00:00.000Z' },
    });

    await test.step('Install fake clock and render label', async () => {
      await freezeTime(page, '2030-01-15T10:00:00.000Z');
      await page.setContent(`<!DOCTYPE html>
<html><body>
  <p id="today"></p>
  <script>
    document.getElementById('today').textContent =
      new Date().toISOString().slice(0, 10);
  </script>
</body></html>`);
    });

    await test.step('Assert frozen date', async () => {
      await expect(page.locator('#today')).toHaveText('2030-01-15');
      captureActualResult('Clock frozen at 2030-01-15');
    });

    await resumeRealTime(page);
  });

  test('hybrid-style request mock via route for list seed', async ({ page }) => {
    setTestMetadata({
      testId: 'TC-PW-POWER-05',
      priority: 'HIGH',
      affectedLayer: ['FE', 'API'],
      expectedResult: 'Mocked list JSON renders a row',
      inputData: { id: 'inv-1', amount: '150000' },
    });

    await test.step('Mock successful list payload', async () => {
      await mockJson(page, '**/api/invoices**', {
        items: [{ id: 'inv-1', amount: 150000, status: 'draft' }],
      });
    });

    await test.step('Render list from API', async () => {
      await page.setContent(`<!DOCTYPE html>
<html><body>
  <ul id="list"></ul>
  <button id="load">Load</button>
  <script>
    document.getElementById('load').onclick = async () => {
      const r = await fetch('${ORIGIN}/api/invoices');
      const data = await r.json();
      const ul = document.getElementById('list');
      ul.innerHTML = '';
      for (const item of data.items || []) {
        const li = document.createElement('li');
        li.textContent = item.id + ':' + item.amount;
        ul.appendChild(li);
      }
    };
  </script>
</body></html>`);
      await page.getByRole('button', { name: 'Load' }).click();
      await expect(page.getByText('inv-1:150000')).toBeVisible();
      captureActualResult('Seeded row inv-1:150000 visible');
    });

    await unmockAll(page);
  });
});
