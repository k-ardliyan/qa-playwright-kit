import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import {
  extractFailedTestTitles,
  buildFailedGrepPattern,
} from '../../../tools/scripts/failed-only';

test.describe('Failed-Only Re-run Engine', () => {
  const tempSummaryPath = path.resolve(process.cwd(), 'artifacts', '__test_failed_summary.json');

  test.afterAll(() => {
    if (fs.existsSync(tempSummaryPath)) {
      try {
        fs.unlinkSync(tempSummaryPath);
      } catch {
        // ignore cleanup error
      }
    }
  });

  test('extracts unhealthy test titles from summary correctly', () => {
    const mockSummary = {
      total: 3,
      passed: 1,
      failed: 2,
      testCases: [
        { title: 'SC-01 Login Success', status: 'passed' },
        { title: 'SC-02 Empty Password', status: 'failed' },
        { title: 'SC-03 Timeout Flow', status: 'timedOut' },
      ],
    };

    fs.writeFileSync(tempSummaryPath, JSON.stringify(mockSummary), 'utf-8');

    const failed = extractFailedTestTitles(tempSummaryPath);
    expect(failed).toEqual(['SC-02 Empty Password', 'SC-03 Timeout Flow']);

    const grep = buildFailedGrepPattern(failed);
    expect(grep).toBe('(SC-02 Empty Password|SC-03 Timeout Flow)');
  });
});
