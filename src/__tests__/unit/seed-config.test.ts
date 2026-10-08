import { test, expect } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { loadSeedGraph, toSeedGraph } from '../../support/pw/seed-config';
import { createSeededFixture } from '../../fixtures/seed.fixture';
import { test as baseTest } from '../../fixtures/base.fixture';
import { validateSeedUsage } from '../../../tools/mcp/src/tools/rules/test-evidence-rules';

function withRegistry(content: string | null, run: (root: string) => void): void {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'seed-config-'));
  if (content !== null) {
    const configDir = path.join(root, 'config');
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(path.join(configDir, 'qa-kit.seeds.json'), content, 'utf-8');
  }
  try {
    run(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

/** Minimal stub: records calls, returns scripted responses. No backend. */
function stubRequest(): { request: APIRequestContext; calls: string[] } {
  const calls: string[] = [];
  const request = {
    fetch: async (url: string, options?: { method?: string }) => {
      calls.push(`${options?.method ?? 'GET'} ${url}`);
      return {
        status: () => 200,
        ok: () => true,
        headers: () => ({ 'content-type': 'application/json' }),
        json: async () => ({ id: `ID-${calls.length}` }),
        text: async () => '{}',
      };
    },
  } as unknown as APIRequestContext;
  return { request, calls };
}

const VALID_REGISTRY = JSON.stringify({
  schemaVersion: 2,
  seeds: [
    {
      name: 'customer.active',
      entity: 'customer',
      create: { endpoint: '/api/customers', cleanupEndpoint: '/api/customers/{id}' },
    },
    {
      name: 'order.draft',
      entity: 'order',
      create: {
        endpoint: '/api/orders',
        cleanupEndpoint: '/api/orders/{id}',
        dependsOn: ['customer.active'],
        payload: { customerId: '{parent.customer.active.id}' },
      },
    },
    { name: 'prose.only' },
  ],
});

test.describe('seed config loader', () => {
  test('missing registry yields an empty graph, not an error', () => {
    withRegistry(null, (root) => {
      expect(loadSeedGraph(root)).toEqual({ producers: [] });
    });
  });

  test('malformed registry yields an empty graph', () => {
    withRegistry('{ not json', (root) => {
      expect(loadSeedGraph(root)).toEqual({ producers: [] });
    });
  });

  test('reads executable producers and skips prose-only seeds', () => {
    withRegistry(VALID_REGISTRY, (root) => {
      const graph = loadSeedGraph(root);
      expect(graph.producers.map((p) => p.name)).toEqual(['customer.active', 'order.draft']);
      expect(graph.producers[1].dependsOn).toEqual(['customer.active']);
      expect(graph.producers[1].payload).toEqual({ customerId: '{parent.customer.active.id}' });
    });
  });

  test('drops entries missing an endpoint or cleanup endpoint', () => {
    const graph = toSeedGraph({
      seeds: [
        { name: 'no.endpoint', create: { cleanupEndpoint: '/x/{id}' } },
        { name: 'no.cleanup', create: { endpoint: '/y' } },
        { name: 'ok', create: { endpoint: '/z', cleanupEndpoint: '/z/{id}' } },
      ],
    });
    expect(graph.producers.map((p) => p.name)).toEqual(['ok']);
  });
});

test.describe('seeded fixture wiring', () => {
  test('is registered on the base test object', () => {
    expect(baseTest).toBeDefined();
    expect(typeof baseTest.extend).toBe('function');
  });

  test('materializes and tears down through the fixture body, with no backend', async () => {
    const { request, calls } = stubRequest();
    const seeded = await createSeededFixture({ graph: loadGraphFixture() })({ request });

    const seen = await seeded(['order.draft'], async (seeds) => {
      expect(seeds['order.draft'].id).toBeDefined();
      return seeds['order.draft'].id;
    });

    expect(seen).toBeDefined();
    // parents first, then cleanup children before parents
    expect(calls).toEqual([
      'POST /api/customers',
      'POST /api/orders',
      'DELETE /api/orders/ID-2',
      'DELETE /api/customers/ID-1',
    ]);
  });

  test('fails loudly when no producer is configured', async () => {
    const { request } = stubRequest();
    const seeded = await createSeededFixture({ graph: { producers: [] } })({ request });
    await expect(seeded(['order.draft'], async () => undefined)).rejects.toThrow(
      /no executable producer is configured/,
    );
  });
});

function loadGraphFixture() {
  return {
    producers: [
      {
        name: 'customer.active',
        endpoint: '/api/customers',
        cleanupEndpoint: '/api/customers/{id}',
      },
      {
        name: 'order.draft',
        endpoint: '/api/orders',
        cleanupEndpoint: '/api/orders/{id}',
        dependsOn: ['customer.active'],
      },
    ],
  };
}

test.describe('seed usage consistency rule', () => {
  const SPEC = 'tests/orders.spec.ts';

  test('flags a test that declares a seed ref but never materializes it', () => {
    const source = [
      "test('SC-01: view seeded order (@hybrid)', async ({ page }) => {",
      "  setTestMetadata({ testId: 'TC-1', evidenceMode: 'hybrid-ui', inputData: { orderId: 'seed:order.draft' } });",
      "  await page.goto('/orders');",
      "  await expect(page.getByText('Draft')).toBeVisible();",
      '});',
    ].join('\n');
    const violations = validateSeedUsage(source, 'x', SPEC);
    expect(violations.length).toBe(1);
    expect(violations[0].ruleName).toContain('seed:order.draft');
    expect(violations[0].severity).toBe('error');
  });

  test('accepts the seeded fixture and the withSeededData helper', () => {
    const viaFixture = [
      "test('SC-01 (@hybrid)', async ({ page, seeded }) => {",
      "  setTestMetadata({ testId: 'TC-1', inputData: { orderId: 'seed:order.draft' } });",
      "  await seeded(['order.draft'], async () => undefined);",
      "  await expect(page.getByText('Draft')).toBeVisible();",
      '});',
    ].join('\n');
    expect(validateSeedUsage(viaFixture, 'x', SPEC)).toEqual([]);

    const viaHelper = [
      "import { withSeededData } from '@/support/pw';",
      "test('SC-01 (@hybrid)', async ({ page, request }) => {",
      "  setTestMetadata({ testId: 'TC-1', inputData: { orderId: 'seed:order.draft' } });",
      "  await withSeededData(request, graph, ['order.draft'], async () => undefined);",
      "  await expect(page.getByText('Draft')).toBeVisible();",
      '});',
    ].join('\n');
    expect(validateSeedUsage(viaHelper, 'x', SPEC)).toEqual([]);
  });

  test('stays silent for tests with no seed refs', () => {
    const source = [
      "test('SC-01', async ({ page }) => {",
      "  setTestMetadata({ testId: 'TC-1' });",
      "  await expect(page.getByText('Draft')).toBeVisible();",
      '});',
    ].join('\n');
    expect(validateSeedUsage(source, 'x', SPEC)).toEqual([]);
  });
});
