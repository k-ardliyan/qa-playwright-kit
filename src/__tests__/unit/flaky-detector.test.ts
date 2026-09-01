import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import {
  analyzeTestFlakiness,
  saveQuarantineList,
  isTestQuarantined,
  type TestExecutionRecord,
} from '../../support/flaky/flaky-detector';

test.describe('Flaky Test Detector & Quarantine Engine', () => {
  const tempQuarantinePath = path.resolve(process.cwd(), 'artifacts', '__test_quarantine.json');

  test.afterAll(() => {
    if (fs.existsSync(tempQuarantinePath)) {
      try {
        fs.unlinkSync(tempQuarantinePath);
      } catch {
        // ignore cleanup error
      }
    }
  });

  test('detects flaky test flip-flopping between pass and fail', () => {
    const history: Record<string, TestExecutionRecord[]> = {
      'Stable Test A': [
        { status: 'passed', timestamp: '1' },
        { status: 'passed', timestamp: '2' },
        { status: 'passed', timestamp: '3' },
        { status: 'passed', timestamp: '4' },
      ],
      'Flaky Test B': [
        { status: 'passed', timestamp: '1' },
        { status: 'failed', timestamp: '2' },
        { status: 'passed', timestamp: '3' },
        { status: 'failed', timestamp: '4' },
      ],
    };

    const results = analyzeTestFlakiness(history, 0.25);
    const stable = results.find((r) => r.testTitle === 'Stable Test A');
    const flaky = results.find((r) => r.testTitle === 'Flaky Test B');

    expect(stable?.isFlaky).toBe(false);
    expect(stable?.flakinessScore).toBe(0);

    expect(flaky?.isFlaky).toBe(true);
    expect(flaky?.flakinessScore).toBe(1.0);
    expect(flaky?.flipFlopCount).toBe(3);
  });

  test('saves and checks quarantine list correctly', () => {
    saveQuarantineList(['Flaky Test B'], tempQuarantinePath);

    expect(isTestQuarantined('Flaky Test B', tempQuarantinePath)).toBe(true);
    expect(isTestQuarantined('Stable Test A', tempQuarantinePath)).toBe(false);
  });
});
