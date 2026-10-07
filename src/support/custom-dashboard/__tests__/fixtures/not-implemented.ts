import type { CollectedTestData, TestSummary } from '../../types';

/**
 * `not-implemented` fixture — planned scenarios emitted as `test.fixme`.
 *
 * The status exists to separate "planned but not built" (unfinished work) from
 * `skipped` ("not applicable to automation"). These fixtures pin that the two
 * never collapse into one another in the dashboard.
 */
export const notImplementedTest: CollectedTestData = {
  testId: 'SC-07',
  scenarioId: 'SC-07',
  title: 'Export payroll recap to bank file',
  fullTitle: 'Payroll > Export payroll recap to bank file',
  filePath: 'src/tests/payroll.spec.ts',
  status: 'not-implemented',
  duration: 0,
  errorMessage: '',
  errors: [],
  steps: [],
  attachments: [],
  retry: 0,
  role: 'finance',
  module: 'payroll',
  feature: 'export',
  priority: 'high',
  inputData: { format: 'CSV' },
  expectedResult: 'Bank file downloaded with matching totals',
  actualResult: 'SKELETON — not yet implemented',
  affectedLayer: ['FE'],
  // Per-scenario "why" from the fixme annotation — the tooltip/detail must be
  // able to say WHAT is owed, not just that something is.
  notImplementedReason:
    'Butuh payroll berjalan sampai status Dibayar — prasyarat rantai payroll belum tersedia.',
};

export const notImplementedTests: CollectedTestData[] = [
  notImplementedTest,
  {
    testId: 'SC-08',
    scenarioId: 'SC-08',
    title: 'Reconcile paid payroll against bank statement',
    fullTitle: 'Payroll > Reconcile paid payroll against bank statement',
    filePath: 'src/tests/payroll.spec.ts',
    status: 'not-implemented',
    duration: 0,
    errorMessage: '',
    errors: [],
    steps: [],
    attachments: [],
    retry: 0,
    role: 'finance',
    module: 'payroll',
    feature: 'reconciliation',
    priority: 'medium',
    inputData: {},
    expectedResult: 'Reconciliation report shows zero variance',
    actualResult: 'SKELETON — not yet implemented',
    affectedLayer: ['FE', 'BE'],
  },
];

export const notImplementedSummary: TestSummary = {
  total: 2,
  passed: 0,
  failed: 0,
  skipped: 0,
  notImplemented: 2,
  passRate: 0,
  timestamp: '2026-10-06T10:00:00.000Z',
  reportMode: 'role-aware',
  rolesInScope: ['finance'],
  testCases: [],
  runMeta: {
    appEnv: 'dev',
    runId: 'run-20261006-001',
    ci: false,
    totalDurationMs: 0,
    generatedAt: '2026-10-06T10:00:00.000Z',
  },
};
