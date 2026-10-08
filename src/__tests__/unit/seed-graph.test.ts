import { test, expect } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';
import {
  resolveSeedOrder,
  materializeSeeds,
  teardownSeeds,
  withSeededData,
  type SeedGraph,
} from '../../support/pw/seed-graph';

interface RecordedCall {
  method: string;
  url: string;
  data?: unknown;
}

/**
 * Stub APIRequestContext that records calls and returns scripted responses.
 * Keeps seed-graph tests fully offline: no backend, no dev data touched.
 */
function stubRequest(script: Record<string, { status: number; body: unknown }>): {
  request: APIRequestContext;
  calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];
  const request = {
    fetch: async (url: string, options?: { method?: string; data?: unknown }) => {
      const method = options?.method ?? 'GET';
      calls.push({ method, url, data: options?.data });
      const key = `${method} ${url}`;
      const scripted = script[key] ?? { status: method === 'DELETE' ? 204 : 200, body: {} };
      return {
        status: () => scripted.status,
        ok: () => scripted.status >= 200 && scripted.status < 300,
        headers: () => ({ 'content-type': 'application/json' }),
        json: async () => scripted.body,
        text: async () => JSON.stringify(scripted.body),
      };
    },
  } as unknown as APIRequestContext;
  return { request, calls };
}

const CUSTOMER_ORDER: SeedGraph = {
  producers: [
    {
      name: 'customer.active',
      endpoint: '/api/customers',
      cleanupEndpoint: '/api/customers/{id}',
      payload: { name: 'QA customer' },
    },
    {
      name: 'order.draft',
      endpoint: '/api/orders',
      cleanupEndpoint: '/api/orders/{id}',
      dependsOn: ['customer.active'],
      payload: { customerId: '{parent.customer.active.id}', status: 'draft' },
    },
  ],
};

test.describe('seed graph runtime', () => {
  test('orders seeds parents-before-children and rejects cycles', () => {
    expect(resolveSeedOrder(CUSTOMER_ORDER, ['order.draft'])).toEqual([
      'customer.active',
      'order.draft',
    ]);

    const cyclic: SeedGraph = {
      producers: [
        { name: 'a', endpoint: '/a', cleanupEndpoint: '/a/{id}', dependsOn: ['b'] },
        { name: 'b', endpoint: '/b', cleanupEndpoint: '/b/{id}', dependsOn: ['a'] },
      ],
    };
    expect(() => resolveSeedOrder(cyclic, ['a'])).toThrow(/cycle/i);
  });

  test('substitutes parent IDs into child payloads', async () => {
    const { request, calls } = stubRequest({
      'POST /api/customers': { status: 201, body: { id: 'C-1' } },
      'POST /api/orders': { status: 201, body: { id: 'O-9' } },
    });

    const created = await materializeSeeds(request, CUSTOMER_ORDER, ['order.draft']);
    expect(created['customer.active'].id).toBe('C-1');
    expect(created['order.draft'].id).toBe('O-9');

    const orderCall = calls.find((c) => c.url === '/api/orders');
    expect(orderCall?.data).toEqual({ customerId: 'C-1', status: 'draft' });
  });

  test('refuses to continue when a producer fails', async () => {
    const { request } = stubRequest({
      'POST /api/customers': { status: 500, body: {} },
    });
    await expect(materializeSeeds(request, CUSTOMER_ORDER, ['order.draft'])).rejects.toThrow(
      /customer\.active.*500/,
    );
  });

  test('cleans up children before parents, using created IDs only', async () => {
    const { request, calls } = stubRequest({
      'POST /api/customers': { status: 201, body: { id: 'C-1' } },
      'POST /api/orders': { status: 201, body: { id: 'O-9' } },
    });
    const created = await materializeSeeds(request, CUSTOMER_ORDER, ['order.draft']);
    const errors = await teardownSeeds(request, CUSTOMER_ORDER, created);

    expect(errors).toEqual([]);
    const deletes = calls.filter((c) => c.method === 'DELETE').map((c) => c.url);
    expect(deletes).toEqual(['/api/orders/O-9', '/api/customers/C-1']);
  });

  test('reports cleanup failures instead of swallowing them', async () => {
    const { request } = stubRequest({
      'POST /api/customers': { status: 201, body: { id: 'C-1' } },
      'POST /api/orders': { status: 201, body: { id: 'O-9' } },
      'DELETE /api/orders/O-9': { status: 500, body: {} },
    });
    const created = await materializeSeeds(request, CUSTOMER_ORDER, ['order.draft']);
    const errors = await teardownSeeds(request, CUSTOMER_ORDER, created);

    expect(errors.length).toBe(1);
    expect(errors[0]).toContain('order.draft');
    expect(errors[0]).toContain('500');
  });

  test('withSeededData still cleans up when the test body throws', async () => {
    const { request, calls } = stubRequest({
      'POST /api/customers': { status: 201, body: { id: 'C-1' } },
      'POST /api/orders': { status: 201, body: { id: 'O-9' } },
    });

    await expect(
      withSeededData(request, CUSTOMER_ORDER, ['order.draft'], async () => {
        throw new Error('assertion failed mid-test');
      }),
    ).rejects.toThrow('assertion failed mid-test');

    const deletes = calls.filter((c) => c.method === 'DELETE').map((c) => c.url);
    expect(deletes).toEqual(['/api/orders/O-9', '/api/customers/C-1']);
  });
});
