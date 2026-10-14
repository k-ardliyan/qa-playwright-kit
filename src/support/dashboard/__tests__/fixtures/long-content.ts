import type { CollectedTestData, TestSummary } from '../../types';

export const longContentTests: CollectedTestData[] = [
  {
    testId: 'SC-VERY-LONG-TEST-IDENTIFIER-THAT-EXCEEDS-NORMAL-COLUMN-WIDTH-001',
    scenarioId: 'SC-VERY-LONG-TEST-IDENTIFIER-THAT-EXCEEDS-NORMAL-COLUMN-WIDTH-001',
    title:
      'Very long scenario title with special characters <script>alert("xss")</script> & "quotes" \'single-quotes\' `backticks` and ${template_expressions} to ensure proper escaping and prevent layout breaking on ultra long descriptions in table or accordion views',
    fullTitle:
      'Enterprise Module > Submodule Extremely Long Name > Very long scenario title with special characters <script>alert("xss")</script>',
    filePath:
      'src/tests/extremely/deeply/nested/directory/path/that/spans/multiple/levels/of/the/project/hierarchy/enterprise-submodule-compliance-validation.spec.ts',
    status: 'failed',
    duration: 15420,
    errorMessage:
      'AssertionError: Expected element <div class="target-node" data-test="<evil>&"\'`">${injection}</div> to have text "Expected Safe Text", but found "<script>alert(1)</script>" with stack:\n    at DeepValidator.validate (src/utils/deep-validator.ts:182:19)\n    at Object.test (src/tests/enterprise.spec.ts:99:12)',
    errors: [
      {
        message:
          'AssertionError: Expected element <div class="target-node" data-test="<evil>&"\'`">${injection}</div> to have text "Expected Safe Text", but found "<script>alert(1)</script>"',
        stack:
          'AssertionError: Expected element <div class="target-node" data-test="<evil>&"\'`">${injection}</div>\n    at DeepValidator.validate (src/utils/deep-validator.ts:182:19)\n    at Object.test (src/tests/enterprise.spec.ts:99:12)',
      },
    ],
    steps: [
      {
        title: 'Step 1: Outer setup with <b>HTML</b> & special characters',
        status: 'passed',
        duration: 1200,
        steps: [
          {
            title: 'Step 1.1: Nested sub-step with query string ?param1=val&param2="quote"',
            status: 'passed',
            duration: 800,
            steps: [
              {
                title: 'Step 1.1.1: Deeply nested step level 3',
                status: 'passed',
                duration: 400,
                steps: [],
              },
            ],
          },
        ],
      },
      {
        title: 'Step 2: Execution step failing with HTML error payload',
        status: 'failed',
        duration: 13020,
        errorMessage: '<span style="color:red">Server Error 500: "Invalid Token <token>"</span>',
        steps: [],
      },
    ],
    attachments: [
      {
        name: 'long-filename-with-special-chars-<>-"-\'-&-`-screenshot.png',
        contentType: 'image/png',
        relativePath: 'attachments/long-filename-with-special-chars-screenshot.png',
        kind: 'screenshot',
      },
    ],
    retry: 3,
    role: 'super-admin-with-extended-privileges-and-audit-clearance',
    module: 'enterprise-compliance-and-governance-module',
    feature: 'multi-jurisdictional-tax-reconciliation-engine',
    priority: 'high',
    inputData: {
      payload: '{"key":"value","html":"<img src=x onerror=alert(1)>","unicode":"🔥✨🚀"}',
      url: 'https://example.com/api/v1/resource?filter=%3Cscript%3E&sort=desc&limit=1000',
    },
    expectedResult:
      'System securely encodes and stores <script>alert("payload")</script> without triggering HTML injection or breaking table columns',
    actualResult:
      'Database stored raw characters but UI escaped them properly; downstream service returned 500 error on <script> payload',
    affectedLayer: ['FE', 'BE', 'DB', 'API'],
    failureSource: 'app',
  },
];

export const longContentSummary: TestSummary = {
  total: 1,
  passed: 0,
  failed: 1,
  skipped: 0,
  passRate: 0,
  timestamp: '2026-08-20T08:50:00.000Z',
  reportMode: 'role-aware',
  rolesInScope: ['super-admin-with-extended-privileges-and-audit-clearance'],
  testCases: [],
  runMeta: {
    appEnv: 'production',
    runId: 'run-long-20260820-999',
    requirementPath: 'requirements/enterprise/compliance/reconciliation.md',
    ci: true,
    totalDurationMs: 15420,
    generatedAt: '2026-08-20T08:50:00.000Z',
  },
};
