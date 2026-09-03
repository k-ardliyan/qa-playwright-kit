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

/**
 * Extracts failed or unhealthy test titles from the latest test-summary.json.
 */
export function extractFailedTestTitles(summaryPath?: string): string[] {
  const targetPath = summaryPath || DEFAULT_SUMMARY_PATH;
  if (!fs.existsSync(targetPath)) return [];

  try {
    const raw = fs.readFileSync(targetPath, 'utf-8');
    const data = JSON.parse(raw);
    if (!Array.isArray(data.testCases)) return [];

    const failed = data.testCases
      .filter(
        (tc: { status?: string }) =>
          tc.status === 'failed' || tc.status === 'timedOut' || tc.status === 'interrupted',
      )
      .map((tc: { title?: string }) => tc.title)
      .filter((title: string | undefined): title is string =>
        Boolean(title && title.trim().length > 0),
      );

    return Array.from(new Set(failed));
  } catch {
    return [];
  }
}

/**
 * Builds a regex grep string for Playwright CLI to execute only the failed tests.
 */
export function buildFailedGrepPattern(titles: string[]): string {
  if (titles.length === 0) return '';
  const escaped = titles.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return `(${escaped.join('|')})`;
}

// ---------------------------------------------------------------------------
// CLI Execution Entry Point
// Usage: npx tsx tools/scripts/failed-only.ts
// ---------------------------------------------------------------------------
if (require.main === module || process.argv[1]?.endsWith('failed-only.ts')) {
  const titles = extractFailedTestTitles();
  if (titles.length === 0) {
    process.stderr.write('No failed tests found in the latest summary.\n');
    process.exit(0);
  }

  const grep = buildFailedGrepPattern(titles);
  // Outputs --grep pattern for direct consumption
  process.stdout.write(`-g "${grep}"`);
}
