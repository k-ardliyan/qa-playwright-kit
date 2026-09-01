export interface SuiteLatencyStats {
  p50: number;
  p90: number;
  p99: number;
  avgDuration: number;
  slowestTests: Array<{
    title: string;
    durationMs: number;
    testId?: string;
  }>;
}

/**
 * Computes duration percentiles (P50, P90, P99) and extracts the top slowest tests.
 */
export function computeSuiteLatencyStats(
  tests: Array<{ title: string; duration?: number; testId?: string }>,
  topSlowCount = 5,
): SuiteLatencyStats {
  if (!tests || tests.length === 0) {
    return {
      p50: 0,
      p90: 0,
      p99: 0,
      avgDuration: 0,
      slowestTests: [],
    };
  }

  const validDurations = tests
    .map((t) => t.duration || 0)
    .filter((d) => typeof d === 'number' && !isNaN(d))
    .sort((a, b) => a - b);

  const len = validDurations.length;
  if (len === 0) {
    return { p50: 0, p90: 0, p99: 0, avgDuration: 0, slowestTests: [] };
  }

  const p50 = validDurations[Math.floor(len * 0.5)] ?? 0;
  const p90 = validDurations[Math.min(len - 1, Math.floor(len * 0.9))] ?? 0;
  const p99 = validDurations[Math.min(len - 1, Math.floor(len * 0.99))] ?? 0;
  const sum = validDurations.reduce((acc, v) => acc + v, 0);
  const avgDuration = Math.round(sum / len);

  const slowestTests = [...tests]
    .sort((a, b) => (b.duration || 0) - (a.duration || 0))
    .slice(0, topSlowCount)
    .map((t) => ({
      title: t.title,
      durationMs: t.duration || 0,
      testId: t.testId,
    }));

  return {
    p50,
    p90,
    p99,
    avgDuration,
    slowestTests,
  };
}
