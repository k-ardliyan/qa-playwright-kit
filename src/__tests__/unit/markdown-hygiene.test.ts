import { test, expect } from '@playwright/test';
import {
  hasBrokenInlineCode,
  findBrokenCodeRows,
} from '../../../tools/mcp/src/tools/parsers/md-labels';
import { compileRequirementFromText } from '../../../tools/mcp/src/tools/compile-requirement';
import { validateRequirementText } from '../../../tools/mcp/src/tools/validate-requirement';

/**
 * The tes-qa requirement shipped malformed table cells — `| Covers | AC-03\`, \`AC-16 |`
 * and `` | Layer terdampak | \`FE\`\` \`BE\` | `` — authored free-hand by an
 * agent with no hygiene check. The parsers strip backticks silently, so
 * nothing ever flagged it. These tests pin: (1) the detectors, (2) the
 * canonical formats staying clean, (3) Covers parsing that survives
 * space-separated cells, and (4) validate_requirement surfacing the warning.
 */
test.describe('markdown hygiene — broken inline-code detection', () => {
  test('detects the two tes-qa artifact shapes', () => {
    // Empty code span (adjacent ticks) — the `FE`` ``BE` layer cell.
    expect(hasBrokenInlineCode('`FE`` ``BE`')).toBe(true);
    // Span wrapping only separator punctuation — the AC-03`, `AC-16 covers cell.
    expect(hasBrokenInlineCode('AC-03`, `AC-16')).toBe(true);
    // Unclosed span.
    expect(hasBrokenInlineCode('halaman `login')).toBe(true);
  });

  test('keeps canonical cells clean', () => {
    // The canonical comma-separated multi-code cell from _TEMPLATE.md.
    expect(hasBrokenInlineCode('`AC-01`, `AC-02`')).toBe(false);
    // Prose + code (the md-labels regression case).
    expect(hasBrokenInlineCode('URL ke `/dashboard`')).toBe(false);
    // No backticks at all.
    expect(hasBrokenInlineCode('FE dan BE')).toBe(false);
    // The template's spaces-only input literal (login-none.md Input Data) —
    // a whitespace-only span is a deliberate value, not broken authoring.
    expect(
      hasBrokenInlineCode('identifier: literal:`   `<br>password: credential:user.password'),
    ).toBe(false);
  });

  test('findBrokenCodeRows reports 1-based lines and skips headers/separators', () => {
    const md = [
      '# REQ-1: X',
      '',
      '| Field | Nilai |',
      '| ----- | ----- |',
      '| Covers | `AC-01` |',
      '| Covers | AC-03`, `AC-16 |',
      '| Layer | `FE`` ``BE` |',
    ].join('\n');
    expect(findBrokenCodeRows(md)).toEqual([6, 7]);
  });
});

test.describe('markdown hygiene — Covers parsing tolerance', () => {
  const reqWith = (coversCell: string): string =>
    [
      '# REQ-TEST-1: Feature',
      '',
      '## Metadata',
      '',
      '| Field | Nilai |',
      '| ----- | ----- |',
      '| Module | hris |',
      '| Feature | payroll |',
      '',
      '## Kriteria Penerimaan',
      '',
      '| ID  | Kriteria        |',
      '| --- | --------------- |',
      '| AC-01 | Halaman tampil |',
      '| AC-02 | Data tersimpan |',
      '',
      '### SC-01: Akses Halaman',
      '',
      '| Field  | Nilai |',
      '| ------ | ----- |',
      '| Test ID | TC-001 |',
      '| Covers | ' + coversCell + ' |',
      '| Langkah | Buka halaman |',
      '| Hasil yang Diharapkan | Halaman tampil |',
    ].join('\n');

  test('parses space-separated Covers into two ids, not one bogus id', () => {
    const out = compileRequirementFromText(reqWith('`AC-01` `AC-02`'));
    expect(out.status).toBe('success');
    const covers = out.data?.scenarios[0]?.covers ?? [];
    expect(covers).toEqual(['AC-01', 'AC-02']);
  });

  test('keeps parsing the canonical comma-separated Covers', () => {
    const out = compileRequirementFromText(reqWith('`AC-01`, `AC-02`'));
    expect(out.status).toBe('success');
    const covers = out.data?.scenarios[0]?.covers ?? [];
    expect(covers).toEqual(['AC-01', 'AC-02']);
  });
});

test.describe('markdown hygiene — validate_requirement surfaces the warning', () => {
  test('warns on a requirement carrying the tes-qa artifacts', () => {
    const md = [
      '# REQ-TEST-2: Feature',
      '',
      '## Metadata',
      '',
      '| Field | Nilai |',
      '| ----- | ----- |',
      '| Module | hris |',
      '| Feature | payroll |',
      '',
      '## Kriteria Penerimaan',
      '',
      '| ID  | Kriteria        |',
      '| --- | --------------- |',
      '| AC-01 | Halaman tampil |',
      '',
      '### SC-01: Akses Halaman',
      '',
      '| Field  | Nilai |',
      '| ------ | ----- |',
      '| Test ID | TC-001 |',
      '| Covers | AC-01`, `AC-99 |',
      '| Langkah | Buka halaman |',
      '| Hasil yang Diharapkan | Halaman tampil |',
    ].join('\n');

    const out = validateRequirementText(md);
    const hygiene = out.violations.find((v) => v.ruleName === 'markdown_hygiene');
    expect(hygiene).toBeDefined();
    expect(hygiene?.severity).toBe('warn');
    expect(hygiene?.message).toContain('line(s) 21');
    expect(hygiene?.suggestion).toContain('`AC-01`, `AC-02`');
  });

  test('stays silent on a hygienic requirement', () => {
    const md = [
      '# REQ-TEST-3: Feature',
      '',
      '## Metadata',
      '',
      '| Field | Nilai |',
      '| ----- | ----- |',
      '| Module | hris |',
      '| Feature | payroll |',
      '',
      '## Kriteria Penerimaan',
      '',
      '| ID  | Kriteria        |',
      '| --- | --------------- |',
      '| AC-01 | Halaman tampil |',
      '',
      '### SC-01: Akses Halaman',
      '',
      '| Field  | Nilai |',
      '| ------ | ----- |',
      '| Test ID | TC-001 |',
      '| Covers | `AC-01` |',
      '| Langkah | Buka halaman |',
      '| Hasil yang Diharapkan | Halaman tampil |',
    ].join('\n');

    const out = validateRequirementText(md);
    expect(out.violations.find((v) => v.ruleName === 'markdown_hygiene')).toBeUndefined();
  });
});
