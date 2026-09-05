// req: (demo — network-assert kit self-test)
// seed: src/tests/seed.spec.ts
// generated-at: 2026-07-24T00:00:00.000Z
/**
 * Demo: live network observe/assert helpers (offline via page.route fulfill).
 * Uses demo tokens only — not a product domain schema.
 *
 * Run: npx playwright test src/tests/demo/demo-network-assert.spec.ts --project=demo
 */
import { test, expect } from '@/fixtures/base.fixture';
import { setTestMetadata, captureActualResult } from '@/support/test-metadata';
import {
  waitAndAssertApi,
  assertNetworkMatch,
  startNetworkRecorder,
  attachNetworkCapture,
} from '@/support/pw';

const MOCK_ORIGIN = 'https://pw-power.local';

test.describe('Network assert power features', {
  tag: ['@demo', '@network-assert', '@pw-power'],
}, () => {
  test('waitForApi + contract after submit', async ({ page }, testInfo) => {
    setTestMetadata({
      testId: 'TC-PW-NET-01',
      priority: 'HIGH',
      affectedLayer: ['FE', 'API'],
      expectedResult:
        'POST /api/demo/submit carries QA-KIT-NETWORK-OK payload; response ok:true; UI status updates',
      inputData: {
        endpoint: 'POST /api/demo/submit',
        name: 'QA-KIT-NETWORK-OK',
        contract: 'tests/data/network/contracts/demo/submit-success.json',
      },
    });

    await test.step('Register fulfill route (browser still sees request/response events)', async () => {
      await page.route('**/api/demo/submit', async (route) => {
        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({ ok: true, id: 'demo-1', token: 'SECRET' }),
        });
      });
    });

    await test.step('Load isolated HTML fixture', async () => {
      await page.setContent(`<!DOCTYPE html>
<html lang="en">
  <body>
    <main>
      <h1>Network Assert Demo</h1>
      <button type="button" id="submit">Submit</button>
      <p id="status" role="status">idle</p>
    </main>
    <script>
      document.getElementById('submit').addEventListener('click', async () => {
        const res = await fetch('${MOCK_ORIGIN}/api/demo/submit', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: 'Bearer demo-secret',
          },
          body: JSON.stringify({ name: 'QA-KIT-NETWORK-OK', qty: 2 }),
        });
        const data = await res.json();
        document.getElementById('status').textContent = data.ok ? 'ok:' + data.id : 'fail';
      });
    </script>
  </body>
</html>`);
    });

    await test.step('Submit + assert network contract', async () => {
      const { hit, resBody } = await waitAndAssertApi(
        page,
        {
          method: 'POST',
          urlIncludes: '/api/demo/submit',
          status: [200, 201],
          assert: {
            request: { requiredKeys: ['name', 'qty'] },
            response: { matchObject: { ok: true } },
          },
          contract: 'tests/data/network/contracts/demo/submit-success.json',
        },
        async () => {
          await page.getByRole('button', { name: 'Submit' }).click();
        },
      );

      // Optional extra checks still fine
      assertNetworkMatch(hit, {
        method: 'POST',
        urlIncludes: '/api/demo/submit',
        status: 201,
      });
      expect((resBody as { id?: string }).id).toBe('demo-1');
      await expect(page.getByRole('status')).toHaveText('ok:demo-1');
      await attachNetworkCapture(testInfo, [hit], 'demo-submit-network.json');
      captureActualResult('Contract pass; UI status ok:demo-1');
    });
  });

  test('recorder captures filtered API hit', async ({ page }, testInfo) => {
    setTestMetadata({
      testId: 'TC-PW-NET-02',
      priority: 'MEDIUM',
      affectedLayer: ['FE', 'API'],
      expectedResult: 'Recorder stores POST /api/demo/ping with redacted secrets',
      inputData: { endpoint: 'POST /api/demo/ping' },
    });

    await page.route('**/api/demo/ping', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ pong: true, token: 'HIDE-ME' }),
      });
    });

    await page.setContent(`<!DOCTYPE html>
<html><body>
  <button id="go">Go</button>
  <script>
    document.getElementById('go').onclick = () =>
      fetch('${MOCK_ORIGIN}/api/demo/ping', {
        method: 'POST',
        headers: { authorization: 'Bearer x', 'content-type': 'application/json' },
        body: JSON.stringify({ ping: 1 }),
      });
  </script>
</body></html>`);

    const recorder = startNetworkRecorder(page, {
      urlIncludes: '/api/demo/',
      methods: ['POST'],
    });

    const responsePromise = page.waitForResponse(
      (res) => res.url().includes('/api/demo/ping') && res.request().method() === 'POST',
    );
    await page.locator('#go').click();
    await responsePromise;
    const hits = await recorder.stop();
    expect(hits.length).toBeGreaterThanOrEqual(1);
    const hit = hits.find((h) => h.url.includes('/api/demo/ping'));
    expect(hit).toBeTruthy();
    expect(hit!.requestHeaders?.authorization).toBe('[REDACTED]');
    expect((hit!.responseBody as { token?: string }).token).toBe('[REDACTED]');
    await attachNetworkCapture(testInfo, hits, 'demo-recorder-network.json');
    captureActualResult(`Recorder hits=${hits.length}; secrets redacted`);
  });
});
