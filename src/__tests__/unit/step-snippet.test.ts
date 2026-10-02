import { test, expect } from '@playwright/test';
import { formatDuration } from '../../support/custom-dashboard/shared';
import { tokenizeLine } from '../../support/custom-dashboard/code-highlight';
import {
  buildStepSnippet,
  toStepLocation,
  __resetSnippetCache,
} from '../../support/reporter/snippet';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';

/**
 * The step source peek: duration formatting, the shallow tokenizer, and the
 * snippet window. These three are pure and shared, so they get direct tests —
 * the rendered result in the accordion is covered by the browser suite.
 */

test.describe('formatDuration', () => {
  test('keeps sub-second values in ms', () => {
    expect(formatDuration(0)).toBe('0ms');
    expect(formatDuration(1)).toBe('1ms');
    expect(formatDuration(999)).toBe('999ms');
  });

  test('switches to seconds at exactly 1000ms', () => {
    expect(formatDuration(1000)).toBe('1.00s');
    expect(formatDuration(1500)).toBe('1.50s');
    expect(formatDuration(41230)).toBe('41.23s');
  });

  test('never emits a negative or non-finite figure', () => {
    expect(formatDuration(-5)).toBe('0ms');
    expect(formatDuration(Number.NaN)).toBe('0ms');
    expect(formatDuration(Number.POSITIVE_INFINITY)).toBe('0ms');
  });
});

test.describe('tokenizeLine', () => {
  test('classifies keywords, strings, numbers and comments', () => {
    const tokens = tokenizeLine("const x = 'hi'; // note");
    const byType = (t: string) => tokens.filter((tok) => tok.type === t).map((tok) => tok.text);
    expect(byType('keyword')).toContain('const');
    expect(byType('string')).toEqual(["'hi'"]);
    expect(byType('comment')).toEqual(['// note']);
  });

  test('a number is not mistaken for an identifier', () => {
    const tokens = tokenizeLine('await page.waitForTimeout(5000);');
    expect(tokens.find((t) => t.type === 'number')?.text).toBe('5000');
    expect(tokens.filter((t) => t.type === 'keyword').map((t) => t.text)).toEqual(['await']);
  });

  test('round-trips the original text exactly', () => {
    const line = "await expect(page.locator('#id')).toHaveText('a b');";
    expect(
      tokenizeLine(line)
        .map((t) => t.text)
        .join(''),
    ).toBe(line);
  });

  test('an unterminated string still consumes the rest of the line', () => {
    const line = "const s = 'oops";
    expect(
      tokenizeLine(line)
        .map((t) => t.text)
        .join(''),
    ).toBe(line);
  });
});

test.describe('toStepLocation', () => {
  test('normalizes an absolute path to workspace-relative with forward slashes', () => {
    const loc = toStepLocation({
      file: path.join(process.cwd(), 'tests', 'demo', 'x.spec.ts'),
      line: 12,
      column: 5,
    });
    expect(loc).toEqual({ file: 'tests/demo/x.spec.ts', line: 12, column: 5 });
  });

  test('drops a location outside the workspace (node_modules noise)', () => {
    const outside = path.join(path.dirname(process.cwd()), 'elsewhere', 'a.ts');
    expect(toStepLocation({ file: outside, line: 3, column: 1 })).toBeUndefined();
  });

  test('returns undefined when there is no location', () => {
    expect(toStepLocation(undefined)).toBeUndefined();
  });
});

test.describe('buildStepSnippet', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'snippet-test-'));
  const abs = path.join(dir, 'sample.ts');
  fs.writeFileSync(abs, ['l1', 'l2', 'l3', 'l4', 'l5', 'l6', 'l7', 'l8'].join('\n'));
  const rel = path.relative(process.cwd(), abs).replace(/\\/g, '/');

  test('returns a window around the highlighted line', () => {
    __resetSnippetCache();
    const snippet = buildStepSnippet({ file: rel, line: 4, column: 1 });
    expect(snippet).toBeDefined();
    expect(snippet!.highlightLine).toBe(4);
    // Two above, two below.
    expect(snippet!.startLine).toBe(2);
    expect(snippet!.lines).toEqual(['l2', 'l3', 'l4', 'l5', 'l6']);
    expect(snippet!.lines[4 - snippet!.startLine]).toBe('l4');
  });

  test('clamps at the file start', () => {
    __resetSnippetCache();
    const snippet = buildStepSnippet({ file: rel, line: 1, column: 1 });
    expect(snippet!.startLine).toBe(1);
    expect(snippet!.lines[0]).toBe('l1');
  });

  test('returns undefined for an unreadable file or an out-of-range line', () => {
    __resetSnippetCache();
    expect(buildStepSnippet({ file: 'no/such/file.ts', line: 1, column: 1 })).toBeUndefined();
    expect(buildStepSnippet({ file: rel, line: 999, column: 1 })).toBeUndefined();
    expect(buildStepSnippet(undefined)).toBeUndefined();
  });
});
