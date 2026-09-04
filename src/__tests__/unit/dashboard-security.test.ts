import { test, expect } from '@playwright/test';
import { jsonForScript, escapeHtml } from '../../support/custom-dashboard/shared';
import { isValidRunId, isQaDecision, QA_DECISIONS } from '../../agents/reporter/report-archive';
import { renderFailureSourceCell } from '../../support/custom-dashboard/export-helpers';

test.describe('dashboard security — inline script JSON embedding', () => {
  test('jsonForScript escapes < so </script> cannot break out of inline script block', () => {
    const payload = '</script><script>alert(1)</script>';
    const out = jsonForScript({ title: payload });
    // The serialized output must NOT contain a literal "</script>".
    expect(out).not.toContain('</script>');
    // '<' is replaced with the \u003c escape sequence (stays valid JSON).
    expect(out).toContain('\\u003c/script\\u003e');
    // Round-trip still yields the original string after JSON.parse.
    const reparsed = JSON.parse(out) as { title: string };
    expect(reparsed.title).toBe(payload);
  });

  test('jsonForScript escapes > and & too', () => {
    const out = jsonForScript({ a: '<b>&"c"' });
    expect(out).not.toContain('<b>');
    expect(out).not.toContain('&');
    // JSON.parse recovers the original value.
    expect(JSON.parse(out)).toEqual({ a: '<b>&"c"' });
  });

  test('jsonForScript leaves ordinary strings intact after parse', () => {
    const out = jsonForScript({ module: 'Finance', feature: 'Invoice <approval>' });
    expect(JSON.parse(out)).toEqual({ module: 'Finance', feature: 'Invoice <approval>' });
  });
});

test.describe('dashboard security — runId validation (path traversal)', () => {
  test('isValidRunId accepts canonical run ids', () => {
    expect(isValidRunId('run-20260730-140422-162')).toBe(true);
    expect(isValidRunId('run-1785387552280')).toBe(true);
  });

  test('isValidRunId rejects traversal / separator / dotdot', () => {
    expect(isValidRunId('../secret')).toBe(false);
    expect(isValidRunId('..\\secret')).toBe(false);
    expect(isValidRunId('run-1/../../etc/passwd')).toBe(false);
    expect(isValidRunId('run-1\\..\\..\\etc\\passwd')).toBe(false);
    expect(isValidRunId('run-1..2')).toBe(false);
    expect(isValidRunId('run-1<script>')).toBe(false);
    expect(isValidRunId('')).toBe(false);
  });
});

test.describe('dashboard security — QA decision contract', () => {
  test('exposes exactly six accepted decisions', () => {
    expect(QA_DECISIONS).toEqual([
      'APPROVE',
      'FILE_BUG',
      'REVISE_REQUIREMENT',
      'FIX_TEST',
      'FIX_ENV',
      'MARK_BLOCKED',
    ]);
    expect(isQaDecision('APPROVE')).toBe(true);
    expect(isQaDecision('approve')).toBe(false);
    expect(isQaDecision('')).toBe(false);
  });
});

test.describe('dashboard security — failure source cell escaping', () => {
  test('renderFailureSourceCell escapes failureSource and decision text', () => {
    // failureSource is rendered into class + text; decision hint/blurb are
    // escaped. A hostile failureSource value must not break out of the cell.
    const html = renderFailureSourceCell({
      status: 'failed',
      failureSource: 'test',
      errorMessage: '</span><img src=x onerror=alert(1)>',
    });
    // failureSource value (test) appears escaped in the badge.
    expect(html).toContain('failure-source--test');
    expect(html).toContain('>TEST<');
    // The raw errorMessage payload must never reach the HTML body.
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('src-cell__blurb');
  });

  test('renderFailureSourceCell renders dash for missing source', () => {
    expect(renderFailureSourceCell({})).toContain('muted');
    expect(renderFailureSourceCell({})).toContain('-');
  });

  test('escapeHtml escapes single quotes (onclick context)', () => {
    const out = escapeHtml("foo';alert(1);//");
    expect(out).not.toContain("'");
    expect(out).toContain('&#039;');
  });
});
