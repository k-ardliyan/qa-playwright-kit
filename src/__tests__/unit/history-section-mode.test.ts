import { test, expect } from '@playwright/test';
import { buildHistorySection } from '../../support/custom-dashboard/build-history-view';
import type { ReportHistoryEntry } from '../../agents/reporter/report-history';

const sampleEntry: ReportHistoryEntry = {
  runId: 'run-20260730-140422-162',
  ranAt: '2026-07-30T14:04:20.000Z',
  savedAt: '2026-07-30T14:04:22.000Z',
  appEnv: 'local',
  passRate: 75,
  totalTests: 12,
  passed: 9,
  failed: 2,
  skipped: 1,
  status: 'partial',
  qaDecision: 'FIX_TEST',
  qaNotes: 'flaky selector',
  triggerSource: 'test',
  requirementPath: 'requirements/sample.md',
  reportMode: 'general',
};

test.describe('history section static vs serve mode', () => {
  test('static mode renders Compare button with server hint (no dead hash link)', () => {
    const html = buildHistorySection([{ ...sampleEntry }], { serveMode: false });
    expect(html).toContain('Compare requires the dashboard server');
    expect(html).not.toContain("window.location.hash='#/compare");
  });

  test('serve mode renders Compare button with working hash navigation', () => {
    const html = buildHistorySection([{ ...sampleEntry }], { serveMode: true });
    expect(html).toContain("window.location.hash='#/compare?current=");
    expect(html).not.toContain('Compare requires the dashboard server');
  });

  test('onclick reads runId from data-run-id instead of interpolating it', () => {
    const html = buildHistorySection([{ ...sampleEntry, runId: "run-1');alert(1);//" }], {
      serveMode: true,
    });
    expect(html).toContain("this.closest('[data-run-id]').getAttribute('data-run-id')");
    expect(html).not.toContain("showArchiveDetail('run-1");
    expect(html).not.toContain("deleteArchive('run-1");
    const onclicks = [...html.matchAll(/onclick="([^"]*)"/g)].map((m) => m[1]);
    expect(onclicks.length).toBeGreaterThan(0);
    for (const handler of onclicks) {
      expect(handler).not.toContain('alert(1)');
      expect(handler).not.toContain("run-1')");
    }
  });

  test('empty history copy is English and has no decorative emoji', () => {
    const html = buildHistorySection([], { serveMode: true });
    expect(html).toContain('No archived test runs');
    expect(html).toContain('Save current run');
    expect(html).not.toContain('Jalankan');
    expect(html).not.toContain('📜');
    expect(html).not.toContain('💾');
  });
});
