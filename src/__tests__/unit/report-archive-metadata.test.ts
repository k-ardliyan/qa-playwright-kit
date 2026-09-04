import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const TMP_ARCHIVE_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-meta-test-'));
const TMP_ARCHIVE_DIR = path.join(TMP_ARCHIVE_ROOT, 'reports', 'archive');
fs.mkdirSync(TMP_ARCHIVE_DIR, { recursive: true });
process.env['QA_ARCHIVE_DIR'] = TMP_ARCHIVE_DIR;
process.env['QA_REPORT_DIR'] = path.join(TMP_ARCHIVE_ROOT, 'reports');

import { test, expect } from '@playwright/test';
import {
  updateArchivedMetadata,
  loadArchivedMetadata,
  type ArchiveMetadata,
} from '../../agents/reporter/report-archive';
import { getComparisonCompatibility } from '../../agents/reporter/report-compare';

function createArchiveFixture(runId: string, meta: Partial<ArchiveMetadata> = {}): void {
  const runDir = path.join(TMP_ARCHIVE_DIR, runId);
  fs.mkdirSync(runDir, { recursive: true });

  const metadata: ArchiveMetadata = {
    schemaVersion: 2,
    runId,
    displayName: meta.displayName || 'Test Run Label',
    testSeriesId: meta.testSeriesId || 'auth-login',
    requirementId: meta.requirementId || 'REQ-AUTH-001',
    requirementTitle: meta.requirementTitle || 'Login Flow',
    savedAt: meta.savedAt || new Date().toISOString(),
    ranAt: meta.ranAt || new Date().toISOString(),
    appEnv: meta.appEnv || 'staging',
    qaDecision: meta.qaDecision || 'APPROVE',
    qaNotes: meta.qaNotes || 'Initial notes',
    triggeredBy: 'manual',
    triggerSource: 'cli',
  };

  fs.writeFileSync(path.join(runDir, 'metadata.json'), JSON.stringify(metadata, null, 2), 'utf-8');
  fs.writeFileSync(
    path.join(runDir, 'summary.json'),
    JSON.stringify({ total: 5, passed: 5, failed: 0, skipped: 0, passRate: 100 }, null, 2),
    'utf-8',
  );
}

test.describe('updateArchivedMetadata', () => {
  const RUN_ID = 'run-20260820-120000-001';

  test.beforeAll(() => {
    createArchiveFixture(RUN_ID, {
      displayName: 'Original Label',
      testSeriesId: 'auth-series',
      appEnv: 'staging',
      qaDecision: 'APPROVE',
    });
  });

  test.afterAll(() => {
    fs.rmSync(TMP_ARCHIVE_ROOT, { recursive: true, force: true });
    delete process.env['QA_ARCHIVE_DIR'];
    delete process.env['QA_REPORT_DIR'];
  });

  test('updates displayName, testSeriesId, qaDecision, and qaNotes while preserving schemaVersion and appEnv', () => {
    const updated = updateArchivedMetadata(RUN_ID, {
      displayName: 'Updated Label Staging RC2',
      testSeriesId: 'auth-series-v2',
      qaDecision: 'FILE_BUG',
      qaNotes: 'Found visual defect on mobile viewport',
    });

    expect(updated).not.toBeNull();
    expect(updated?.schemaVersion).toBe(2);
    expect(updated?.displayName).toBe('Updated Label Staging RC2');
    expect(updated?.testSeriesId).toBe('auth-series-v2');
    expect(updated?.qaDecision).toBe('FILE_BUG');
    expect(updated?.qaNotes).toBe('Found visual defect on mobile viewport');
    expect(updated?.appEnv).toBe('staging'); // preserves existing appEnv

    // Verify disk persistence
    const loaded = loadArchivedMetadata(RUN_ID);
    expect(loaded?.displayName).toBe('Updated Label Staging RC2');
    expect(loaded?.qaDecision).toBe('FILE_BUG');
    expect(loaded?.schemaVersion).toBe(2);
  });

  test('rejects path traversal or invalid runId', () => {
    expect(() => {
      updateArchivedMetadata('../etc/passwd', { displayName: 'Hacked' });
    }).toThrow(/Invalid runId/);
  });

  test('rejects invalid decisions and empty labels at the archive boundary', () => {
    expect(() => updateArchivedMetadata(RUN_ID, { qaDecision: 'NOT_A_DECISION' as never })).toThrow(
      /Invalid qaDecision/,
    );
    expect(() => updateArchivedMetadata(RUN_ID, { displayName: '   ' })).toThrow(/displayName/);
  });

  test('rejects invalid metadata instead of silently treating it as approved', () => {
    const metadataPath = path.join(TMP_ARCHIVE_DIR, RUN_ID, 'metadata.json');
    const original = fs.readFileSync(metadataPath, 'utf-8');
    fs.writeFileSync(
      metadataPath,
      JSON.stringify({ runId: RUN_ID, qaDecision: 'invalid' }),
      'utf-8',
    );
    expect(loadArchivedMetadata(RUN_ID)).toBeNull();
    fs.writeFileSync(metadataPath, original, 'utf-8');
  });

  test('returns null for nonexistent runId', () => {
    const res = updateArchivedMetadata('run-20990101-000000-000', {
      displayName: 'Does not exist',
    });
    expect(res).toBeNull();
  });
});

test.describe('getComparisonCompatibility', () => {
  test('returns exact when same testSeriesId, same appEnv, and >= 75% overlap', () => {
    const base = {
      runId: 'run-1',
      timestamp: '2026-08-20T10:00:00.000Z',
      appEnv: 'staging',
      requirementPath: 'requirements/auth.md',
      passRate: 100,
      totalTests: 2,
      scenarios: [
        { scenarioId: 'SC-01', name: 'Login 1', status: 'passed' as const },
        { scenarioId: 'SC-02', name: 'Login 2', status: 'passed' as const },
      ],
    };
    const cand = {
      runId: 'run-2',
      timestamp: '2026-08-20T11:00:00.000Z',
      appEnv: 'staging',
      requirementPath: 'requirements/auth.md',
      passRate: 100,
      totalTests: 2,
      scenarios: [
        { scenarioId: 'SC-01', name: 'Login 1', status: 'passed' as const },
        { scenarioId: 'SC-02', name: 'Login 2', status: 'passed' as const },
      ],
    };
    const meta1: ArchiveMetadata = {
      runId: 'run-1',
      testSeriesId: 'auth-series',
      appEnv: 'staging',
      savedAt: '',
      ranAt: '',
      qaDecision: 'APPROVE',
      qaNotes: '',
      triggeredBy: 'manual',
      triggerSource: 'cli',
    };
    const meta2: ArchiveMetadata = {
      runId: 'run-2',
      testSeriesId: 'auth-series',
      appEnv: 'staging',
      savedAt: '',
      ranAt: '',
      qaDecision: 'APPROVE',
      qaNotes: '',
      triggeredBy: 'manual',
      triggerSource: 'cli',
    };

    const compat = getComparisonCompatibility(base, cand, meta1, meta2);
    expect(compat.level).toBe('exact');
    expect(compat.sameTestSeries).toBe(true);
    expect(compat.sameEnvironment).toBe(true);
    expect(compat.overlapRatio).toBe(1);
  });

  test('returns mismatch when different series, different env, and < 40% overlap', () => {
    const base = {
      runId: 'run-1',
      timestamp: '2026-08-20T10:00:00.000Z',
      appEnv: 'staging',
      requirementPath: 'requirements/auth.md',
      passRate: 100,
      totalTests: 1,
      scenarios: [{ scenarioId: 'SC-01', name: 'Login 1', status: 'passed' as const }],
    };
    const cand = {
      runId: 'run-2',
      timestamp: '2026-08-20T11:00:00.000Z',
      appEnv: 'production',
      requirementPath: 'requirements/billing.md',
      passRate: 100,
      totalTests: 1,
      scenarios: [{ scenarioId: 'SC-99', name: 'Invoice 1', status: 'passed' as const }],
    };

    const compat = getComparisonCompatibility(base, cand, null, null);
    expect(compat.level).toBe('mismatch');
    expect(compat.sameTestSeries).toBe(false);
    expect(compat.sameEnvironment).toBe(false);
    expect(compat.overlapRatio).toBe(0);
  });
});
