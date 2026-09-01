import * as fs from 'fs';
import * as path from 'path';

export interface TestExecutionRecord {
  status: 'passed' | 'failed' | 'skipped';
  timestamp: string;
}

export interface FlakyAnalysisResult {
  testTitle: string;
  totalRuns: number;
  flipFlopCount: number;
  flakinessScore: number; // 0.0 to 1.0
  isFlaky: boolean;
}

/**
 * Calculates flakiness score for test cases across chronological run histories.
 * Flakiness is defined as the frequency of status flip-flops (pass <-> fail) over total runs.
 */
export function analyzeTestFlakiness(
  historyRuns: Record<string, TestExecutionRecord[]>,
  flakinessThreshold = 0.25,
): FlakyAnalysisResult[] {
  const results: FlakyAnalysisResult[] = [];

  for (const [title, runs] of Object.entries(historyRuns)) {
    if (runs.length < 2) continue;

    let flipFlops = 0;
    for (let i = 1; i < runs.length; i++) {
      const prev = runs[i - 1].status;
      const curr = runs[i].status;
      if (prev !== 'skipped' && curr !== 'skipped' && prev !== curr) {
        flipFlops += 1;
      }
    }

    const flakinessScore = Number((flipFlops / (runs.length - 1)).toFixed(2));
    results.push({
      testTitle: title,
      totalRuns: runs.length,
      flipFlopCount: flipFlops,
      flakinessScore,
      isFlaky: flakinessScore >= flakinessThreshold,
    });
  }

  return results;
}

const DEFAULT_QUARANTINE_PATH = path.resolve(process.cwd(), 'artifacts', 'quarantine.json');

/**
 * Saves quarantined flaky test titles to a JSON file.
 */
export function saveQuarantineList(flakyTitles: string[], targetPath?: string): void {
  const dest = targetPath || DEFAULT_QUARANTINE_PATH;
  const dir = path.dirname(dest);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    dest,
    JSON.stringify({ quarantinedTests: flakyTitles, updatedAt: new Date().toISOString() }, null, 2),
    'utf-8',
  );
}

/**
 * Checks if a specific test title is currently in quarantine.
 */
export function isTestQuarantined(testTitle: string, targetPath?: string): boolean {
  const dest = targetPath || DEFAULT_QUARANTINE_PATH;
  if (!fs.existsSync(dest)) return false;
  try {
    const raw = fs.readFileSync(dest, 'utf-8');
    const data = JSON.parse(raw);
    return Array.isArray(data.quarantinedTests) && data.quarantinedTests.includes(testTitle);
  } catch {
    return false;
  }
}
