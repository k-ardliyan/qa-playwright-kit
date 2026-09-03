/**
 * Unified Executor Interface
 *
 * Combines sharding engine and multi-browser executor into a single
 * entry point for the pipeline orchestrator. Provides a high-level
 * `execute()` function that:
 * 1. Shards test files using the configured strategy
 * 2. Builds the browser matrix
 * 3. Executes the full matrix (browsers × shards)
 * 4. Merges results and classifies failures
 * 5. Converts merged results to custom reporter-compatible format
 *
 * @module executor
 * Requirements: 8.1, 8.2, 9.1
 */

export { shardTests } from './sharding-engine';
export {
  buildBrowserMatrix,
  executeMatrix,
  mergeResults,
  type ShardExecutor,
} from './multi-browser';

import { shardTests } from './sharding-engine';
import {
  buildBrowserMatrix,
  executeMatrix,
  mergeResults,
  type ShardExecutor,
} from './multi-browser';
import type {
  BrowserMatrixOptions,
  BrowserTarget,
  MergedExecutionResult,
  ShardConfig,
  TestShard,
} from '../shared/types';

/**
 * Options for the unified executor.
 */
export interface UnifiedExecutorOptions {
  /** Test file paths to execute */
  testFiles: string[];
  /** Sharding configuration */
  shardConfig: ShardConfig;
  /** Browser matrix options */
  matrixOptions: BrowserMatrixOptions;
  /** Historical durations for duration-based sharding (file path → ms) */
  historicalDurations?: Map<string, number>;
  /** Callback to actually run a shard on a browser */
  executor: ShardExecutor;
}

/**
 * Result from the unified executor including both raw and reporter-compatible output.
 */
export interface UnifiedExecutorResult {
  /** Full merged execution result with failure classifications */
  merged: MergedExecutionResult;
  /** Shards that were generated */
  shards: TestShard[];
  /** Reporter-compatible summary matching custom reporter TestSummary format */
  reporterSummary: ReporterCompatibleSummary;
}

/**
 * Summary format compatible with the custom reporter's TestSummary interface.
 * This can be directly written to artifacts/reports/test-summary.json alongside normal runs.
 */
export interface ReporterCompatibleSummary {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  passRate: number;
  timestamp: string;
  /** Additional multi-browser metadata not in the base TestSummary */
  multiBrowser?: {
    browsersExecuted: BrowserTarget[];
    browsersUnavailable: BrowserTarget[];
    crossBrowserFailureCount: number;
    browserSpecificFailureCounts: Record<string, number>;
    universalFailureCount: number;
  };
}

/**
 * Converts a MergedExecutionResult into the custom reporter's TestSummary-compatible format.
 *
 * The custom reporter writes `artifacts/reports/test-summary.json` with fields:
 *   { total, passed, failed, skipped, passRate, timestamp }
 *
 * This function maps the execution summary to that shape and adds
 * multi-browser metadata for enhanced reporting.
 *
 * @param merged - The merged execution result from mergeResults()
 * @returns A reporter-compatible summary object
 */
export function toReporterSummary(merged: MergedExecutionResult): ReporterCompatibleSummary {
  const { summary, crossBrowserFailures, browserSpecificFailures, universalFailures } = merged;

  const total = summary.totalTests;
  const passed = summary.totalPassed;
  const failed = summary.totalFailed;
  const skipped = summary.totalSkipped;
  const passRate = total > 0 ? Math.round((passed / total) * 100) : 0;

  // Build browser-specific failure counts
  const browserSpecificFailureCounts: Record<string, number> = {};
  for (const [browser, failures] of browserSpecificFailures) {
    browserSpecificFailureCounts[browser] = failures.length;
  }

  return {
    total,
    passed,
    failed,
    skipped,
    passRate,
    timestamp: new Date().toISOString(),
    multiBrowser: {
      browsersExecuted: summary.browsersExecuted,
      browsersUnavailable: summary.browsersUnavailable,
      crossBrowserFailureCount: crossBrowserFailures.length,
      browserSpecificFailureCounts,
      universalFailureCount: universalFailures.length,
    },
  };
}

/**
 * Executes the full sharding + multi-browser pipeline as a unified operation.
 *
 * Steps:
 * 1. Shards test files using the configured strategy
 * 2. Builds the browser matrix from options
 * 3. Runs all browser × shard combinations via executeMatrix()
 * 4. Merges results and classifies cross-browser vs browser-specific failures
 * 5. Produces a reporter-compatible summary
 *
 * @param options - Unified executor options
 * @returns Unified result with merged data and reporter-compatible summary
 */
export async function execute(options: UnifiedExecutorOptions): Promise<UnifiedExecutorResult> {
  const { testFiles, shardConfig, matrixOptions, historicalDurations, executor } = options;

  // Step 1: Shard test files
  const shards = shardTests(testFiles, shardConfig, historicalDurations);

  // Step 2: Build browser matrix
  const matrix = buildBrowserMatrix(matrixOptions);

  // Step 3: Execute the full matrix
  const matrixResult = await executeMatrix(matrix, shards, executor);

  // Step 4: Merge results and classify failures
  const merged = mergeResults(matrixResult.shardResults);

  // Step 5: Convert to reporter-compatible summary
  const reporterSummary = toReporterSummary(merged);

  return {
    merged,
    shards,
    reporterSummary,
  };
}
