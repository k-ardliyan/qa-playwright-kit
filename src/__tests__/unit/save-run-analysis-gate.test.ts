import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const TMP_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-save-gate-'));
const TMP_REPORT_DIR = path.join(TMP_ROOT, 'reports');
const TMP_ARCHIVE_DIR = path.join(TMP_REPORT_DIR, 'archive');
fs.mkdirSync(TMP_ARCHIVE_DIR, { recursive: true });
process.env['QA_REPORT_DIR'] = TMP_REPORT_DIR;
process.env['QA_ARCHIVE_DIR'] = TMP_ARCHIVE_DIR;

import { test, expect } from '@playwright/test';
import { saveLatestRun } from '../../agents/reporter/report-archive';
import { appendLatestRunInsight } from '../../agents/reporter/test-notes';

function writeSummary(summary: Record<string, unknown>): void {
  fs.writeFileSync(
    path.join(TMP_REPORT_DIR, 'test-summary.json'),
    JSON.stringify(
      { total: 2, passed: 2, failed: 0, skipped: 0, passRate: 100, ...summary },
      null,
      2,
    ),
    'utf-8',
  );
  fs.writeFileSync(
    path.join(TMP_REPORT_DIR, '.latest-run'),
    JSON.stringify({ timestamp: summary.timestamp, total: 2 }),
    'utf-8',
  );
}

test.afterEach(() => {
  // Reset sidecar + summary between tests
  fs.rmSync(path.join(TMP_REPORT_DIR, 'test-notes.json'), { force: true });
});

test.afterAll(() => {
  fs.rmSync(TMP_ROOT, { recursive: true, force: true });
  delete process.env['QA_REPORT_DIR'];
  delete process.env['QA_ARCHIVE_DIR'];
});

test.describe('saveLatestRun Analyze gate (dashboard/CLI archive path)', () => {
  test('APPROVE on a pipeline run without analysis declaration is rejected', () => {
    writeSummary({
      timestamp: '2026-09-06T09:00:00.000Z',
      requirementPath: 'requirements/auth/login-auto.md',
    });
    expect(() => saveLatestRun({ qaDecision: 'APPROVE', triggerSource: 'cli' })).toThrow(
      /ANALYSIS_UNVERIFIABLE/,
    );
    // No partial archive may exist
    expect(fs.readdirSync(TMP_ARCHIVE_DIR).filter((d) => d.startsWith('run-'))).toEqual([]);
  });

  test('APPROVE on a pipeline run WITH agent run insights succeeds and carries notes', () => {
    writeSummary({
      timestamp: '2026-09-06T09:10:00.000Z',
      requirementPath: 'requirements/auth/login-auto.md',
      analysis: {
        completed: true,
        runInsightsRecorded: 1,
        passedScenariosReviewed: 0,
      },
    });
    appendLatestRunInsight({ kind: 'trend', observation: 'flow B lebih stabil' }, 'reporter', {
      runId: 'run-20260906-161000-000',
    });

    const result = saveLatestRun({ qaDecision: 'APPROVE', triggerSource: 'cli' });
    expect(result.runId).toMatch(/^run-\d{8}-\d{6}-\d{3}$/);
    expect(result.analysisVerdict).toBe('complete');
    expect(result.analysisVerified).toBe(true);
    // Sidecar carried into the archive and reset for the next run
    expect(fs.existsSync(path.join(TMP_ARCHIVE_DIR, result.runId, 'test-notes.json'))).toBe(true);
    expect(fs.existsSync(path.join(TMP_REPORT_DIR, 'test-notes.json'))).toBe(false);
  });

  test('non-APPROVE decisions are not gated', () => {
    writeSummary({
      timestamp: '2026-09-06T09:20:00.000Z',
      requirementPath: 'requirements/auth/login-auto.md',
    });
    const result = saveLatestRun({ qaDecision: 'MARK_BLOCKED', triggerSource: 'cli' });
    expect(result.runId).toMatch(/^run-/);
  });

  test('plain runs (no requirementPath) are not gated', () => {
    writeSummary({ timestamp: '2026-09-06T09:30:00.000Z' });
    const result = saveLatestRun({ qaDecision: 'APPROVE', triggerSource: 'cli' });
    expect(result.runId).toMatch(/^run-/);
  });
});
