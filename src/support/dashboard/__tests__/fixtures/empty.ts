import type { CollectedTestData, TestSummary } from '../../types';

export const emptyTests: CollectedTestData[] = [];

export const emptySummary: TestSummary = {
  total: 0,
  passed: 0,
  failed: 0,
  skipped: 0,
  passRate: 0,
  timestamp: '2026-08-20T09:00:00.000Z',
  reportMode: 'general',
  rolesInScope: [],
  testCases: [],
  runMeta: {
    appEnv: 'development',
    runId: 'run-empty-001',
    ci: false,
    totalDurationMs: 0,
    generatedAt: '2026-08-20T09:00:00.000Z',
  },
};
