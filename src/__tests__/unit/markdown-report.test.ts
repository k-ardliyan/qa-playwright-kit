import { test, expect } from '@playwright/test';
import { buildMarkdownReport } from '../../support/reporter/markdown-report';
import { formatMarkdownInText } from '../../../tools/scripts/format-markdown';

/**
 * Markdown export — content and standard compliance.
 *
 * The output is piped through the repo's own `formatMarkdownInText`, so these
 * tests assert the two things that could still go wrong: the DATA it reports
 * (counts must match the summary, not a recomputation) and the escaping that
 * keeps a hostile test title from becoming live HTML.
 */

function summary(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    total: 4,
    passed: 2,
    failed: 1,
    skipped: 1,
    passRate: 50,
    timestamp: '2026-10-02T09:15:00.000Z',
    reportMode: 'general',
    analysisVerdict: 'complete',
    analysisVerified: true,
    runMeta: { appEnv: 'staging', runId: 'run-1', totalDurationMs: 41_230 },
    testCases: [],
    ...overrides,
  };
}

test.describe('buildMarkdownReport', () => {
  test('uses the summary counts, not a recomputation from testCases', () => {
    // testCases says 1 passed; the summary says 2. The summary wins, because it
    // is the number every other surface shows.
    const md = buildMarkdownReport(
      summary({
        testCases: [{ testId: 'A', title: 'a', status: 'passed' }],
      }),
    );
    expect(md).toContain('**Result:** 50% passed · 2 passed · 1 failed · 1 skipped · 4 total');
  });

  test('escapes angle brackets so a title cannot become live HTML', () => {
    const md = buildMarkdownReport(
      summary({
        testCases: [
          {
            testId: 'SC-1',
            title: 'Reject <script>alert(1)</script>',
            status: 'failed',
            expectedResult: 'banner <b>bold</b>',
            errorMessage: 'raw <script> stays inside the fence',
          },
        ],
      }),
    );
    // Prose and table text are entity-escaped…
    expect(md).toContain('&lt;script&gt;');
    expect(md).toContain('&lt;b&gt;bold&lt;/b&gt;');
    // …but the code fence keeps the raw text, where escaping would corrupt it.
    expect(md).toContain('raw <script> stays inside the fence');

    // The real requirement: no raw tag survives OUTSIDE a fenced block.
    const outsideFences = md
      .split('\n')
      .reduce<{ inFence: boolean; text: string[] }>(
        (acc, line) => {
          if (line.trim().startsWith('```')) {
            acc.inFence = !acc.inFence;
            return acc;
          }
          if (!acc.inFence) acc.text.push(line);
          return acc;
        },
        { inFence: false, text: [] },
      )
      .text.join('\n');
    expect(outsideFences).not.toContain('<script>');
    expect(outsideFences).not.toContain('<b>');
  });

  test('escapes a pipe so a title cannot break the table', () => {
    const md = buildMarkdownReport(
      summary({
        testCases: [{ testId: 'SC-2', title: 'a | b', status: 'passed' }],
      }),
    );
    expect(md).toContain('a \\| b');
  });

  test('omits the Run ID row for a local run and never titles itself with a dash', () => {
    const md = buildMarkdownReport(summary({ runMeta: { appEnv: 'local', totalDurationMs: 100 } }));
    expect(md).not.toContain('| Run ID |');
    expect(md).not.toMatch(/^# QA Report — -$/m);
    // Falls back to the timestamp as identity.
    expect(md).toMatch(/^# QA Report — 2026-10-02T09:15:00\.000Z$/m);
  });

  test('a not-applicable verdict is not labelled "not verified"', () => {
    const md = buildMarkdownReport(
      summary({ analysisVerdict: 'not-applicable', analysisVerified: false }),
    );
    expect(md).toContain('**Verdict:** NOT-APPLICABLE');
    expect(md).not.toContain('NOT-APPLICABLE (not verified)');
  });

  test('output is formatter-stable: aligned tables, one trailing newline', () => {
    const md = buildMarkdownReport(
      summary({
        testCases: [
          { testId: 'SC-1', title: 'short', status: 'passed', duration: 640 },
          { testId: 'SC-LONG-2', title: 'a much longer title', status: 'failed', duration: 1500 },
        ],
      }),
    );
    const rows = md.split('\n').filter((l) => l.trim().startsWith('|'));
    // Every row of a given table has the same pipe count (alignment padding).
    const counts = new Set(rows.map((l) => (l.match(/\|/g) ?? []).length));
    expect(counts.size).toBeLessThanOrEqual(2);
    expect(md.endsWith('\n')).toBe(true);
    expect(md.endsWith('\n\n')).toBe(false);
    // Durations follow the shared rule.
    expect(md).toContain('640ms');
    expect(md).toContain('1.50s');
    expect(md).not.toMatch(/\b\d{4,}ms\b/);
  });

  test('the repo formatter is a no-op on the output (true standard compliance)', () => {
    // The real proof: feed the generated markdown back through the project's own
    // formatter. A no-op means the file already satisfies the standard rather
    // than merely looking tidy. (`format:check` cannot prove this — it SKIPS
    // artifacts/, so a generated report is never covered by it.)
    const md = buildMarkdownReport(
      summary({
        testCases: [
          {
            testId: 'SC-1',
            title: 'Approve invoice with a fairly long descriptive title here',
            status: 'failed',
            duration: 1500,
            failureSource: 'app',
            expectedResult: 'Banner tampil',
            actualResult: 'Banner tidak muncul',
            errorMessage: 'Error: expect(locator).toBeVisible() failed\nCall log:\n  - waiting',
            qaNotes: 'Sudah dicek manual.',
            aiNotes: '[healer] Elemen tidak ditemukan.\nObservasi: Redirect duluan.',
          },
          { testId: 'SC-2', title: 'short', status: 'passed', duration: 640 },
          { testId: 'SC-3', title: 'a | pipe <script>', status: 'skipped' },
        ],
        aiInsights: ['Modul invoice gagal dua run berturut.'],
      }),
    );
    expect(formatMarkdownInText(md), 'generated markdown is not formatter-stable').toBe(md);
  });
});
