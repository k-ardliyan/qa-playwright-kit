import * as fs from 'fs';
import * as path from 'path';

export interface FailedTestInfo {
  title: string;
  testId?: string;
  filePath?: string;
  errorMessage?: string;
}

const DEFAULT_SUMMARY_PATH = path.resolve(
  process.cwd(),
  'artifacts',
  'reports',
  'test-summary.json',
);

/** Failed/unhealthy statuses in a test-summary.json testCase row. */
const FAILED_STATUSES = new Set(['failed', 'timedOut', 'interrupted']);

// Re-exported for existing consumers (kept stable after the shared-module move).
export { buildFailedGrepPattern } from '../../src/shared/mcp/failed-grep';

/**
 * Extracts failed or unhealthy test titles from the latest test-summary.json.
 * `summaryPath` may also point at a per-run Playwright JSON report
 * (results.json) — its nested suites are walked for failed test titles.
 */
export function extractFailedTestTitles(summaryPath?: string): string[] {
  const targetPath = summaryPath || DEFAULT_SUMMARY_PATH;
  if (!fs.existsSync(targetPath)) return [];

  try {
    const data = JSON.parse(fs.readFileSync(targetPath, 'utf-8'));

    // Native Playwright JSON reporter shape: nested suites + specs.
    const specs: Array<{ title?: string; ok?: boolean }> = [];
    const walk = (suites: unknown): void => {
      if (!Array.isArray(suites)) return;
      for (const s of suites) {
        if (!s || typeof s !== 'object') continue;
        const suite = s as { specs?: unknown; suites?: unknown };
        if (Array.isArray(suite.specs)) specs.push(...(suite.specs as typeof specs));
        walk(suite.suites);
      }
    };
    walk((data as { suites?: unknown }).suites);

    const rows = Array.isArray(data.testCases)
      ? (data.testCases as Array<{ status?: string; title?: string }>)
      : specs.map((s) => ({ status: s.ok ? 'passed' : 'failed', title: s.title }));

    const failed = rows
      .filter((tc) => FAILED_STATUSES.has(tc.status ?? ''))
      .map((tc) => tc.title)
      .filter((title): title is string => Boolean(title && title.trim().length > 0));

    return Array.from(new Set(failed));
  } catch {
    return [];
  }
}
