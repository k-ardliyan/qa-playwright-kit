import { test, expect } from '@playwright/test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as nodePath from 'node:path';

/**
 * The archived detail page builds a fresh summary literal before rendering.
 * These tests cover that wiring end-to-end: archive files on disk → summary
 * literal → rendered HTML. A component-level test cannot catch a dropped field.
 *
 * Both env vars are set because `archiveDir()` (report-archive.ts:161) prefers
 * QA_ARCHIVE_DIR, and sibling specs assign it at module scope — a leak that
 * only shows up in a full-suite run.
 */
let tmpDir: string;
let prevReportDir: string | undefined;
let prevArchiveDir: string | undefined;

test.beforeEach(() => {
  tmpDir = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'pwkit-archived-detail-'));
  prevReportDir = process.env['QA_REPORT_DIR'];
  prevArchiveDir = process.env['QA_ARCHIVE_DIR'];
  process.env['QA_REPORT_DIR'] = tmpDir;
  process.env['QA_ARCHIVE_DIR'] = nodePath.join(tmpDir, 'archive');
});

test.afterEach(() => {
  if (prevReportDir === undefined) delete process.env['QA_REPORT_DIR'];
  else process.env['QA_REPORT_DIR'] = prevReportDir;
  if (prevArchiveDir === undefined) delete process.env['QA_ARCHIVE_DIR'];
  else process.env['QA_ARCHIVE_DIR'] = prevArchiveDir;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeArchive(
  runId: string,
  summary: Record<string, unknown>,
  metadata: Record<string, unknown>,
): void {
  const dir = nodePath.join(tmpDir, 'archive', runId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(nodePath.join(dir, 'summary.json'), JSON.stringify(summary));
  fs.writeFileSync(nodePath.join(dir, 'metadata.json'), JSON.stringify(metadata));
}

const baseSummary = {
  total: 2,
  passed: 1,
  failed: 1,
  skipped: 0,
  passRate: 50,
  timestamp: '2026-08-20T10:00:00.000Z',
  reportMode: 'general',
  rolesInScope: [],
  testCases: [],
  runMeta: {
    appEnv: 'staging',
    runId: 'run-20260820-100000-001',
    ci: false,
    totalDurationMs: 1000,
    generatedAt: '2026-08-20T10:00:00.000Z',
  },
};

const baseMetadata = {
  schemaVersion: 2,
  runId: 'run-20260820-100000-001',
  displayName: 'Archived run',
  appEnv: 'staging',
  ranAt: '2026-08-20T10:00:00.000Z',
  savedAt: '2026-08-20T10:05:00.000Z',
  requirementPath: 'requirements/auth/login.md',
  qaDecision: 'FILE_BUG',
  qaNotes: '',
  triggeredBy: 'manual',
  triggerSource: 'cli',
};

test.describe('archived detail page — Analyze gate wiring', () => {
  test('the gate banner renders the archived verdict and its issues', async () => {
    // Regression: this renderer built a summary literal that omitted all three
    // analysis fields, so the banner could never appear on an archived run even
    // though metadata.json and summary.json both carried them.
    writeArchive('run-20260820-100000-001', baseSummary, {
      ...baseMetadata,
      analysisVerdict: 'incomplete',
      analysisVerified: false,
      analysisIssues: ['Reporter Analyze insight missing', 'Sidecar count mismatch'],
    });

    const { renderArchivedDetailPage } = await import('../../cli/routes/render');
    const html = renderArchivedDetailPage('run-20260820-100000-001');

    expect(html).toBeTruthy();
    expect(html!).toContain('AI ANALYSIS: INCOMPLETE');
    expect(html!).toContain('Reporter Analyze insight missing');
    expect(html!).toContain('Sidecar count mismatch');
  });

  test('a verified archived run shows the verdict without the review warning', async () => {
    writeArchive('run-20260820-110000-001', baseSummary, {
      ...baseMetadata,
      runId: 'run-20260820-110000-001',
      analysisVerdict: 'complete',
      analysisVerified: true,
    });

    const { renderArchivedDetailPage } = await import('../../cli/routes/render');
    const html = renderArchivedDetailPage('run-20260820-110000-001');

    expect(html!).toContain('AI ANALYSIS: COMPLETE');
    expect(html!).not.toContain('Review gate evidence before APPROVE.');
  });

  test('an archive with no analysis record renders no banner at all', async () => {
    writeArchive('run-20260820-120000-001', baseSummary, {
      ...baseMetadata,
      runId: 'run-20260820-120000-001',
    });

    const { renderArchivedDetailPage } = await import('../../cli/routes/render');
    const html = renderArchivedDetailPage('run-20260820-120000-001');

    expect(html!).not.toContain('AI ANALYSIS:');
  });
});
