import { test, expect } from '@playwright/test';
import * as http from 'node:http';
import { handleRequest } from '../../cli/dashboard-server';

/** Boot a real http server wired to the dashboard's handleRequest. */
async function withServer(fn: (base: string) => Promise<void>): Promise<void> {
  const server = http.createServer((req, res) => {
    handleRequest(req, res).catch(() => {
      try {
        res.writeHead(500);
        res.end();
      } catch {
        /* already sent */
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

/**
 * Raw HTTP request with explicit method and path (no URL normalization).
 */
function requestRaw(
  base: string,
  path: string,
  method = 'GET',
  body?: string,
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const u = new URL(base);
    const headers: http.OutgoingHttpHeaders = {};
    if (body) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(body);
    }
    const req = http.request(
      { hostname: u.hostname, port: u.port, path, method, headers },
      (res) => {
        let resBody = '';
        res.on('data', (c) => (resBody += c));
        res.on('end', () =>
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body: resBody }),
        );
      },
    );
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function getRaw(
  base: string,
  path: string,
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  return requestRaw(base, path, 'GET');
}

test.describe('dashboard server routes', () => {
  test('GET / returns HTML with no-store and no CORS wildcard', async () => {
    await withServer(async (base) => {
      const r = await getRaw(base, '/');
      expect(r.status).toBe(200);
      expect(r.headers['content-type']).toContain('text/html');
      expect(r.headers['cache-control']).toContain('no-store');
      expect(r.headers['access-control-allow-origin']).toBeUndefined();
    });
  });

  test('GET /api/history returns JSON, no-store, no CORS wildcard', async () => {
    await withServer(async (base) => {
      const r = await getRaw(base, '/api/history');
      expect(r.status).toBe(200);
      expect(r.headers['content-type']).toContain('application/json');
      expect(r.headers['cache-control']).toContain('no-store');
      expect(r.headers['access-control-allow-origin']).toBeUndefined();
      const parsed = JSON.parse(r.body);
      expect(Array.isArray(parsed.history)).toBe(true);
    });
  });

  test('fragment detail path traversal returns 400', async () => {
    await withServer(async (base) => {
      const r = await getRaw(base, '/fragment/detail/../etc/passwd');
      expect(r.status).toBe(400);
    });
  });

  test('api archive path traversal returns 400', async () => {
    await withServer(async (base) => {
      const r = await getRaw(base, '/api/archive/../etc/passwd');
      expect(r.status).toBe(400);
    });
  });

  test('compare with invalid runId params returns 400', async () => {
    await withServer(async (base) => {
      const r = await getRaw(base, '/api/archive/compare?baseline=../etc&current=run-1');
      expect(r.status).toBe(400);
    });
  });

  test('compare with valid-format but nonexistent runs returns 404 (error shape)', async () => {
    await withServer(async (base) => {
      const r = await getRaw(
        base,
        '/api/archive/compare?baseline=run-20000101-000000-000&current=run-20000101-000001-000',
      );
      expect(r.status).toBe(404);
      const parsed = JSON.parse(r.body);
      expect(typeof parsed.error).toBe('string');
    });
  });

  test('unknown fragment returns 404', async () => {
    await withServer(async (base) => {
      const r = await getRaw(base, '/fragment/does-not-exist');
      expect(r.status).toBe(404);
    });
  });

  test('OPTIONS preflight returns 204 with allowed methods including PATCH and PUT', async () => {
    await withServer(async (base) => {
      const res = await requestRaw(base, '/api/archive/run-1', 'OPTIONS');
      expect(res.status).toBe(204);
      expect(res.headers['access-control-allow-methods']).toContain('PATCH');
      expect(res.headers['access-control-allow-methods']).toContain('PUT');
    });
  });

  test('GET /api/runs alias returns JSON history', async () => {
    await withServer(async (base) => {
      const r = await getRaw(base, '/api/runs');
      expect(r.status).toBe(200);
      expect(r.headers['content-type']).toContain('application/json');
      const parsed = JSON.parse(r.body);
      expect(Array.isArray(parsed.history)).toBe(true);
    });
  });

  test('PATCH /api/archive path traversal returns 400', async () => {
    await withServer(async (base) => {
      const res = await requestRaw(
        base,
        '/api/archive/../etc/passwd',
        'PATCH',
        JSON.stringify({ displayName: 'Test' }),
      );
      expect(res.status).toBe(400);
    });
  });

  test('PATCH /api/archive nonexistent run returns 404', async () => {
    await withServer(async (base) => {
      const res = await requestRaw(
        base,
        '/api/archive/run-20000101-000000-000',
        'PATCH',
        JSON.stringify({ displayName: 'Updated Run Label' }),
      );
      expect(res.status).toBe(404);
    });
  });

  test('rejects unknown, lowercase, and empty QA decisions with structured 4xx', async () => {
    await withServer(async (base) => {
      for (const decision of ['', 'approve', 'UNKNOWN']) {
        const res = await requestRaw(
          base,
          '/api/archive/save',
          'POST',
          JSON.stringify({ decision }),
        );
        expect(res.status).toBe(400);
        const parsed = JSON.parse(res.body);
        expect(parsed.code).toBe('INVALID_QA_DECISION');
        expect(parsed.field).toBe('decision');
      }
    });
  });

  test('rejects an empty save label with structured 4xx', async () => {
    await withServer(async (base) => {
      const res = await requestRaw(
        base,
        '/api/archive/save',
        'POST',
        JSON.stringify({ decision: 'APPROVE', label: '   ' }),
      );
      expect(res.status).toBe(400);
      const parsed = JSON.parse(res.body);
      expect(parsed.code).toBe('INVALID_LABEL');
      expect(parsed.field).toBe('label');
    });
  });

  test('rejects encoded traversal before resolving an archive subpath', async () => {
    await withServer(async (base) => {
      const res = await requestRaw(base, '/api/archive/run-1/%2e%2e/%2e%2e/etc/passwd');
      expect(res.status).toBe(404);
      expect(JSON.parse(res.body).error).toBe('Archive file not found');
    });
  });

  test('rejects invalid decisions and labels on archive edits', async () => {
    await withServer(async (base) => {
      const invalidDecision = await requestRaw(
        base,
        '/api/archive/run-20260820-120000-001',
        'PATCH',
        JSON.stringify({ qaDecision: 'INVALID' }),
      );
      expect(invalidDecision.status).toBe(400);
      expect(JSON.parse(invalidDecision.body).code).toBe('INVALID_QA_DECISION');

      const emptyLabel = await requestRaw(
        base,
        '/api/archive/run-20260820-120000-001',
        'PATCH',
        JSON.stringify({ displayName: ' ' }),
      );
      expect(emptyLabel.status).toBe(400);
      expect(JSON.parse(emptyLabel.body).code).toBe('INVALID_LABEL');
    });
  });
});
