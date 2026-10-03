import { test, expect } from '@playwright/test';
import { TestDetail } from '../../support/custom-dashboard/components/detail/TestDetail';
import { TriageStrip } from '../../support/custom-dashboard/components/detail/TriageStrip';
import { AttentionPanel } from '../../support/custom-dashboard/pages/dashboard/AttentionPanel';
import { groupUnhealthyTests } from '../../support/custom-dashboard/domain/triage';
import { buildDashboardOverview } from '../../support/custom-dashboard/domain/dashboard-overview';
import type { CollectedTestData } from '../../support/custom-dashboard/types';

/**
 * Dashboard honesty fixes (dead-info inventory rounds 1–2). Each assertion
 * pins a value the dashboard used to INVENT rather than measure:
 *   - the Actual box tone (sniffed the message text instead of the verdict)
 *   - the triage evidence label (a yes/no instead of real counts)
 *   - "recurring" failures (always 1 occurrence)
 *   - the active test-series count (floored to 1 with no data)
 */

function caseOf(overrides: Partial<CollectedTestData>): CollectedTestData {
  return {
    title: 'SC-1 sample',
    fullTitle: 'SC-1 sample',
    filePath: 'tests/sample.spec.ts',
    status: 'passed',
    duration: 100,
    errorMessage: '',
    errors: [],
    steps: [],
    attachments: [],
    retry: 0,
    testId: 'SC-1',
    scenarioId: 'SC-1',
    role: 'user',
    module: 'auth',
    feature: 'login',
    priority: 'medium',
    inputData: {},
    expectedResult: 'ok',
    actualResult: 'ok',
    affectedLayer: [],
    ...overrides,
  } as CollectedTestData;
}

function resultBoxClass(html: string): string | null {
  const m = html.match(/class="(result-box result-box--\w+)"/);
  return m ? m[1] : null;
}

test.describe('Actual-result box tone follows the verdict', () => {
  test('a PASSED test whose text mentions "error" is not painted as failed', () => {
    // The old heuristic lowercased actualResult and looked for "error" — so a
    // passing check whose expected text says "memastikan error tidak muncul"
    // rendered a red box. The verdict is the only honest source.
    const html = String(
      TestDetail({
        testData: caseOf({
          status: 'passed',
          expectedResult: 'Error tidak muncul',
          actualResult: 'Error tidak muncul',
        }),
        index: 0,
      }),
    );
    expect(resultBoxClass(html)).toBe('result-box result-box--passed');
  });

  test('a FAILED test whose message has no keyword is still painted as failed', () => {
    const html = String(
      TestDetail({
        testData: caseOf({
          status: 'failed',
          expectedResult: 'Data tersimpan',
          actualResult: 'Data tidak tersimpan',
        }),
        index: 1,
      }),
    );
    expect(resultBoxClass(html)).toBe('result-box result-box--failed');
  });

  test('timedOut and interrupted are unhealthy too', () => {
    for (const status of ['timedOut', 'interrupted'] as const) {
      const html = String(
        TestDetail({ testData: caseOf({ status, actualResult: 'apa saja' }), index: 2 }),
      );
      expect(resultBoxClass(html), `status ${status} must read as failed`).toBe(
        'result-box result-box--failed',
      );
    }
  });
});

test.describe('Triage evidence label reports real counts', () => {
  test('a test with one trace and one screenshot says so', () => {
    const groups = groupUnhealthyTests([
      {
        testId: 'SC-9',
        scenarioId: 'SC-9',
        title: 'Boom',
        status: 'failed',
        failureSource: 'app',
        attachmentCount: 2,
        attachments: [
          { kind: 'trace', relativePath: 'attachments/t.zip' },
          { kind: 'screenshot', relativePath: 'attachments/s.png' },
        ],
      },
    ]);
    const html = String(TriageStrip({ groups }));
    expect(html).toContain('trace ×1');
    expect(html).toContain('screenshot ×1');
  });

  test('a test with no evidence shows no evidence label at all', () => {
    const groups = groupUnhealthyTests([
      { testId: 'SC-8', title: 'Quiet', status: 'failed', failureSource: 'app' },
    ]);
    const html = String(TriageStrip({ groups }));
    expect(html).not.toContain('trace ×');
    expect(html).not.toContain('screenshot ×');
  });
});

test.describe('Attention panel counts recurrence', () => {
  test('a single-run failure stays visible without a fake recurrence count', () => {
    const html = String(
      AttentionPanel({
        recurringFailures: [{ scenarioId: 'SC-1', title: 'Login', occurrences: 1 }],
      }),
    );
    expect(html).toContain('Login');
    expect(html).not.toContain('×1');
  });

  test('the occurrence count is rendered, not just implied', () => {
    const html = String(
      AttentionPanel({
        recurringFailures: [
          {
            scenarioId: 'SC-1',
            title: 'Login',
            occurrences: 3,
            lastErrorMessage: 'timeout',
            lastFailureSource: 'app',
          },
        ],
      }),
    );
    expect(html).toContain('×3');
  });
});

test.describe('buildDashboardOverview measures instead of inventing', () => {
  const summary = {
    total: 1,
    passed: 0,
    failed: 1,
    skipped: 0,
    passRate: 0,
    timestamp: '2026-10-02T00:00:00.000Z',
    reportMode: 'general',
    testCases: [
      {
        testId: 'SC-1',
        scenarioId: 'SC-1',
        title: 'Login',
        status: 'failed',
        errorMessage: 'boom',
        failureSource: 'app',
      },
    ],
    runMeta: {
      appEnv: 'dev',
      ci: false,
      totalDurationMs: 10,
      generatedAt: '2026-10-02T00:00:00.000Z',
    },
  };

  test('a failure seen in only one run is not counted as recurring', () => {
    const overview = buildDashboardOverview({ latestSummary: summary, history: [] });
    expect(overview.recurringFailures[0]?.occurrences).toBe(1);
  });

  test('the same scenario failing in three archived runs counts three', () => {
    const overview = buildDashboardOverview({
      latestSummary: summary,
      history: [
        { runId: 'r1', failedTestIds: ['SC-1'] },
        { runId: 'r2', failedTestIds: ['SC-1'] },
        { runId: 'r3', failedTestIds: ['OTHER'] },
      ] as never,
    });
    // Two archives + the latest run all report SC-1.
    expect(overview.recurringFailures[0]?.occurrences).toBe(3);
  });

  test('an already-archived latest run is counted once for recurrence', () => {
    const archivedLatest = { ...summary, runId: 'run-latest' };
    const overview = buildDashboardOverview({
      latestSummary: archivedLatest,
      latestRunArchived: true,
      history: [{ runId: 'run-latest', failedTestIds: ['SC-1'] }] as never,
    });
    expect(overview.recurringFailures[0]?.occurrences).toBe(1);
  });

  test('filters stale hot-module insight with a placeholder module', () => {
    const overview = buildDashboardOverview({
      latestSummary: {
        ...summary,
        aiInsights: [
          'Jenis: Trend — Modul "-" mencatat failure terbanyak (2 dari 4 gagal).',
          'Jenis: Trend — Modul "invoice" mencatat failure terbanyak (2 dari 4 gagal).',
        ],
      },
      history: [],
    });
    expect(overview.aiRunInsights.map((insight) => insight.text)).toEqual([
      'Jenis: Trend — Modul "invoice" mencatat failure terbanyak (2 dari 4 gagal).',
    ]);
  });

  test('active test series is 0 with no saved runs, not a floored 1', () => {
    const overview = buildDashboardOverview({ latestSummary: summary, history: [] });
    expect(overview.metrics.activeTestSeriesCount).toBe(0);
  });
});
