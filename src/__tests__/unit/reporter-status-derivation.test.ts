import { test, expect } from '@playwright/test';
import {
  hasFixmeAnnotation,
  resolveNotImplementedReason,
  resolveReportedStatus,
} from '../../support/custom-reporter';

/**
 * The reporter must separate "planned but not built" (`test.fixme`) from
 * "not applicable to automation" (`test.skip` / `@manual`). Playwright reports
 * BOTH as `skipped`, so only the annotation distinguishes them — these tests
 * pin that mapping, since losing it silently files unbuilt work as a skip.
 */
test.describe('reporter status derivation — fixme vs skip', () => {
  test('hasFixmeAnnotation reads the annotation type, not its description', () => {
    // A bare test.fixme('title', fn) carries an empty description.
    expect(hasFixmeAnnotation({ annotations: [{ type: 'fixme' }] })).toBe(true);
    expect(hasFixmeAnnotation({ annotations: [{ type: 'fixme', description: '' }] })).toBe(true);
    expect(hasFixmeAnnotation({ annotations: [{ type: 'skip', description: 'manual' }] })).toBe(
      false,
    );
    expect(hasFixmeAnnotation({ annotations: [] })).toBe(false);
    expect(hasFixmeAnnotation({})).toBe(false);
  });

  test('a fixme-reported skip becomes not-implemented', () => {
    expect(resolveReportedStatus('skipped', { annotations: [{ type: 'fixme' }] })).toBe(
      'not-implemented',
    );
  });

  test('a genuine @manual skip stays skipped', () => {
    expect(
      resolveReportedStatus('skipped', { annotations: [{ type: 'skip', description: 'manual' }] }),
    ).toBe('skipped');
  });

  test('other statuses pass through untouched', () => {
    expect(resolveReportedStatus('passed', {})).toBe('passed');
    expect(resolveReportedStatus('failed', {})).toBe('failed');
    expect(resolveReportedStatus('timedOut', { annotations: [{ type: 'fixme' }] })).toBe(
      'timedOut',
    );
  });

  test('a fixme annotation on a passing test does not rewrite the status', () => {
    // Only a skipped result can be an unfinished placeholder — a test that ran
    // and passed is implemented, whatever annotation it carries.
    expect(resolveReportedStatus('passed', { annotations: [{ type: 'fixme' }] })).toBe('passed');
  });
});

/**
 * The reason text is the per-scenario answer to QA's "kenapa belum jalan" —
 * without it the dashboard can only repeat a generic static tooltip. These
 * tests pin the derivation: fixme reason on not-implemented, skip reason on
 * manual skips, nothing on ran tests, and undefined (→ static fallback) for a
 * bare fixme with no description.
 */
test.describe('reporter status derivation — not-implemented reason', () => {
  test('carries the fixme annotation description on a not-implemented row', () => {
    expect(
      resolveNotImplementedReason('not-implemented', {
        annotations: [
          { type: 'fixme', description: 'Butuh payroll berjalan sampai status Dibayar' },
        ],
      }),
    ).toBe('Butuh payroll berjalan sampai status Dibayar');
  });

  test('carries the skip reason on a manual skip', () => {
    expect(
      resolveNotImplementedReason('skipped', {
        annotations: [{ type: 'skip', description: 'Manual: butuh OTP fisik' }],
      }),
    ).toBe('Manual: butuh OTP fisik');
  });

  test('a bare fixme (no description) yields undefined — UI falls back to static hint', () => {
    expect(
      resolveNotImplementedReason('not-implemented', { annotations: [{ type: 'fixme' }] }),
    ).toBe(undefined);
  });

  test('tests that ran carry no reason', () => {
    expect(resolveNotImplementedReason('passed', {})).toBeUndefined();
    expect(
      resolveNotImplementedReason('failed', { annotations: [{ type: 'fixme', description: 'x' }] }),
    ).toBe(undefined);
  });
});
