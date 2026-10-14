import type { CollectedTestData, TestSummary } from '../../types';

export const failureTests: CollectedTestData[] = [
  {
    testId: 'SC-03',
    scenarioId: 'SC-03',
    title: 'Approve high-value invoice without permission',
    fullTitle: 'Finance > Approve high-value invoice without permission',
    filePath: 'src/tests/finance-approve.spec.ts',
    status: 'failed',
    duration: 3200,
    errorMessage:
      'Error: expect(received).toBe(expected)\n\nExpected: 403\nReceived: 500\n    at Object.<anonymous> (src/tests/finance-approve.spec.ts:45:22)',
    errors: [
      {
        message: 'Expected status 403 Forbidden, but received 500 Internal Server Error',
        stack:
          'Error: Expected status 403 Forbidden, but received 500 Internal Server Error\n    at ApprovePage.approve (src/pages/approve.page.ts:102:11)\n    at src/tests/finance-approve.spec.ts:45:22',
      },
    ],
    steps: [
      {
        title: 'Open invoice INV-999',
        status: 'passed',
        duration: 500,
        steps: [],
      },
      {
        title: 'Click approve button',
        status: 'failed',
        duration: 2700,
        errorMessage: 'HTTP 500 returned on /api/invoices/INV-999/approve',
        steps: [],
      },
    ],
    attachments: [
      {
        name: 'failure-screenshot.png',
        contentType: 'image/png',
        relativePath: 'attachments/failure-screenshot.png',
        kind: 'screenshot',
      },
      {
        name: 'trace.zip',
        contentType: 'application/zip',
        relativePath: 'attachments/trace.zip',
        kind: 'trace',
      },
    ],
    retry: 1,
    role: 'finance',
    module: 'finance',
    feature: 'invoices',
    priority: 'high',
    inputData: { invoiceId: 'INV-999', amount: '100000000' },
    expectedResult: 'System returns 403 Forbidden with clear permission message',
    actualResult: 'Server crashed with 500 Internal Server Error',
    affectedLayer: ['API', 'BE'],
    failureSource: 'app',
  },
  {
    testId: 'SC-04',
    scenarioId: 'SC-04',
    title: 'Export large transaction ledger',
    fullTitle: 'Reports > Export large transaction ledger',
    filePath: 'src/tests/ledger-export.spec.ts',
    status: 'timedOut',
    duration: 30000,
    errorMessage: 'Test timeout of 30000ms exceeded while waiting for download event',
    errors: [
      {
        message: 'Test timeout of 30000ms exceeded',
        stack:
          'TimeoutError: page.waitForEvent("download") exceeded 30000ms\n    at src/tests/ledger-export.spec.ts:28:18',
      },
    ],
    steps: [
      {
        title: 'Trigger export button',
        status: 'passed',
        duration: 300,
        steps: [],
      },
      {
        title: 'Wait for download',
        status: 'failed',
        duration: 29700,
        errorMessage: 'Download did not start within 30000ms',
        steps: [],
      },
    ],
    attachments: [
      {
        name: 'trace.zip',
        contentType: 'application/zip',
        relativePath: 'attachments/trace-sc04.zip',
        kind: 'trace',
      },
    ],
    retry: 2,
    role: 'finance',
    module: 'reports',
    feature: 'ledger',
    priority: 'medium',
    inputData: { dateRange: '2025-01-01..2025-12-31' },
    expectedResult: 'Excel download completes within 10s',
    actualResult: 'Operation timed out after 30s',
    affectedLayer: ['BE', 'DB'],
    failureSource: 'env',
  },
];

export const failureSummary: TestSummary = {
  total: 2,
  passed: 0,
  failed: 2,
  skipped: 0,
  passRate: 0,
  timestamp: '2026-08-20T08:15:00.000Z',
  reportMode: 'role-aware',
  rolesInScope: ['finance'],
  testCases: [],
  runMeta: {
    appEnv: 'staging',
    runId: 'run-20260820-002',
    requirementPath: 'requirements/finance.md',
    ci: true,
    totalDurationMs: 33200,
    generatedAt: '2026-08-20T08:15:00.000Z',
  },
};
