import * as fs from 'fs';
import * as path from 'path';

export interface SpecDurationMap {
  [specRelativePath: string]: number;
}

export interface ShardPartition {
  shardIndex: number;
  totalDurationMs: number;
  specs: string[];
}

/**
 * Loads average or latest spec durations from archived test summaries.
 */
export function loadHistoricalDurations(archiveDir?: string): SpecDurationMap {
  const baseDir = archiveDir || path.resolve(process.cwd(), 'artifacts', 'reports', 'archive');
  const durations: Record<string, { totalMs: number; count: number }> = {};

  if (!fs.existsSync(baseDir)) return {};

  try {
    const runDirs = fs
      .readdirSync(baseDir)
      .filter((f) => fs.statSync(path.join(baseDir, f)).isDirectory());

    for (const run of runDirs) {
      const summaryFile = path.join(baseDir, run, 'test-summary.json');
      if (!fs.existsSync(summaryFile)) continue;

      try {
        const raw = fs.readFileSync(summaryFile, 'utf-8');
        const data = JSON.parse(raw);
        if (Array.isArray(data.testCases)) {
          for (const tc of data.testCases) {
            const spec = (tc.filePath || '').replace(/\\/g, '/');
            if (!spec) continue;
            if (!durations[spec]) {
              durations[spec] = { totalMs: 0, count: 0 };
            }
            durations[spec].totalMs += tc.duration || 10000;
            durations[spec].count += 1;
          }
        }
      } catch {
        // skip unreadable summary
      }
    }
  } catch {
    // skip unreadable directory
  }

  const result: SpecDurationMap = {};
  for (const [spec, stats] of Object.entries(durations)) {
    result[spec] = Math.round(stats.totalMs / (stats.count || 1));
  }
  return result;
}

/**
 * Balances test specs across N shards using the Longest Processing Time First (LPT)
 * Greedy Bin-Packing Algorithm.
 */
export function partitionSpecsLPT(
  specs: string[],
  totalShards: number,
  historicalDurations: SpecDurationMap = {},
  defaultDurationMs = 15000,
): ShardPartition[] {
  if (totalShards <= 0) throw new Error('totalShards must be >= 1');

  const shards: ShardPartition[] = Array.from({ length: totalShards }, (_, i) => ({
    shardIndex: i + 1,
    totalDurationMs: 0,
    specs: [],
  }));

  // 1. Sort specs descending by duration (LPT)
  const sortedSpecs = [...specs].sort((a, b) => {
    const durA = historicalDurations[a.replace(/\\/g, '/')] || defaultDurationMs;
    const durB = historicalDurations[b.replace(/\\/g, '/')] || defaultDurationMs;
    return durB - durA;
  });

  // 2. Greedily place each spec into the shard with the lowest cumulative load
  for (const spec of sortedSpecs) {
    shards.sort((a, b) => a.totalDurationMs - b.totalDurationMs);
    const targetShard = shards[0];
    const duration = historicalDurations[spec.replace(/\\/g, '/')] || defaultDurationMs;
    targetShard.specs.push(spec);
    targetShard.totalDurationMs += duration;
  }

  // Return sorted by original shardIndex
  return shards.sort((a, b) => a.shardIndex - b.shardIndex);
}
