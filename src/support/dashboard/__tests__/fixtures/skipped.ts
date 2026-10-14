import type { CollectedTestData, TestSummary } from '../../types';
import { skippedTest } from './mixed-results';

export const skippedTests: CollectedTestData[] = [
  skippedTest,
  {
    testId: 'SC-06',
    scenarioId: 'SC-06',
    title: 'Process payment with multi-currency gateway',
    fullTitle: 'Payments > Process payment with multi-currency gateway',
    filePath: 'src/tests/payments.spec.ts',
    status: 'skipped',
    duration: 0,
    errorMessage: 'Feature flag MULTI_CURRENCY_GATEWAY is disabled in current env',
    errors: [],
    steps: [],
    attachments: [],
    retry: 0,
    role: 'finance',
    module: 'payments',
    feature: 'gateway',
    priority: 'medium',
    inputData: { currency: 'EUR' },
    expectedResult: 'Payment settled in EUR',
    actualResult: 'Feature disabled',
    affectedLayer: ['API'],
  },
];

export const skippedSummary: TestSummary = {
  total: 2,
  passed: 0,
  failed: 0,
  skipped: 2,
  passRate: 0,
  timestamp: '2026-08-20T08:35:00.000Z',
  reportMode: 'role-aware',
  rolesInScope: ['finance', 'super-admin'],
  testCases: [],
  runMeta: {
    appEnv: 'staging',
    runId: 'run-20260820-004',
    ci: false,
    totalDurationMs: 0,
    generatedAt: '2026-08-20T08:35:00.000Z',
  },
};
