import { test, expect } from '@playwright/test';
import { TableView } from '../../support/custom-dashboard/components/table/TableView';
import type { CollectedTestData, TestSummary } from '../../support/custom-dashboard/types';

function summary(over: Partial<TestSummary> = {}): TestSummary {
  return {
    total: 1,
    passed: 0,
    failed: 1,
    skipped: 0,
    passRate: 0,
    timestamp: new Date().toISOString(),
    reportMode: 'general',
    rolesInScope: [],
    runMeta: {
      appEnv: 'local',
      runId: 'run-1',
      ci: false,
      totalDurationMs: 0,
      generatedAt: new Date().toISOString(),
    },
    testCases: [],
    ...over,
  };
}

function testCase(over: Partial<CollectedTestData> = {}): CollectedTestData {
  return {
    testId: 'TC-1',
    title: 't',
    fullTitle: 'Suite > t',
    filePath: '',
    status: 'timedOut',
    duration: 100,
    errorMessage: '',
    errors: [],
    steps: [],
    attachments: [],
    retry: 0,
    scenarioId: 'SC-1',
    role: '',
    module: '',
    feature: '',
    priority: 'high',
    inputData: {},
    expectedResult: '',
    actualResult: '',
    affectedLayer: [],
    failureSource: 'test',
    ...over,
  };
}

test.describe('table view sort uses data-* attributes', () => {
  test('status sort reads data-status (not badge textContent)', () => {
    const html = String(TableView({ summary: summary(), collectedTests: [testCase()] }));
    // Fix: sort must read the raw data-status attribute so "timedOut" (camelCase)
    // and badge icons don't break the statusOrder lookup.
    expect(html).toContain("getAttribute('data-status')");
    expect(html).toContain('.toLowerCase()');
  });

  test('priority sort reads data-priority attribute', () => {
    const html = String(TableView({ summary: summary(), collectedTests: [testCase()] }));
    expect(html).toContain("getAttribute('data-priority')");
  });

  test('duration sort still uses the notes cell text', () => {
    const html = String(TableView({ summary: summary(), collectedTests: [testCase()] }));
    expect(html).toContain('duration');
  });
});
