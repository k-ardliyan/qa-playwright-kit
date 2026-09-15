/// <reference types="node" />

/**
 * Property 24: Metrics Retention Bounded
 *
 * For any state of the pipeline metrics store after recording, no run entry
 * older than 90 days SHALL be retained. The `recordPipelineRun()` function
 * prunes entries older than 90 days on each write.
 *
 * **Validates: Requirements 13.4**
 */

import assert from 'node:assert/strict';
import fc from 'fast-check';
import {
  recordPipelineRun,
  loadMetricsStore,
  saveMetricsStore,
} from '../../observability/metrics-collector';
import type { PipelineMetricsStore, PipelineRun } from '../../shared/types/pipeline-metrics.schema';
import { createIsolatedReportDir } from '../helpers/report-dir-isolation';

// Metrics writes go to a temp dir via QA_REPORT_DIR (resolveWorkspaceReportDir),
// never to the real artifacts/reports/pipeline-metrics.json.
const isolate = createIsolatedReportDir();
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const RETENTION_DAYS = 90;

function emptyAggregate() {
  return {
    runCount: 0,
    averageDuration: 0,
    successRate: 0,
    averagePassRate: 0,
    mostCommonFailures: [] as string[],
  };
}

function createSeededStore(runs: PipelineRun[]): PipelineMetricsStore {
  return {
    version: '1.0',
    runs,
    aggregates: {
      last7Days: emptyAggregate(),
      last30Days: emptyAggregate(),
      allTime: emptyAggregate(),
    },
  };
}

function makePipelineRun(daysAgo: number, index: number): PipelineRun {
  const timestamp = new Date(Date.now() - daysAgo * MS_PER_DAY).toISOString();
  return {
    runId: `seed-run-${index}-${daysAgo}d`,
    timestamp,
    duration: 5000,
    stages: [
      {
        stage: 'executor',
        duration: 5000,
        status: 'success',
        retryCount: 0,
        itemsProcessed: 5,
      },
    ],
    result: 'success',
    environment: 'test',
    browsers: ['chromium'],
    testCount: 5,
    passRate: 80,
  };
}

async function main(): Promise<void> {
  try {
    await fc.assert(
      fc.asyncProperty(
        // Generate a list of ages in days for pre-seeded runs (some within, some beyond retention)
        fc.array(
          fc.oneof(
            fc.integer({ min: 0, max: 89 }), // within retention
            fc.integer({ min: 91, max: 365 }), // beyond retention
          ),
          { minLength: 1, maxLength: 10 },
        ),
        async (daysAgoList) => {
          // Pre-seed the store with runs at various ages
          const seededRuns = daysAgoList.map((daysAgo, i) => makePipelineRun(daysAgo, i));
          const store = createSeededStore(seededRuns);
          saveMetricsStore(store);

          // Call recordPipelineRun to trigger retention pruning
          recordPipelineRun({
            duration: 2000,
            stages: [
              {
                stage: 'planner',
                duration: 2000,
                status: 'success',
                retryCount: 0,
                itemsProcessed: 3,
              },
            ],
            result: 'success',
            environment: 'test',
            browsers: ['chromium'],
            testCount: 3,
            passRate: 100,
          });

          // Load and verify: no run should be older than 90 days
          const resultStore = loadMetricsStore();
          const now = Date.now();

          for (const run of resultStore.runs) {
            const runTime = new Date(run.timestamp).getTime();
            const ageMs = now - runTime;
            const ageDays = ageMs / MS_PER_DAY;

            assert(
              ageDays <= RETENTION_DAYS,
              `Run ${run.runId} is ${ageDays.toFixed(1)} days old, exceeds ${RETENTION_DAYS}-day retention limit`,
            );
          }
        },
      ),
      { numRuns: 50 },
    );

    console.log(
      '✓ Property 24 passed: metrics retention bounded — no run older than 90 days retained after recording',
    );
  } finally {
    isolate.teardown();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
