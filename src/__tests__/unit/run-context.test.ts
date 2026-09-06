import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const TMP_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-run-context-'));
const TMP_REPORT_DIR = path.join(TMP_ROOT, 'reports');
fs.mkdirSync(TMP_REPORT_DIR, { recursive: true });
process.env['QA_REPORT_DIR'] = TMP_REPORT_DIR;

import { test, expect } from '@playwright/test';
import {
  clearPendingRun,
  ensurePendingRun,
  readPendingRun,
  resolveCurrentRunIdentity,
} from '../../agents/reporter/run-context';
import {
  isStaleSidecar,
  loadLatestTestNotes,
  resetLatestTestNotes,
  upsertLatestTestNote,
  emptyTestNotesFile,
} from '../../agents/reporter/test-notes';

test.afterAll(() => {
  fs.rmSync(TMP_ROOT, { recursive: true, force: true });
  delete process.env['QA_REPORT_DIR'];
});

test.describe('pending pipeline run identity', () => {
  test.afterEach(() => clearPendingRun());

  test('ensurePendingRun creates a canonical marker and reuses it within one pipeline', () => {
    const first = ensurePendingRun();
    expect(first.runId).toMatch(/^run-\d{8}-\d{6}-\d{3}$/);
    expect(readPendingRun()?.runId).toBe(first.runId);

    const second = ensurePendingRun();
    expect(second.runId).toBe(first.runId);
  });

  test('marker older than TTL is ignored and cleared', () => {
    const markerPath = path.join(TMP_REPORT_DIR, '.pending-run.json');
    const stale = {
      runId: 'run-20250101-000000-000',
      ranAt: '2025-01-01T00:00:00.000Z',
      createdAt: '2025-01-01T00:00:00.000Z',
    };
    fs.writeFileSync(markerPath, JSON.stringify(stale), 'utf-8');
    expect(readPendingRun()).toBeNull();
    expect(fs.existsSync(markerPath)).toBe(false);
  });

  test('resolveCurrentRunIdentity prefers pending over the latest summary', () => {
    // No pending, no summary in tmp dir → null
    expect(resolveCurrentRunIdentity()).toBeNull();

    const pending = ensurePendingRun();
    const identity = resolveCurrentRunIdentity();
    expect(identity?.source).toBe('pending');
    expect(identity?.runId).toBe(pending.runId);
  });

  test('generator pre-run notes stamped with the pending id survive the reporter staleness check', () => {
    const pending = ensurePendingRun();
    upsertLatestTestNote(
      'SC-GEN-01::general',
      { aiNotes: 'skeleton: seed belum ada' },
      {
        runId: pending.runId,
      },
    );

    // Reporter adopts the pending identity → sidecar is NOT stale
    expect(isStaleSidecar(loadSidecar(), pending.runId)).toBe(false);
    // ...while a sidecar from a different run is still stale
    expect(isStaleSidecar(loadSidecar(), 'run-20260906-999999-999')).toBe(true);
  });

  test('full contract: generator note survives adoption and marker cleanup', () => {
    // Isolate: fresh sidecar for this scenario chain
    resetLatestTestNotes();
    // 1. Pipeline start — pending marker created
    const pending = ensurePendingRun();
    // 2. Generator records a pre-run insight (stamped pending)
    upsertLatestTestNote(
      'SC-GEN-02::general',
      { aiNotes: 'skeleton dibuat: OTP tidak testable' },
      {
        runId: pending.runId,
      },
    );
    // 3. Reporter adopts pending as canonical run identity (runMeta.generatedAt
    //    = pending.ranAt) and 4. clears the marker after stamping
    clearPendingRun();

    // The note MUST still be in the sidecar and attributable to the run
    const sidecar = loadLatestTestNotes();
    expect(sidecar.runId).toBe(pending.runId);
    expect(sidecar.notes['SC-GEN-02::general']?.aiNotes).toContain('OTP tidak testable');
    expect(isStaleSidecar(sidecar, pending.runId)).toBe(false);
  });

  test('clearPendingRun removes the marker', () => {
    ensurePendingRun();
    clearPendingRun();
    expect(readPendingRun()).toBeNull();
    expect(fs.existsSync(path.join(TMP_REPORT_DIR, '.pending-run.json'))).toBe(false);
  });
});

function loadSidecar() {
  return loadLatestTestNotes() ?? emptyTestNotesFile();
}
