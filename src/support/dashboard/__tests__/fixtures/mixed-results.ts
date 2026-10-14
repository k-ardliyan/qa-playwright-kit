import type { CollectedTestData, TestSummary } from '../../types';
import { allPassedTests } from './all-passed';
import { failureTests } from './failures';

export const skippedTest: CollectedTestData = {
  testId: 'SC-05',
  scenarioId: 'SC-05',
  title: 'Bulk sync tax reports to external portal',
  fullTitle: 'Tax > Bulk sync tax reports to external portal',
  filePath: 'src/tests/tax-sync.spec.ts',
  status: 'skipped',
  duration: 0,
  errorMessage: 'Third-party sandbox tax portal is under maintenance',
  errors: [],
  steps: [],
  attachments: [],
  retry: 0,
  role: 'super-admin',
  module: 'tax',
  feature: 'sync',
  priority: 'low',
  inputData: { taxYear: '2025' },
  expectedResult: 'Sync completes with external batch ID',
  actualResult: 'Skipped - sandbox offline',
  affectedLayer: ['API'],
  failureSource: 'env',
};

export const mixedResultsTests: CollectedTestData[] = [
  ...allPassedTests,
  ...failureTests,
  skippedTest,
];

export const mixedResultsSummary: TestSummary = {
  total: 5,
  passed: 2,
  failed: 2,
  skipped: 1,
  passRate: 40,
  timestamp: '2026-08-20T08:30:00.000Z',
  reportMode: 'role-aware',
  rolesInScope: ['finance', 'super-admin'],
  testCases: [],
  runMeta: {
    appEnv: 'staging',
    runId: 'run-20260820-003',
    requirementPath: 'requirements/e2e-all.md',
    ci: true,
    totalDurationMs: 35340,
    generatedAt: '2026-08-20T08:30:00.000Z',
  },
};
