/// <reference types="node" />

/**
 * Property 23: Metrics Pass Rate Bounded
 *
 * For any pipeline run recorded in metrics, the passRate value SHALL be
 * between 0 and 100 inclusive. The `recordPipelineRun()` function clamps
 * passRate to [0, 100] internally regardless of the input value.
 *
 * **Validates: Requirements 13.5**
 */

import assert from 'node:assert/strict';
import fc from 'fast-check';
import {
  recordPipelineRun,
  loadMetricsStore,
  saveMetricsStore,
} from '../../observability/metrics-collector';
import { createIsolatedReportDir } from '../helpers/report-dir-isolation';

// Metrics writes go to a temp dir via QA_REPORT_DIR (resolveWorkspaceReportDir),
// never to the real artifacts/reports/pipeline-metrics.json.
const isolate = createIsolatedReportDir();

function resetMetricsFile(): void {
  const emptyStore = {
    version: '1.0' as const,
    runs: [],
    aggregates: {
      last7Days: {
        runCount: 0,
        averageDuration: 0,
        successRate: 0,
        averagePassRate: 0,
        mostCommonFailures: [],
      },
      last30Days: {
        runCount: 0,
        averageDuration: 0,
        successRate: 0,
        averagePassRate: 0,
        mostCommonFailures: [],
      },
      allTime: {
        runCount: 0,
        averageDuration: 0,
        successRate: 0,
        averagePassRate: 0,
        mostCommonFailures: [],
      },
    },
  };
  saveMetricsStore(emptyStore);
}

async function main(): Promise<void> {
  try {
    await fc.assert(
      fc.asyncProperty(
        fc.oneof(
          fc.double({ min: -1e6, max: 1e6, noNaN: true }),
          fc.constant(-1),
          fc.constant(0),
          fc.constant(50),
          fc.constant(100),
          fc.constant(101),
          fc.constant(-100),
          fc.constant(200),
          fc.constant(Number.MAX_SAFE_INTEGER),
          fc.constant(Number.MIN_SAFE_INTEGER),
        ),
        async (passRateInput) => {
          // Reset metrics file for each run to avoid accumulation
          resetMetricsFile();

          recordPipelineRun({
            duration: 1000,
            stages: [
              {
                stage: 'executor',
                duration: 1000,
                status: 'success',
                retryCount: 0,
                itemsProcessed: 10,
              },
            ],
            result: 'success',
            environment: 'test',
            browsers: ['chromium'],
            testCount: 10,
            passRate: passRateInput,
          });

          const store = loadMetricsStore();
          const lastRun = store.runs[store.runs.length - 1];

          assert(lastRun !== undefined, 'Run must be recorded');
          assert(
            lastRun.passRate >= 0,
            `passRate must be >= 0, got ${lastRun.passRate} for input ${passRateInput}`,
          );
          assert(
            lastRun.passRate <= 100,
            `passRate must be <= 100, got ${lastRun.passRate} for input ${passRateInput}`,
          );
        },
      ),
      { numRuns: 100 },
    );

    console.log(
      '✓ Property 23 passed: metrics pass rate bounded — all recorded passRate values are in [0, 100]',
    );
  } finally {
    isolate.teardown();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
