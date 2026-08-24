import { test, expect } from '@playwright/test';
import { buildDashboardOverview } from '../../support/custom-dashboard/domain/dashboard-overview';
import { DashboardPage } from '../../support/custom-dashboard/pages/dashboard';
import { HistoryPage } from '../../support/custom-dashboard/pages/history';
import { ComparePage } from '../../support/custom-dashboard/pages/compare';
import { ReportDetailPage } from '../../support/custom-dashboard/pages/report-detail';
import type { ReportHistoryEntry } from '../../agents/reporter/report-history';
import type { TestSummary } from '../../support/custom-dashboard/types';

const mockHistory: ReportHistoryEntry[] = [
  {
    runId: 'run-20260820-100000-001',
    displayName: 'Login Regression — Staging RC12',
    testSeriesId: 'auth-login-regression',
    requirementId: 'REQ-AUTH-001',
    requirementPath: 'requirements/auth/login.md',
    triggerSource: 'dashboard-button',
    ranAt: '2026-08-20T10:00:00.000Z',
    savedAt: '2026-08-20T10:05:00.000Z',
    appEnv: 'staging',
    reportMode: 'role-aware',
    totalTests: 10,
    passed: 9,
    failed: 1,
    skipped: 0,
    passRate: 90,
    status: 'partial',
    qaDecision: 'FILE_BUG',
    qaNotes: 'Bug on role cashier',
  },
  {
    runId: 'run-20260819-090000-001',
    displayName: 'Login Regression — Staging RC11',
    testSeriesId: 'auth-login-regression',
    requirementId: 'REQ-AUTH-001',
    requirementPath: 'requirements/auth/login.md',
    triggerSource: 'dashboard-button',
    ranAt: '2026-08-19T09:00:00.000Z',
    savedAt: '2026-08-19T09:05:00.000Z',
    appEnv: 'staging',
    reportMode: 'role-aware',
    totalTests: 10,
    passed: 10,
    failed: 0,
    skipped: 0,
    passRate: 100,
    status: 'success',
    qaDecision: 'APPROVE',
    qaNotes: 'Clean run',
  },
];

const mockSummary: TestSummary = {
  total: 10,
  passed: 9,
  failed: 1,
  skipped: 0,
  passRate: 90,
  timestamp: '2026-08-20T10:00:00.000Z',
  reportMode: 'general',
  rolesInScope: ['admin'],
  testCases: [
    {
      testId: 'TC-01',
      scenarioId: 'SC-01',
      title: 'Successful Login',
      role: 'admin',
      module: 'Auth',
      feature: 'Login',
      status: 'passed',
      priority: 'high',
      duration: 1200,
      inputData: {},
      expectedResult: 'Dashboard shown',
      actualResult: 'Dashboard shown',
      affectedLayer: ['FE'],
      attachmentCount: 0,
      hasTrace: false,
    },
    {
      testId: 'TC-02',
      scenarioId: 'SC-02',
      title: 'Invalid Password',
      role: 'admin',
      module: 'Auth',
      feature: 'Login',
      status: 'failed',
      priority: 'high',
      duration: 1500,
      inputData: {},
      expectedResult: 'Error shown',
      actualResult: 'Timeout waiting for error',
      affectedLayer: ['FE'],
      attachmentCount: 1,
      hasTrace: true,
      errorMessage: 'Timeout 5000ms exceeded waiting for locator',
    },
  ],
  runMeta: {
    appEnv: 'staging',
    ci: false,
    totalDurationMs: 2700,
    generatedAt: '2026-08-20T10:00:00.000Z',
  },
};

test.describe('Modern Reporting Subsystem', () => {
  test('buildDashboardOverview calculates correct quality metrics and trend points', () => {
    const overview = buildDashboardOverview({
      latestRunInfo: {
        timestamp: '2026-08-20T10:00:00.000Z',
        total: 10,
        passed: 9,
        failed: 1,
        skipped: 0,
        passRate: 90,
        reportMode: 'general',
        appEnv: 'staging',
        totalDurationMs: 2700,
      },
      latestSummary: mockSummary as unknown as Record<string, unknown>,
      latestRunArchived: false,
      history: mockHistory,
    });

    expect(overview.latestRun).not.toBeNull();
    expect(overview.latestRun?.passRate).toBe(90);
    expect(overview.latestRun?.totalTests).toBe(10);
    expect(overview.latestRun?.failed).toBe(1);
    expect(overview.metrics.totalArchivedRuns).toBe(2);
    expect(overview.metrics.approvedRunsCount).toBe(1);
    expect(overview.passRateTrend.length).toBe(2);
    expect(overview.recurringFailures.length).toBe(1);
    expect(overview.recurringFailures[0].scenarioId).toBe('TC-02');
  });

  test('DashboardPage renders executive KPI cards, latest run hero, and nav', () => {
    const overview = buildDashboardOverview({
      latestSummary: mockSummary as unknown as Record<string, unknown>,
      latestRunArchived: false,
      history: mockHistory,
    });

    const html = String(
      DashboardPage({
        overview,
        hasLatestRun: true,
        latestRunArchived: false,
        serveMode: true,
      }),
    );

    expect(html).toContain('QA Overview & Quality Health');
    expect(html).toContain('QA Playwright Kit');
    expect(html).toContain('Overall Pass Rate');
    expect(html).toContain('LATEST EXECUTION');
    expect(html).toContain('Open Detailed Report');
    expect(html).toContain('Needs Attention');
  });

  test('HistoryPage renders runs table with human labels and QA decisions', () => {
    const html = String(
      HistoryPage({
        history: mockHistory,
        hasLatestRun: true,
        latestRunArchived: false,
        latestRunId: 'run-20260820-100000-001',
        serveMode: true,
      }),
    );

    expect(html).toContain('Report History');
    expect(html).toContain('Login Regression — Staging RC12');
    expect(html).toContain('FILE_BUG');
    expect(html).toContain('APPROVE');
    expect(html).toContain('decision-file-bug');
    expect(html).toContain('decision-approve');
    expect(html).toContain('Save Run to History');
  });

  test('ComparePage renders comparison stats, compatibility notice, and scenario diffs', () => {
    const comparison = {
      baseline: {
        runId: mockHistory[1].runId,
        displayName: mockHistory[1].displayName || mockHistory[1].runId,
        testSeriesId: mockHistory[1].testSeriesId,
        appEnv: mockHistory[1].appEnv,
        ranAt: mockHistory[1].ranAt,
        passRate: mockHistory[1].passRate,
        totalTests: mockHistory[1].totalTests,
      },
      candidate: {
        runId: mockHistory[0].runId,
        displayName: mockHistory[0].displayName || mockHistory[0].runId,
        testSeriesId: mockHistory[0].testSeriesId,
        appEnv: mockHistory[0].appEnv,
        ranAt: mockHistory[0].ranAt,
        passRate: mockHistory[0].passRate,
        totalTests: mockHistory[0].totalTests,
      },
      baselineRunId: mockHistory[1].runId,
      comparisonRunId: mockHistory[0].runId,
      baselineTimestamp: mockHistory[1].ranAt,
      comparisonTimestamp: mockHistory[0].ranAt,
      baselinePassRate: mockHistory[1].passRate,
      comparisonPassRate: mockHistory[0].passRate,
      compatibility: {
        level: 'exact' as const,
        reasons: ['Same test series: auth-login-regression', 'Same environment: staging'],
        overlapRatio: 1.0,
        scenarioIntersectionCount: 2,
        scenarioUnionCount: 2,
        sameTestSeries: true,
        sameEnvironment: true,
      },
      isCandidateOlder: false,
      passRateDelta: -10,
      summary: {
        regressed: 1,
        fixed: 0,
        stableFailures: 0,
        flaky: 0,
        new: 0,
        removed: 0,
        totalScenarios: 2,
      },
      regressions: [
        {
          scenarioId: 'SC-02',
          name: 'Invalid Password',
          role: 'admin',
          module: 'Auth',
          previousStatus: 'passed' as const,
          currentStatus: 'failed' as const,
          currentError: 'Timeout 5000ms exceeded',
          change: 'regression' as const,
        },
      ],
      fixes: [],
      stableFailures: [],
      flakyScenarios: [],
      newScenarios: [],
      removedScenarios: [],
    };

    const html = String(
      ComparePage({
        history: mockHistory,
        comparison,
        selectedBaseline: mockHistory[1].runId,
        selectedCandidate: mockHistory[0].runId,
        serveMode: true,
      }),
    );

    expect(html).toContain('Compare Test Runs');
    expect(html).toContain('Exact Match — High Confidence Comparison');
    expect(html).toContain('Regressions');
    expect(html).toContain('Invalid Password');
    expect(html).toContain('diff-regression');
  });

  test('ReportDetailPage renders full test detail view with breadcrumbs', () => {
    const html = String(
      ReportDetailPage({
        mode: 'local',
        summary: mockSummary,
        collectedTests: [
          {
            title: 'Successful Login',
            fullTitle: 'Auth > Login > Successful Login',
            filePath: 'src/tests/auth.spec.ts',
            status: 'passed',
            duration: 1200,
            errorMessage: '',
            errors: [],
            steps: [],
            attachments: [],
            retry: 0,
            testId: 'TC-01',
            scenarioId: 'SC-01',
            role: 'admin',
            module: 'Auth',
            feature: 'Login',
            priority: 'high',
            inputData: {},
            expectedResult: 'Dashboard shown',
            actualResult: 'Dashboard shown',
            affectedLayer: ['FE'],
          },
        ],
        displayName: 'Login Regression — Staging RC12',
        isArchived: true,
        serveMode: true,
        breadcrumb: [
          { label: 'History', href: '/history' },
          { label: 'Login Regression — Staging RC12' },
        ],
      }),
    );

    expect(html).toContain('Login Regression — Staging RC12');
    expect(html).toContain('Breadcrumb');
    expect(html).toContain('Detailed test records');
  });
});
