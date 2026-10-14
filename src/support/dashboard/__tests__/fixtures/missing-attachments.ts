import type { CollectedTestData, TestSummary } from '../../types';

export const missingAttachmentsTests: CollectedTestData[] = [
  {
    testId: 'SC-08',
    scenarioId: 'SC-08',
    title: 'Download invoice attachment without file on disk',
    fullTitle: 'Invoices > Download invoice attachment without file on disk',
    filePath: 'src/tests/invoices-missing.spec.ts',
    status: 'failed',
    duration: 1800,
    errorMessage: 'File not found on storage server',
    errors: [{ message: 'Storage 404: attachment-inv-123.pdf not found' }],
    steps: [],
    attachments: [
      {
        name: 'missing-ss.png',
        contentType: 'image/png',
        relativePath: '',
        kind: 'screenshot',
      },
      {
        name: 'missing-video.mp4',
        contentType: 'video/mp4',
        relativePath: '',
        kind: 'video',
      },
      {
        name: 'missing-trace.zip',
        contentType: 'application/zip',
        relativePath: '',
        kind: 'trace',
      },
      {
        name: 'missing-doc.pdf',
        relativePath: '',
        kind: 'other',
      },
    ],
    retry: 0,
    role: 'finance',
    module: 'invoices',
    feature: 'download',
    priority: 'low',
    inputData: {},
    expectedResult: 'Display friendly error',
    actualResult: 'Missing attachments handled gracefully',
    affectedLayer: ['BE'],
    failureSource: 'test',
  },
];

export const missingAttachmentsSummary: TestSummary = {
  total: 1,
  passed: 0,
  failed: 1,
  skipped: 0,
  passRate: 0,
  timestamp: '2026-08-20T08:45:00.000Z',
  reportMode: 'general',
  rolesInScope: [],
  testCases: [],
  runMeta: {
    appEnv: 'staging',
    runId: 'run-20260820-006',
    ci: false,
    totalDurationMs: 1800,
    generatedAt: '2026-08-20T08:45:00.000Z',
  },
};
