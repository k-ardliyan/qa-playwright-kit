import * as fs from 'node:fs';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';

import { test, expect } from '@playwright/test';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-evidence-integrity-'));
const reportDir = path.join(tempRoot, 'reports');
const archiveDir = path.join(reportDir, 'archive');
const attachmentsDir = path.join(reportDir, 'attachments');
const screenshotName = "evil & 'quote'.png";
const screenshotPath = path.join(attachmentsDir, screenshotName);
const latestTimestamp = '2026-08-21T10:20:30.123Z';

fs.mkdirSync(attachmentsDir, { recursive: true });
fs.writeFileSync(screenshotPath, 'png-fixture');
fs.mkdirSync(path.join(attachmentsDir, 'nested folder'), { recursive: true });
fs.writeFileSync(path.join(attachmentsDir, 'nested folder', 'space name.txt'), 'nested-fixture');
fs.writeFileSync(
  path.join(reportDir, 'test-summary.json'),
  JSON.stringify(
    {
      total: 1,
      passed: 1,
      failed: 0,
      skipped: 0,
      passRate: 100,
      timestamp: latestTimestamp,
      requirementId: 'REQ-EVIDENCE-001',
      requirementTitle: 'Evidence integrity',
      reportMode: 'role-aware',
      rolesInScope: ['finance'],
      testCases: [
        {
          testId: 'TC-EVIDENCE-01',
          scenarioId: 'SC-EVIDENCE-01',
          title: 'Rich evidence record',
          fullTitle: 'Evidence > Rich evidence record',
          filePath: 'tests/evidence.spec.ts',
          role: 'finance',
          module: 'reports',
          feature: 'evidence',
          status: 'passed',
          priority: 'high',
          duration: 1234,
          inputData: { period: 'Q1-2026' },
          expectedResult: 'Evidence remains available',
          actualResult: 'Evidence remains available',
          affectedLayer: ['FE', 'BE'],
          attachmentCount: 1,
          hasTrace: false,
          errorMessage: '',
          errors: [],
          steps: [{ title: 'Open evidence', status: 'passed', duration: 1234, steps: [] }],
          attachments: [
            {
              name: screenshotName,
              contentType: 'image/png',
              relativePath: `attachments/${screenshotName}`,
              kind: 'screenshot',
            },
          ],
        },
      ],
      runMeta: {
        appEnv: 'staging',
        runId: 'run-20260821-102030-123',
        ci: false,
        totalDurationMs: 1234,
        generatedAt: latestTimestamp,
      },
    },
    null,
    2,
  ),
);
fs.writeFileSync(
  path.join(reportDir, '.latest-run'),
  JSON.stringify({
    timestamp: latestTimestamp,
    total: 1,
    passed: 1,
    failed: 0,
    skipped: 0,
    passRate: 100,
  }),
);

process.env['QA_REPORT_DIR'] = reportDir;
process.env['QA_ARCHIVE_DIR'] = archiveDir;

import { handleRequest } from '../../cli/dashboard-server';
import {
  loadArchivedSummary,
  saveLatestRun,
  type ArchiveSaveResult,
} from '../../agents/reporter/report-archive';

let archive: ArchiveSaveResult;

test.describe.configure({ mode: 'serial' });

test.afterAll(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
  delete process.env['QA_REPORT_DIR'];
  delete process.env['QA_ARCHIVE_DIR'];
});

async function withServer(fn: (base: string) => Promise<void>): Promise<void> {
  const server = http.createServer((req, res) => {
    handleRequest(req, res).catch(() => {
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

function getRaw(base: string, requestPath: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const target = new URL(base);
    const request = http.request(
      { hostname: target.hostname, port: target.port, path: requestPath, method: 'GET' },
      (response) => {
        let body = '';
        response.on('data', (chunk) => (body += chunk));
        response.on('end', () => resolve({ status: response.statusCode ?? 0, body }));
      },
    );
    request.on('error', reject);
    request.end();
  });
}

const encodedScreenshot = encodeURIComponent(screenshotName);
const encodedScreenshotPath = `/attachments/${encodedScreenshot}`;

test('root attachment folder escapes hostile names and URL-encodes links', async () => {
  await withServer(async (base) => {
    const response = await getRaw(base, '/attachments/');
    expect(response.status).toBe(200);
    expect(response.body).toContain('evil &amp; &#039;quote&#039;.png');
    expect(response.body).toContain(`href="${encodedScreenshotPath}"`);
    expect(response.body).not.toContain('<script');
  });
});

test('root attachment file route serves encoded names and blocks traversal', async () => {
  await withServer(async (base) => {
    const file = await getRaw(base, encodedScreenshotPath);
    expect(file.status).toBe(200);
    expect(file.body).toBe('png-fixture');

    const traversal = await getRaw(base, '/attachments/%2e%2e/test-summary.json');
    expect(traversal.status).toBe(404);
  });
});

test('latest detail links evidence under the root attachments route', async () => {
  await withServer(async (base) => {
    const response = await getRaw(base, '/latest');
    expect(response.status).toBe(200);
    expect(response.body).toContain(encodedScreenshotPath);
    expect(response.body).toContain(encodedScreenshotPath);
  });
});

test('archive preserves rich fields and exposes archive and fragment evidence links', async () => {
  archive = saveLatestRun({
    qaDecision: 'APPROVE',
    qaNotes: 'Evidence fixture',
    displayName: 'Evidence integrity run',
    triggerSource: 'test-fixture',
  });

  const archivedSummary = loadArchivedSummary(archive.runId);
  const archivedCase = (archivedSummary?.testCases as Array<Record<string, unknown>>)[0];
  expect(archivedCase.fullTitle).toBe('Evidence > Rich evidence record');
  expect(archivedCase.inputData).toEqual({ period: 'Q1-2026' });
  expect(archivedCase.expectedResult).toBe('Evidence remains available');
  expect(archivedCase.actualResult).toBe('Evidence remains available');
  expect(archivedCase.steps).toHaveLength(1);
  expect(archivedCase.attachments).toHaveLength(1);
  expect(fs.existsSync(path.join(archive.archivePath, 'attachments', screenshotName))).toBe(true);

  await withServer(async (base) => {
    const archiveFolder = await getRaw(base, `/api/archive/${archive.runId}/attachments`);
    expect(archiveFolder.status).toBe(200);
    expect(archiveFolder.body).toContain(
      `href="/api/archive/${archive.runId}/attachments/${encodedScreenshot}"`,
    );
    expect(archiveFolder.body).toContain('evil &amp; &#039;quote&#039;.png');

    const archiveFile = await getRaw(
      base,
      `/api/archive/${archive.runId}/attachments/${encodedScreenshot}`,
    );
    expect(archiveFile.status).toBe(200);
    expect(archiveFile.body).toBe('png-fixture');

    const encodedTraversal = await getRaw(
      base,
      `/api/archive/${archive.runId}/attachments/%252e%252e/%252e%252e/test-summary.json`,
    );
    expect(encodedTraversal.status).toBe(404);

    const detail = await getRaw(base, `/history/${archive.runId}`);
    expect(detail.status).toBe(200);
    expect(detail.body).toContain(
      `/api/archive/${archive.runId}/${encodedScreenshotPath.slice(1)}`,
    );

    const fragment = await getRaw(base, `/fragment/detail/${archive.runId}`);
    expect(fragment.status).toBe(200);
    expect(fragment.body).toContain(
      `/api/archive/${archive.runId}/attachments/${encodedScreenshot.replace(/'/g, '&#039;')}`,
    );
  });
});

test('empty archive attachment folder returns a successful empty listing', async () => {
  const emptyRunId = 'run-20260821-102031-124';
  fs.mkdirSync(path.join(archiveDir, emptyRunId, 'attachments'), { recursive: true });
  await withServer(async (base) => {
    const response = await getRaw(base, `/api/archive/${emptyRunId}/attachments/`);
    expect(response.status).toBe(200);
    expect(response.body).toContain('No files recorded');
  });
});
