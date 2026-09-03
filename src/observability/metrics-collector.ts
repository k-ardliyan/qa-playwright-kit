/**
 * Pipeline Metrics Collector
 *
 * Records pipeline events, metric data points, and complete pipeline runs.
 * Persists run entries to artifacts/reports/pipeline-metrics.json with:
 * - Unique run ID and ISO timestamp
 * - Per-stage timing metrics (duration, status, retry count, items processed)
 * - Aggregates recalculated on each new run (last 7 days, last 30 days, all-time)
 * - 90-day retention enforcement (prune older entries on write)
 * - Pass rate as percentage 0–100
 * - Skipped/errored stages recorded with appropriate status and 0 duration for skipped
 */

import type {
  PipelineMetricsStore,
  PipelineRun,
  StageMetric,
  AggregateMetrics,
} from '../shared/types/pipeline-metrics.schema';
import type {
  PipelineEvent,
  MetricPoint,
  HealthDashboard,
  AgentHealthMetric,
  ClassifiedError,
} from '../shared/types';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';

// ─── Constants ────────────────────────────────────────────────────────────────

const METRICS_FILE = path.join('artifacts', 'reports', 'pipeline-metrics.json');
const RETENTION_DAYS = 90;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

// ─── In-Memory Event/Metric Buffers ──────────────────────────────────────────

const eventBuffer: PipelineEvent[] = [];
const metricBuffer: MetricPoint[] = [];

// ─── Helper: Empty Aggregate ──────────────────────────────────────────────────

function emptyAggregate(): AggregateMetrics {
  return {
    runCount: 0,
    averageDuration: 0,
    successRate: 0,
    averagePassRate: 0,
    mostCommonFailures: [],
  };
}

// ─── Helper: Create Empty Store ───────────────────────────────────────────────

function createEmptyStore(): PipelineMetricsStore {
  return {
    version: '1.0',
    runs: [],
    aggregates: {
      last7Days: emptyAggregate(),
      last30Days: emptyAggregate(),
      allTime: emptyAggregate(),
    },
  };
}

// ─── Load/Save ────────────────────────────────────────────────────────────────

/**
 * Loads the metrics store from disk.
 * Creates a fresh store if the file doesn't exist or is unreadable.
 */
export function loadMetricsStore(): PipelineMetricsStore {
  try {
    const filePath = path.resolve(METRICS_FILE);
    if (!fs.existsSync(filePath)) {
      return createEmptyStore();
    }
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw) as PipelineMetricsStore;
    return parsed;
  } catch {
    return createEmptyStore();
  }
}

/**
 * Saves the metrics store to disk.
 * Creates the artifacts/reports/ directory if it doesn't exist.
 */
export function saveMetricsStore(store: PipelineMetricsStore): void {
  const filePath = path.resolve(METRICS_FILE);
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(filePath, JSON.stringify(store, null, 2), 'utf-8');
}

// ─── Aggregate Calculation ────────────────────────────────────────────────────

/**
 * Calculates aggregate metrics for runs within a given time window.
 *
 * @param runs - All runs in the store
 * @param windowDays - Number of days to look back (null for all-time)
 * @returns Computed aggregate metrics
 */
function calculateAggregates(runs: PipelineRun[], windowDays: number | null): AggregateMetrics {
  const now = Date.now();
  const filtered =
    windowDays === null
      ? runs
      : runs.filter((run) => {
          const runTime = new Date(run.timestamp).getTime();
          return now - runTime <= windowDays * MS_PER_DAY;
        });

  if (filtered.length === 0) {
    return emptyAggregate();
  }

  const runCount = filtered.length;
  const averageDuration = filtered.reduce((sum, r) => sum + r.duration, 0) / runCount;
  const successCount = filtered.filter((r) => r.result === 'success').length;
  const successRate = (successCount / runCount) * 100;
  const averagePassRate = filtered.reduce((sum, r) => sum + r.passRate, 0) / runCount;

  // Compute most common failure categories from error stages
  const failureCounts = new Map<string, number>();
  for (const run of filtered) {
    for (const stage of run.stages) {
      if (stage.status === 'error') {
        const count = failureCounts.get(stage.stage) || 0;
        failureCounts.set(stage.stage, count + 1);
      }
    }
  }
  const mostCommonFailures = [...failureCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([category]) => category);

  return {
    runCount,
    averageDuration: Math.round(averageDuration),
    successRate: Math.round(successRate * 100) / 100,
    averagePassRate: Math.round(averagePassRate * 100) / 100,
    mostCommonFailures,
  };
}

// ─── Retention Enforcement ────────────────────────────────────────────────────

/**
 * Removes entries older than 90 days from the runs array.
 */
function pruneOldEntries(runs: PipelineRun[]): PipelineRun[] {
  const cutoff = Date.now() - RETENTION_DAYS * MS_PER_DAY;
  return runs.filter((run) => {
    const runTime = new Date(run.timestamp).getTime();
    return runTime >= cutoff;
  });
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Records a pipeline event (stage start/complete/error/skip).
 * Buffers events in memory for potential later use.
 */
export function recordEvent(event: PipelineEvent): void {
  eventBuffer.push(event);
}

/**
 * Records a metric data point.
 * Buffers metrics in memory for potential later use.
 */
export function recordMetric(metric: MetricPoint): void {
  metricBuffer.push(metric);
}

/**
 * Records a complete pipeline run with all stage metrics.
 * Persists to pipeline-metrics.json, recalculates aggregates, enforces retention.
 *
 * @param runData - The pipeline run data (without runId and timestamp which are auto-generated)
 */
export function recordPipelineRun(runData: Omit<PipelineRun, 'runId' | 'timestamp'>): void {
  const store = loadMetricsStore();

  // Generate unique runId
  const runId = crypto.randomUUID();

  // Set timestamp to current ISO 8601
  const timestamp = new Date().toISOString();

  // Clamp passRate to 0–100
  const passRate = Math.max(0, Math.min(100, runData.passRate));

  // Ensure skipped stages have 0 duration
  const stages: StageMetric[] = runData.stages.map((stage) => ({
    ...stage,
    duration: stage.status === 'skipped' ? 0 : stage.duration,
  }));

  const newRun: PipelineRun = {
    runId,
    timestamp,
    duration: runData.duration,
    stages,
    result: runData.result,
    environment: runData.environment,
    browsers: runData.browsers,
    testCount: runData.testCount,
    passRate,
  };

  // Prune entries older than 90 days
  store.runs = pruneOldEntries(store.runs);

  // Add new run
  store.runs.push(newRun);

  // Recalculate aggregates for all three windows
  store.aggregates = {
    last7Days: calculateAggregates(store.runs, 7),
    last30Days: calculateAggregates(store.runs, 30),
    allTime: calculateAggregates(store.runs, null),
  };

  // Save to disk
  saveMetricsStore(store);
}

/**
 * Returns the health dashboard data from the current metrics store.
 */
export function getHealthDashboard(): HealthDashboard {
  const store = loadMetricsStore();
  const runs = store.runs;

  // Pipeline success rate from all-time aggregates
  const pipelineSuccessRate = store.aggregates.allTime.successRate;
  const averagePipelineDuration = store.aggregates.allTime.averageDuration;

  // Compute per-agent (stage) health metrics
  const stages = ['planner', 'generator', 'executor', 'healer', 'reporter'];
  const agentHealth: Record<string, AgentHealthMetric> = {};

  for (const stageName of stages) {
    const stageRuns = runs
      .map((run) => ({
        timestamp: run.timestamp,
        stage: run.stages.find((s) => s.stage === stageName),
      }))
      .filter(
        (entry): entry is { timestamp: string; stage: StageMetric } => entry.stage !== undefined,
      );

    if (stageRuns.length === 0) {
      agentHealth[stageName] = {
        successRate: 0,
        averageDuration: 0,
        lastSuccessfulRun: '',
      };
      continue;
    }

    const successCount = stageRuns.filter((entry) => entry.stage.status === 'success').length;
    const successRate = (successCount / stageRuns.length) * 100;
    const averageDuration =
      stageRuns.reduce((sum, entry) => sum + entry.stage.duration, 0) / stageRuns.length;

    // Find last successful run timestamp
    const lastSuccess = stageRuns
      .filter((entry) => entry.stage.status === 'success')
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())[0];

    agentHealth[stageName] = {
      successRate: Math.round(successRate * 100) / 100,
      averageDuration: Math.round(averageDuration),
      lastSuccessfulRun: lastSuccess?.timestamp ?? '',
    };
  }

  // Recent failures: last 10 runs with error stages
  const recentFailures: ClassifiedError[] = [];
  const recentRuns = [...runs]
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, 10);

  for (const run of recentRuns) {
    for (const stage of run.stages) {
      if (stage.status === 'error') {
        recentFailures.push({
          category: 'application',
          severity: 'medium',
          retryable: true,
          message: `Stage "${stage.stage}" failed in run ${run.runId}`,
          originalError: null,
          suggestedAction: 'retry',
        });
      }
    }
  }

  // Trend data
  const trends = {
    last7Days: {
      runCount: store.aggregates.last7Days.runCount,
      averagePassRate: store.aggregates.last7Days.averagePassRate,
      averageDuration: store.aggregates.last7Days.averageDuration,
    },
    last30Days: {
      runCount: store.aggregates.last30Days.runCount,
      averagePassRate: store.aggregates.last30Days.averagePassRate,
      averageDuration: store.aggregates.last30Days.averageDuration,
    },
  };

  return {
    pipelineSuccessRate,
    averagePipelineDuration,
    agentHealth,
    recentFailures,
    trends,
  };
}

/**
 * Returns the current event buffer (useful for testing/debugging).
 */
export function getEventBuffer(): PipelineEvent[] {
  return [...eventBuffer];
}

/**
 * Returns the current metric buffer (useful for testing/debugging).
 */
export function getMetricBuffer(): MetricPoint[] {
  return [...metricBuffer];
}

/**
 * Clears the in-memory event and metric buffers.
 */
export function clearBuffers(): void {
  eventBuffer.length = 0;
  metricBuffer.length = 0;
}
