import fs from 'node:fs';
import path from 'node:path';
import type { StepLocation, StepSnippet } from '../custom-dashboard/types';

/**
 * Source peek for a step, mirroring the built-in Playwright HTML report.
 *
 * Playwright bakes a babel-highlighted `snippet` into its own report.json; we
 * have no bundler/highlighter dependency here, so we keep the DATA minimal
 * (plain source lines + the highlighted line number) and tokenize at render
 * time in the view. That keeps `test-summary.json` small — one window per step
 * would otherwise multiply the payload with markup.
 */

const LINES_ABOVE = 2;
const LINES_BELOW = 2;
const MAX_LINE_LENGTH = 400;

/** Read cache — a spec file is peeked once per run, not once per step. */
const fileCache = new Map<string, string[] | null>();

function readLines(absPath: string): string[] | null {
  const cached = fileCache.get(absPath);
  if (cached !== undefined) return cached;
  let lines: string[] | null = null;
  try {
    lines = fs.readFileSync(absPath, 'utf-8').split(/\r?\n/);
  } catch {
    lines = null;
  }
  fileCache.set(absPath, lines);
  return lines;
}

/** Test-only: drop the read cache so a rewritten fixture is re-read. */
export function __resetSnippetCache(): void {
  fileCache.clear();
}

/**
 * Normalize a Playwright step location to a workspace-relative path.
 * Playwright reports absolute paths; the dashboard links and labels relative
 * ones (the same normalization the reporter applies to `filePath`).
 */
export function toStepLocation(
  location: { file: string; line: number; column: number } | undefined,
): StepLocation | undefined {
  if (!location?.file || !location.line) return undefined;
  const file = path.relative(process.cwd(), location.file).replace(/\\/g, '/');
  // A location outside the workspace (node_modules) is noise in a QA report.
  if (file.startsWith('..')) return undefined;
  return { file, line: location.line, column: location.column || 1 };
}

/**
 * Extract a small window of source around a step. Returns undefined when the
 * file is unreadable or the line is out of range — the view then renders the
 * step without a code peek, exactly as the built-in report does when snippets
 * are disabled.
 */
export function buildStepSnippet(location: StepLocation | undefined): StepSnippet | undefined {
  if (!location) return undefined;
  const absPath = path.resolve(process.cwd(), location.file);
  const lines = readLines(absPath);
  if (!lines || location.line < 1 || location.line > lines.length) return undefined;

  const start = Math.max(1, location.line - LINES_ABOVE);
  const end = Math.min(lines.length, location.line + LINES_BELOW);
  const window: string[] = [];
  for (let n = start; n <= end; n += 1) {
    window.push((lines[n - 1] ?? '').slice(0, MAX_LINE_LENGTH));
  }

  return { startLine: start, highlightLine: location.line, lines: window };
}
