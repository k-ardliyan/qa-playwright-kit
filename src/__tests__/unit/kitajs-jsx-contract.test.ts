import { test, expect } from '@playwright/test';
import { createElement as h } from '@kitajs/html';
import { StatusPill } from '../../support/custom-dashboard/components/shared/StatusPill';
import { Breadcrumb } from '../../support/custom-dashboard/components/navigation/Breadcrumb';
import { AppNav } from '../../support/custom-dashboard/components/navigation/AppNav';
import { Hero } from '../../support/custom-dashboard/components/dashboard/Hero';
import { LatestRunCard } from '../../support/custom-dashboard/pages/dashboard/LatestRunCard';
import { HistoryRunsTable } from '../../support/custom-dashboard/pages/history/HistoryRunsTable';
import { DashboardDocument } from '../../support/custom-dashboard/layouts/DashboardDocument';
import { ActualResultCell } from '../../support/custom-dashboard/components/table/TableCells';
import type { CollectedTestData } from '../../support/custom-dashboard/types';
import type { ReportHistoryEntry } from '../../agents/reporter/report-history';
import type { LatestRunSummary } from '../../support/custom-dashboard/domain/dashboard';

/**
 * @kitajs/html@4.2.13 (runtime, not the README table):
 * - boolean children are omitted (`false` / `true` → '')
 * - number / bigint children are serialized (`0` → `0`)
 * - boolean attributes: true → bare attr, false → omitted
 * - non-void self-closing tags emit a matching close tag (`<script></script>`)
 *
 * `{cond && <el/>}` is safe when `cond` is a boolean.
 * `{count && <el/>}` leaks `0` when count is 0 — use `{count > 0 ? <el/> : null}`.
 */

const archivedCleanRun: LatestRunSummary = {
  runId: 'run-20260820-100000-001',
  displayName: 'Login Regression',
  appEnv: 'staging',
  ranAt: '2026-08-20T10:00:00.000Z',
  passRate: 100,
  totalTests: 10,
  passed: 10,
  failed: 0,
  skipped: 0,
  isArchived: true,
};

const mockHistory: ReportHistoryEntry[] = [
  {
    runId: 'run-20260820-100000-001',
    displayName: 'Login Regression',
    testSeriesId: 'auth-login-regression',
    requirementId: 'REQ-AUTH-001',
    requirementPath: 'requirements/auth/login.md',
    triggerSource: 'dashboard-button',
    ranAt: '2026-08-20T10:00:00.000Z',
    savedAt: '2026-08-20T10:05:00.000Z',
    appEnv: 'staging',
    reportMode: 'role-aware',
    totalTests: 10,
    passed: 10,
    failed: 0,
    skipped: 0,
    passRate: 100,
    status: 'success',
    qaDecision: '',
    qaNotes: '',
  },
];

test.describe('KitaJS runtime contract (@kitajs/html 4.2.13)', () => {
  test('boolean children are omitted, unlike a number 0', () => {
    const withFalse = String(h('div', null, false, h('span', null, 'x')));
    const withTrue = String(h('div', null, true, h('span', null, 'x')));
    const withZero = String(h('div', null, 0, h('span', null, 'x')));
    const withNull = String(h('div', null, null, h('span', null, 'x')));

    expect(withFalse).toBe('<div><span>x</span></div>');
    expect(withTrue).toBe('<div><span>x</span></div>');
    expect(withNull).toBe('<div><span>x</span></div>');
    expect(withZero).toBe('<div>0<span>x</span></div>');
  });

  test('boolean attributes: true is a bare flag, false is omitted', () => {
    const selected = String(h('option', { selected: true, value: 'a' }, 'A'));
    const unselected = String(h('option', { selected: false, value: 'b' }, 'B'));
    expect(selected).toContain(' selected');
    expect(selected).not.toContain('selected="');
    expect(unselected).not.toContain('selected');
  });

  test('non-void self-closing tags still emit a close tag (script is not void)', () => {
    const html = String(
      h('script', { src: 'https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js' }),
    );
    expect(html).toBe(
      '<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>',
    );
    expect(html).not.toMatch(/<script[^>]*\/>/);
  });

  test('attribute values escape double quotes only (single quotes stay raw)', () => {
    const html = String(h('div', { title: 'say "hi" & <x>', 'data-run-id': "run-1'oops" }));
    expect(html).toContain('title="say &#34;hi&#34; & <x>"');
    expect(html).toContain('data-run-id="run-1\'oops"');
  });
});

test.describe('KitaJS dashboard — boolean short-circuit must not leak text', () => {
  test('StatusPill without showIcon does not emit the text "false"', () => {
    const html = String(StatusPill({ status: 'passed' }));
    expect(html).toContain('status-pill--passed');
    expect(html).not.toMatch(/>false</);
  });

  test('Breadcrumb first item has a separator only after the first crumb', () => {
    const html = String(
      Breadcrumb({
        items: [{ label: 'Dashboard', href: '/dashboard' }, { label: 'History' }],
      }),
    );
    expect(html).toContain('breadcrumb__separator');
    expect(html.indexOf('breadcrumb__separator')).toBeGreaterThan(html.indexOf('Dashboard'));
    expect(html).not.toMatch(/>false</);
  });

  test('AppNav no longer carries run actions — they belong to the masthead', () => {
    // Run actions read the LATEST summary server-side, so on History/Compare
    // they would export the wrong run. They live on the report masthead (Hero).
    const html = String(AppNav({ activeTab: 'dashboard' }));
    expect(html).toContain('QA Playwright Kit');
    expect(html).not.toContain('Save Run');
    expect(html).not.toContain('btn-export-sm');
    expect(html).not.toMatch(/>false</);
  });

  test('Hero tone and mark follow the verdict', () => {
    // The mark IS the verdict at a glance: one tonal disc per tone, no
    // overlapping badge. The seed can only ever produce `critical` (it carries
    // a failing run), so the other two tones are pinned here.
    const base = {
      total: 4,
      timestamp: '2026-10-02T00:00:00.000Z',
      reportMode: 'general',
      rolesInScope: [],
      testCases: [],
      runMeta: {
        appEnv: 'dev',
        runId: 'run-1',
        ci: false,
        totalDurationMs: 1000,
        generatedAt: '2026-10-02T00:00:00.000Z',
      },
    };
    const mk = (counts: Record<string, number>) =>
      ({ ...base, ...counts }) as unknown as Parameters<typeof Hero>[0]['summary'];

    const failed = String(
      Hero({
        summary: mk({ passed: 3, failed: 1, skipped: 0, passRate: 75 }),
        collectedTests: [],
      }),
    );
    expect(failed).toContain('hero--critical');
    expect(failed).toContain('icon-circle-x');
    expect(failed).toContain('Run Failed');

    // Skipped-but-nothing-failed is degraded, not failed: a warning mark.
    const degraded = String(
      Hero({
        summary: mk({ passed: 3, failed: 0, skipped: 1, passRate: 75 }),
        collectedTests: [],
      }),
    );
    expect(degraded).toContain('hero--warning');
    expect(degraded).toContain('icon-triangle-alert');
    expect(degraded).toContain('Run Degraded');
    expect(degraded).not.toContain('hero--critical');

    const healthy = String(
      Hero({
        summary: mk({ passed: 4, failed: 0, skipped: 0, passRate: 100 }),
        collectedTests: [],
      }),
    );
    expect(healthy).toContain('hero--healthy');
    expect(healthy).toContain('icon-circle-check');
    expect(healthy).toContain('Run Healthy');
    expect(healthy).not.toContain('hero--warning');
  });

  test('Hero carries the run actions and drops Save once archived', () => {
    const summary = {
      total: 2,
      passed: 1,
      failed: 1,
      skipped: 0,
      passRate: 50,
      timestamp: '2026-09-08T18:41:43.575Z',
      reportMode: 'general',
      rolesInScope: [],
      testCases: [],
      runMeta: {
        appEnv: 'dev',
        runId: 'run-1',
        ci: false,
        totalDurationMs: 4100,
        generatedAt: '2026-09-08T18:41:43.575Z',
      },
    } as unknown as Parameters<typeof Hero>[0]['summary'];

    const live = String(Hero({ summary, collectedTests: [], runActions: true }));
    expect(live).toContain('hero__run-actions');
    // Both exports act on the latest run: the HTML one and the Markdown one.
    expect(live).toContain('/export/portable');
    expect(live).toContain('/export/markdown');
    expect(live).toContain('btn-save-sm');
    expect(live).not.toMatch(/>false</);

    // An archived latest run keeps the exports (still the latest summary) but
    // must not offer Save again.
    const archived = String(
      Hero({ summary, collectedTests: [], runActions: true, isArchived: true }),
    );
    expect(archived).toContain('/export/markdown');
    expect(archived).not.toContain('btn-save-sm');

    // Without runActions (history/compare/static) the block is absent entirely.
    const bare = String(Hero({ summary, collectedTests: [] }));
    expect(bare).not.toContain('hero__run-actions');
    expect(bare).not.toContain('/export/markdown');
  });

  test('LatestRunCard with 0 failed / 0 skipped / archived does not leak a boolean', () => {
    const html = String(LatestRunCard({ latestRun: archivedCleanRun }));
    expect(html).toContain('ARCHIVED');
    expect(html).not.toContain('Save to History');
    expect(html).not.toMatch(/>false</);
  });

  test('HistoryRunsTable empty + static mode omits the Save current run button', () => {
    const html = String(HistoryRunsTable({ history: [], serveMode: false }));
    expect(html).toContain('No archived test runs');
    expect(html).toContain('npm run archive:save');
    expect(html).not.toContain('Jalankan');
    expect(html).not.toContain('📜');
    expect(html).not.toContain('history-placeholder__actions');
    expect(html).not.toMatch(/>false</);
  });

  test('DashboardDocument without chart does not leak false into <head>', () => {
    const html = String(
      DashboardDocument({ pageTitle: 'Contract', includeChart: false, children: 'body-ok' }),
    );
    const head = html.slice(0, html.indexOf('<body>'));
    expect(head).not.toContain('>false<');
    expect(head).not.toContain('chart.js');
    expect(html).toContain('body-ok');
  });

  test('ActualResultCell injects escaped text with real <br> for newlines', () => {
    const testCase = {
      actualResult: 'line1\n<script>alert(1)</script>',
      status: 'failed',
    } as CollectedTestData;
    const html = String(ActualResultCell({ test: testCase }));
    expect(html).toMatch(/<br\s*\/>/);
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>alert(1)</script>');
  });
});

test.describe('KitaJS dashboard — onclick must not interpolate runId into JS strings', () => {
  test('HistoryRunsTable reads runId from data-run-id, even if the id contains quotes', () => {
    const hostile: ReportHistoryEntry = {
      ...mockHistory[0],
      runId: "run-1');alert(1);//",
    };
    const html = String(HistoryRunsTable({ history: [hostile], serveMode: false }));

    expect(html).toContain('data-run-id=');
    expect(html).toContain("this.closest('[data-run-id]').getAttribute('data-run-id')");
    expect(html).not.toContain("showArchiveDetail('run-1");
    expect(html).not.toContain("openEditModal('run-1");
    expect(html).not.toContain("deleteArchive('run-1");
    const onclicks = [...html.matchAll(/onclick="([^"]*)"/g)].map((m) => m[1]);
    expect(onclicks.length).toBeGreaterThan(0);
    for (const handler of onclicks) {
      expect(handler).not.toContain('alert(1)');
      expect(handler).not.toContain("run-1')");
    }
  });

  test('HistoryRunsTable serve-mode view/compare encode the runId at click time, not at render', () => {
    const html = String(HistoryRunsTable({ history: mockHistory, serveMode: true }));
    expect(html).toContain("window.location.href='/history/'+encodeURIComponent(");
    expect(html).toContain("window.location.href='/compare?current='+encodeURIComponent(");
    expect(html).not.toContain("window.location.href='/history/run-20260820-100000-001'");
  });
});
