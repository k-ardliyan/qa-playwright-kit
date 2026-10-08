// req: (demo — seed graph lifecycle kit self-test)
// seed: tests/seed.spec.ts
/**
 * Demo: seed-graph lifecycle against a LOCAL HTTP server.
 *
 * Proves the whole path end-to-end without touching any real backend:
 * parent materialized before child → parent ID substituted into the child
 * payload → cleanup deletes children before parents → only test-owned IDs are
 * touched. The server is started inside the test and records every call, so
 * the assertions check real HTTP behavior, not mocks.
 *
 * Run: npx playwright test tests/demo/demo-seed-graph.spec.ts --project=demo
 *
 * Note: the `seeded` FIXTURE reads config/qa-kit.seeds.json (per-project), so
 * its wiring is covered by src/__tests__/unit/seed-config.test.ts with an
 * injected graph. This demo covers the runtime the fixture delegates to.
 */
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import { test, expect } from '@/fixtures/base.fixture';
import { setTestMetadata } from '@/support/test-metadata';
import { withSeededData, type SeedGraph } from '@/support/pw';

interface RecordedCall {
  method: string;
  path: string;
  body: string;
}

let server: http.Server;
let baseUrl: string;
let calls: RecordedCall[];

test.describe('Seed graph lifecycle @demo', () => {
  test.beforeAll(async () => {
    server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', () => {
        calls.push({ method: req.method ?? '', path: req.url ?? '', body });
        res.setHeader('content-type', 'application/json');
        if (req.method === 'POST') {
          const id = `${req.url?.includes('orders') ? 'O' : 'C'}-${calls.length}`;
          res.statusCode = 201;
          res.end(JSON.stringify({ id }));
          return;
        }
        if (req.method === 'DELETE') {
          res.statusCode = 204;
          res.end();
          return;
        }
        res.statusCode = 200;
        res.end('{}');
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  test.beforeEach(() => {
    calls = [];
  });

  test.afterAll(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  });

  test('materializes parent before child and cleans up child before parent', async ({
    request,
  }) => {
    setTestMetadata({
      testId: 'TC-DEMO-SEED-01',
      module: 'demo',
      feature: 'seed-graph',
      priority: 'MEDIUM',
      expectedResult:
        'Parent dibuat lebih dulu, child memakai ID parent, cleanup child sebelum parent',
      inputData: { seed: 'seed:order.draft' },
    });

    const graph: SeedGraph = {
      producers: [
        {
          name: 'customer.active',
          endpoint: `${baseUrl}/api/customers`,
          cleanupEndpoint: `${baseUrl}/api/customers/{id}`,
          payload: { name: 'QA customer' },
        },
        {
          name: 'order.draft',
          endpoint: `${baseUrl}/api/orders`,
          cleanupEndpoint: `${baseUrl}/api/orders/{id}`,
          dependsOn: ['customer.active'],
          payload: { customerId: '{parent.customer.active.id}', status: 'draft' },
        },
      ],
    };

    await test.step('Jalankan lifecycle seed lalu verifikasi urutan HTTP', async () => {
      const seen = await withSeededData(request, graph, ['order.draft'], async (seeds) => {
        expect(seeds['customer.active'].id).toBeDefined();
        expect(seeds['order.draft'].id).toBeDefined();
        return { customerId: seeds['customer.active'].id, orderId: seeds['order.draft'].id };
      });

      const methods = calls.map((call) => `${call.method} ${call.path}`);
      expect(methods).toEqual([
        'POST /api/customers',
        'POST /api/orders',
        `DELETE /api/orders/${seen.orderId}`,
        `DELETE /api/customers/${seen.customerId}`,
      ]);

      // The child payload carried the REAL parent id — relation wired, not guessed.
      const orderCall = calls.find((call) => call.path === '/api/orders');
      expect(JSON.parse(orderCall?.body ?? '{}')).toEqual({
        customerId: seen.customerId,
        status: 'draft',
      });
    });
  });

  test('does not delete anything when the producer fails', async ({ request }) => {
    setTestMetadata({
      testId: 'TC-DEMO-SEED-02',
      module: 'demo',
      feature: 'seed-graph',
      priority: 'MEDIUM',
      expectedResult: 'Producer gagal → tidak ada penghapusan data (bukan partial graph)',
      inputData: { seed: 'seed:missing.producer' },
    });

    const graph: SeedGraph = {
      producers: [
        {
          name: 'customer.active',
          endpoint: `${baseUrl}/api/customers`,
          cleanupEndpoint: `${baseUrl}/api/customers/{id}`,
        },
      ],
    };

    await test.step('Minta seed yang tidak terdaftar dan verifikasi tidak ada cleanup', async () => {
      await expect(
        withSeededData(request, graph, ['order.draft'], async () => undefined),
      ).rejects.toThrow(/Unknown seed "order\.draft"/);

      expect(calls.filter((call) => call.method === 'DELETE')).toEqual([]);
    });
  });
});
