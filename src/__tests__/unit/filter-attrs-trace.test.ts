import { test, expect } from '@playwright/test';
import { buildFilterDataAttrs, toExportPayload } from '../../support/dashboard/filter-attrs';
import type { CollectedTestData } from '../../support/dashboard/report-model';

function serveModeCase(over: Partial<CollectedTestData> = {}): CollectedTestData {
  return {
    testId: 'TC-X-01',
    title: 'serve mode case',
    fullTitle: 'Suite > serve mode case',
    filePath: '',
    status: 'failed',
    duration: 100,
    errorMessage: 'err',
    errors: [],
    steps: [],
    attachments: [], // serve mode always normalizes attachments to []
    retry: 0,
    scenarioId: 'SC-1',
    role: 'finance',
    module: 'invoice',
    feature: 'list',
    priority: 'high',
    inputData: {},
    expectedResult: 'ok',
    actualResult: 'err',
    affectedLayer: ['FE'],
    failureSource: 'test',
    ...over,
  };
}

test.describe('filter-attrs serve mode trace flags', () => {
  test('buildFilterDataAttrs prefers hasTrace flag over empty attachments', () => {
    const attrs = buildFilterDataAttrs(serveModeCase({ hasTrace: true }), 'row-1');
    expect(attrs).toContain('data-has-trace="1"');
  });

  test('buildFilterDataAttrs falls back to attachment inspection when flag missing', () => {
    const withAttach = serveModeCase({
      hasTrace: undefined,
      attachments: [{ kind: 'trace', name: 't.zip', relativePath: 'traces/t.zip' }],
    });
    expect(buildFilterDataAttrs(withAttach, 'row-2')).toContain('data-has-trace="1"');
  });

  test('buildFilterDataAttrs reports 0 when no trace anywhere', () => {
    const attrs = buildFilterDataAttrs(serveModeCase({ hasTrace: false }), 'row-3');
    expect(attrs).toContain('data-has-trace="0"');
  });

  test('toExportPayload carries hasTrace from flag (serve mode)', () => {
    const payload = toExportPayload([serveModeCase({ hasTrace: true })]);
    expect(payload[0]).toMatchObject({ hasTrace: true });
  });

  test('toExportPayload falls back to attachments when flag absent', () => {
    const payload = toExportPayload([
      serveModeCase({
        hasTrace: undefined,
        attachments: [{ kind: 'trace', name: 't.zip', relativePath: 'traces/t.zip' }],
      }),
    ]);
    expect(payload[0]).toMatchObject({ hasTrace: true });
  });
});
