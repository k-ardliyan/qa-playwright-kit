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

// ---------------------------------------------------------------------------
// CLI Execution Entry Point
// Usage: npx tsx tools/scripts/smart-shard.ts --shards=4 --index=1
// ---------------------------------------------------------------------------
if (require.main === module || process.argv[1]?.endsWith('smart-shard.ts')) {
  const args = process.argv.slice(2);
  let totalShards = 1;
  let shardIndex = 1;

  for (const arg of args) {
    if (arg.startsWith('--shards=')) {
      totalShards = parseInt(arg.split('=')[1], 10) || 1;
    } else if (arg.startsWith('--index=')) {
      shardIndex = parseInt(arg.split('=')[1], 10) || 1;
    }
  }

  const testsDir = path.resolve(process.cwd(), 'tests');
  const allSpecs: string[] = [];

  function walk(dir: string) {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory() && entry.name !== 'node_modules' && entry.name !== 'demo') {
        walk(full);
      } else if (entry.isFile() && entry.name.endsWith('.spec.ts')) {
        allSpecs.push(path.relative(process.cwd(), full).replace(/\\/g, '/'));
      }
    }
  }

  walk(testsDir);

  const durations = loadHistoricalDurations();
  const partitions = partitionSpecsLPT(allSpecs, totalShards, durations);
  const target = partitions.find((p) => p.shardIndex === shardIndex) || partitions[0];

  if (target && target.specs.length > 0) {
    // Outputs file paths separated by space for direct consumption by npx playwright test
    process.stdout.write(target.specs.join(' '));
  }
}
