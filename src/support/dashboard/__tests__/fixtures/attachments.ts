import type { CollectedTestData, TestSummary } from '../../types';

export const attachmentsTests: CollectedTestData[] = [
  {
    testId: 'SC-07',
    scenarioId: 'SC-07',
    title: 'Generate financial balance sheet PDF & Excel',
    fullTitle: 'Reports > Generate financial balance sheet PDF & Excel',
    filePath: 'src/tests/reports-balance.spec.ts',
    status: 'passed',
    duration: 4500,
    errorMessage: '',
    errors: [],
    steps: [
      {
        title: 'Generate PDF export',
        status: 'passed',
        duration: 2100,
        steps: [],
      },
      {
        title: 'Generate Excel export',
        status: 'passed',
        duration: 2400,
        steps: [],
      },
    ],
    attachments: [
      {
        name: 'balance-sheet-preview.png',
        contentType: 'image/png',
        relativePath: 'attachments/balance-sheet-preview.png',
        kind: 'screenshot',
      },
      {
        name: 'balance-sheet-export.mp4',
        contentType: 'video/mp4',
        relativePath: 'attachments/balance-sheet-export.mp4',
        kind: 'video',
      },
      {
        name: 'trace.zip',
        contentType: 'application/zip',
        relativePath: 'attachments/trace-balance.zip',
        kind: 'trace',
      },
      {
        name: 'balance-sheet-2026.xlsx',
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        relativePath: 'attachments/balance-sheet-2026.xlsx',
        kind: 'other',
      },
    ],
    retry: 0,
    role: 'finance',
    module: 'reports',
    feature: 'balance-sheet',
    priority: 'high',
    inputData: { period: 'Q1-2026' },
    expectedResult: 'All export formats generated and valid',
    actualResult: 'PDF, Excel, and video preview recorded',
    affectedLayer: ['FE', 'BE'],
  },
];

export const attachmentsSummary: TestSummary = {
  total: 1,
  passed: 1,
  failed: 0,
  skipped: 0,
  passRate: 100,
  timestamp: '2026-08-20T08:40:00.000Z',
  reportMode: 'role-aware',
  rolesInScope: ['finance'],
  testCases: [],
  runMeta: {
    appEnv: 'production',
    runId: 'run-20260820-005',
    ci: true,
    totalDurationMs: 4500,
    generatedAt: '2026-08-20T08:40:00.000Z',
  },
};
