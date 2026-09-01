/**
 * NOTE: QA_ARCHIVE_DIR must be set BEFORE this module is imported,
 * because report-archive.ts resolves ARCHIVE_DIR at module load time.
 * We set it here at the top of the file so it takes effect when
 * compareReports (and transitively report-archive) is first imported.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

// Create a temp archive dir and set the env var BEFORE any imports from
// report-archive (via report-compare), so the module-level constant picks it up.
const TMP_ARCHIVE_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-compare-'));
const TMP_ARCHIVE_DIR = path.join(TMP_ARCHIVE_ROOT, 'reports', 'archive');
fs.mkdirSync(TMP_ARCHIVE_DIR, { recursive: true });
process.env['QA_ARCHIVE_DIR'] = TMP_ARCHIVE_DIR;
process.env['QA_REPORT_DIR'] = path.join(TMP_ARCHIVE_ROOT, 'reports');

// Now import modules that depend on ARCHIVE_DIR — they will pick up the env var.
import { test, expect } from '@playwright/test';
import { compareReports, classifyChange } from '../../agents/reporter/report-compare';

function scenario(status: string, errorMessage?: string) {
  return {
    scenarioId: 'SC-01',
    name: 'sample scenario',
    status,
    errorMessage,
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function writeArchiveFixture(runId: string, timestamp: string, passRate: number): void {
  const runDir = path.join(TMP_ARCHIVE_DIR, runId);
  fs.mkdirSync(runDir, { recursive: true });

  const summary = {
    total: 1,
    passed: passRate === 100 ? 1 : 0,
    failed: passRate === 100 ? 0 : 1,
    skipped: 0,
    passRate,
    timestamp,
    testCases: [
      {
        testId: 'TC-01',
        title: 'sample',
        status: passRate === 100 ? 'passed' : 'failed',
        role: '',
        module: 'demo',
        feature: 'nav',
      },
    ],
  };
  fs.writeFileSync(path.join(runDir, 'summary.json'), JSON.stringify(summary, null, 2), 'utf-8');

  const metadata = {
    runId,
    savedAt: timestamp,
    ranAt: timestamp,
    appEnv: 'local',
    qaDecision: 'APPROVE',
    qaNotes: '',
    triggeredBy: 'manual',
    triggerSource: 'cli',
  };
  fs.writeFileSync(path.join(runDir, 'metadata.json'), JSON.stringify(metadata, null, 2), 'utf-8');
}

// ─── Tests ────────────────────────────────────────────────────────────────────

test.describe('classifyChange — healed status transitions', () => {
  test('healed → passed is a FIX (healer succeeded, now green)', () => {
    const diff = classifyChange(scenario('healed'), scenario('passed'));
    expect(diff.change).toBe('fix');
  });

  test('passed → healed is UNCHANGED (still green)', () => {
    const diff = classifyChange(scenario('passed'), scenario('healed'));
    expect(diff.change).toBe('unchanged');
  });

  test('skipped → healed is a FIX (previously not run, now green)', () => {
    const diff = classifyChange(scenario('skipped'), scenario('healed'));
    expect(diff.change).toBe('fix');
  });

  test('healed → skipped is FLAKY (lost green status)', () => {
    const diff = classifyChange(scenario('healed'), scenario('skipped'));
    expect(diff.change).toBe('flaky');
  });

  test('healed → failed is a REGRESSION', () => {
    const diff = classifyChange(scenario('healed'), scenario('failed'));
    expect(diff.change).toBe('regression');
  });

  test('failed → healed is a FIX', () => {
    const diff = classifyChange(scenario('failed'), scenario('healed'));
    expect(diff.change).toBe('fix');
  });
});

test.describe('classifyChange — baseline transitions still correct', () => {
  test('passed → failed is a REGRESSION', () => {
    expect(classifyChange(scenario('passed'), scenario('failed')).change).toBe('regression');
  });

  test('failed → passed is a FIX', () => {
    expect(classifyChange(scenario('failed'), scenario('passed')).change).toBe('fix');
  });

  test('passed → passed is UNCHANGED', () => {
    expect(classifyChange(scenario('passed'), scenario('passed')).change).toBe('unchanged');
  });

  test('failed → failed with same error is STABLE', () => {
    const diff = classifyChange(scenario('failed', 'timeout'), scenario('failed', 'timeout'));
    expect(diff.change).toBe('stable');
  });

  test('failed → failed with different error is FLAKY', () => {
    const diff = classifyChange(scenario('failed', 'timeout'), scenario('failed', 'selector'));
    expect(diff.change).toBe('flaky');
  });
});

test.describe('report-compare error contract', () => {
  const RUN_A = 'run-20260804-122732-610'; // earlier
  const RUN_B = 'run-20260804-132457-920'; // later

  test.beforeAll(() => {
    writeArchiveFixture(RUN_A, '2026-08-04T12:27:32.610Z', 80);
    writeArchiveFixture(RUN_B, '2026-08-04T13:24:57.920Z', 100);
  });

  test.afterAll(() => {
    fs.rmSync(TMP_ARCHIVE_ROOT, { recursive: true, force: true });
    delete process.env['QA_ARCHIVE_DIR'];
    delete process.env['QA_REPORT_DIR'];
  });

  test('compareReports with missing run returns { error } object (truthy!)', () => {
    const result = compareReports('run-19990101-000000-000', 'run-19990102-000000-000');
    // This is the contract the server route relies on: an error result is a
    // truthy object with an `error` key — routes MUST check `'error' in result`,
    // never `!result` (which would treat the error object as success).
    expect(result).toBeTruthy();
    expect('error' in result).toBe(true);
    if ('error' in result) {
      expect(result.error).toContain('not found');
    }
  });

  test('compareReports with valid runs returns ReportComparison (no error key)', () => {
    const result = compareReports(RUN_A, RUN_B);
    expect(result).toBeTruthy();
    expect('error' in result).toBe(false);
    if (!('error' in result)) {
      expect(result.baselineRunId).toBe(RUN_A);
      expect(result.comparisonRunId).toBe(RUN_B);
      expect(typeof result.passRateDelta).toBe('number');
    }
  });

  test('compareReports swaps runs to chronological order', () => {
    // Reversed args — newer first.
    const result = compareReports(RUN_B, RUN_A);
    expect('error' in result).toBe(false);
    if (!('error' in result)) {
      // Older run becomes baseline, newer becomes comparison.
      expect(result.baselineRunId).toBe(RUN_A);
      expect(result.comparisonRunId).toBe(RUN_B);
    }
  });
});
