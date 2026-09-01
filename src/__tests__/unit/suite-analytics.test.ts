import { test, expect } from '@playwright/test';
import { computeSuiteLatencyStats } from '../../support/custom-dashboard/domain/analytics';

test.describe('Dashboard Suite Latency Analytics', () => {
  test('accurately calculates P50, P90, P99 and extracts slowest tests', () => {
    const mockTests = [
      { title: 'Test 1', duration: 100, testId: 'TC-01' },
      { title: 'Test 2', duration: 200, testId: 'TC-02' },
      { title: 'Test 3', duration: 300, testId: 'TC-03' },
      { title: 'Test 4', duration: 400, testId: 'TC-04' },
      { title: 'Test 5', duration: 1000, testId: 'TC-05' },
    ];

    const stats = computeSuiteLatencyStats(mockTests, 2);

    expect(stats.avgDuration).toBe(400);
    expect(stats.p50).toBe(300);
    expect(stats.p90).toBe(1000);
    expect(stats.slowestTests.length).toBe(2);
    expect(stats.slowestTests[0].title).toBe('Test 5');
    expect(stats.slowestTests[0].durationMs).toBe(1000);
  });

  test('handles empty dataset gracefully', () => {
    const stats = computeSuiteLatencyStats([]);
    expect(stats.p50).toBe(0);
    expect(stats.slowestTests).toEqual([]);
  });
});
