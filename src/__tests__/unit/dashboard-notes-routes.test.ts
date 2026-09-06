import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const TMP_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-notes-routes-'));
const TMP_REPORT_DIR = path.join(TMP_ROOT, 'reports');
const TMP_ARCHIVE_DIR = path.join(TMP_REPORT_DIR, 'archive');
const ARCHIVED_RUN_ID = 'run-20260906-030303-004';
fs.mkdirSync(path.join(TMP_ARCHIVE_DIR, ARCHIVED_RUN_ID), { recursive: true });
process.env['QA_REPORT_DIR'] = TMP_REPORT_DIR;
process.env['QA_ARCHIVE_DIR'] = TMP_ARCHIVE_DIR;

import { test, expect } from '@playwright/test';
import * as http from 'node:http';
import { handleRequest } from '../../cli/dashboard-server';
import { upsertLatestTestNote } from '../../agents/reporter/test-notes';

function createArchiveFixture(runId: string): void {
  const runDir = path.join(TMP_ARCHIVE_DIR, runId);
  fs.mkdirSync(runDir, { recursive: true });
  const metadata = {
    schemaVersion: 2,
    runId,
    savedAt: new Date().toISOString(),
    ranAt: new Date().toISOString(),
    appEnv: 'local',
    qaDecision: 'APPROVE',
    qaNotes: 'run level notes',
    triggeredBy: 'manual',
    triggerSource: 'cli',
  };
  fs.writeFileSync(path.join(runDir, 'metadata.json'), JSON.stringify(metadata, null, 2), 'utf-8');
  fs.writeFileSync(
    path.join(runDir, 'summary.json'),
    JSON.stringify({ total: 1, passed: 1, failed: 0, skipped: 0, passRate: 100 }, null, 2),
    'utf-8',
  );
}

createArchiveFixture(ARCHIVED_RUN_ID);

test.afterAll(() => {
  fs.rmSync(TMP_ROOT, { recursive: true, force: true });
  delete process.env['QA_REPORT_DIR'];
  delete process.env['QA_ARCHIVE_DIR'];
});

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

function request(
  base: string,
  reqPath: string,
  method = 'GET',
  body?: unknown,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const u = new URL(base);
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const headers: http.OutgoingHttpHeaders = {};
    if (payload) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(payload);
    }
    const req = http.request(
      { hostname: u.hostname, port: u.port, path: reqPath, method, headers },
      (res) => {
        let resBody = '';
        res.on('data', (c) => (resBody += c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: resBody }));
      },
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

test.describe('per-test notes API', () => {
  test('POST /api/notes/latest writes and GET reads the sidecar', async () => {
    await withServer(async (base) => {
      const write = await request(base, '/api/notes/latest', 'POST', {
        scenarioId: 'SC-01',
        role: 'finance',
        qaNotes: 'catatan via API',
      });
      expect(write.status).toBe(200);
      expect(JSON.parse(write.body)).toMatchObject({ ok: true, key: 'SC-01::finance' });

      const read = await request(base, '/api/runs/latest/notes');
      expect(read.status).toBe(200);
      const parsed = JSON.parse(read.body);
      expect(parsed.notes['SC-01::finance']?.qaNotes).toBe('catatan via API');
    });
  });

  test('POST /api/runs/latest/notes alias works and clears notes with an empty string', async () => {
    upsertLatestTestNote('SC-02::general', { qaNotes: 'akan dihapus' });
    await withServer(async (base) => {
      const clear = await request(base, '/api/runs/latest/notes', 'POST', {
        scenarioId: 'SC-02',
        qaNotes: '',
      });
      expect(clear.status).toBe(200);
      const read = await request(base, '/api/notes/latest');
      expect(JSON.parse(read.body).notes['SC-02::general']?.qaNotes).toBe('');
    });
  });

  test('rejects missing key, missing qaNotes, and invalid runId', async () => {
    await withServer(async (base) => {
      const noKey = await request(base, '/api/notes/latest', 'POST', { qaNotes: 'x' });
      expect(noKey.status).toBe(400);
      expect(JSON.parse(noKey.body).code).toBe('INVALID_KEY');

      const noNote = await request(base, '/api/notes/latest', 'POST', { scenarioId: 'SC-01' });
      expect(noNote.status).toBe(400);

      const badRun = await request(base, '/api/archive/latest/notes', 'POST', {
        scenarioId: 'SC-01',
        qaNotes: 'x',
      });
      expect(badRun.status).toBe(400);
      expect(JSON.parse(badRun.body).code).toBe('INVALID_RUN_ID');
    });
  });

  test('archived run notes: GET empty by default, POST persists, unknown run 404s', async () => {
    await withServer(async (base) => {
      const empty = await request(base, `/api/archive/${ARCHIVED_RUN_ID}/notes`);
      expect(empty.status).toBe(200);
      expect(JSON.parse(empty.body).notes).toEqual({});

      const write = await request(base, `/api/archive/${ARCHIVED_RUN_ID}/notes`, 'POST', {
        testId: 'TC-AUTH-001',
        role: 'finance',
        qaNotes: 'arsip di-edit',
      });
      expect(write.status).toBe(200);

      const read = await request(base, `/api/runs/${ARCHIVED_RUN_ID}/notes`);
      expect(JSON.parse(read.body).notes['TC-AUTH-001::finance']?.qaNotes).toBe('arsip di-edit');

      const missing = await request(base, '/api/archive/run-20260906-999999-999/notes', 'POST', {
        scenarioId: 'SC-01',
        qaNotes: 'x',
      });
      expect(missing.status).toBe(404);
    });
  });
});
