import { test, expect } from '@playwright/test';
import { renderDocumentShell, jsonForScript } from '../../support/custom-dashboard/shared';
import type { TestSummary } from '../../support/custom-dashboard/types';

const emptySummary: TestSummary = {
  total: 0,
  passed: 0,
  failed: 0,
  skipped: 0,
  passRate: 0,
  timestamp: new Date().toISOString(),
  reportMode: 'general',
  rolesInScope: [],
  runMeta: {
    appEnv: 'local',
    runId: 'run-1',
    ci: false,
    totalDurationMs: 0,
    generatedAt: new Date().toISOString(),
  },
  testCases: [],
};

test.describe('dashboard shell interactive state keys', () => {
  test('column visibility key is v3 (bust stale v2 localStorage)', () => {
    const html = renderDocumentShell({
      pageTitle: 'test',
      mode: 'local',
      summary: emptySummary,
      collectedTests: [],
      body: '',
      includeChart: false,
    });
    expect(html).toContain("var COL_KEY = 'dashboard-columns-v3'");
    // Must NOT still reference v2 (stale state would hide new taxonomy columns).
    expect(html).not.toContain('dashboard-columns-v2');
  });

  test('search input is debounced and filters sync into hash query', () => {
    const html = renderDocumentShell({
      pageTitle: 'test',
      mode: 'local',
      summary: emptySummary,
      collectedTests: [],
      body: '',
      includeChart: false,
    });
    expect(html).toContain('var SEARCH_DEBOUNCE_MS = 250');
    expect(html).toContain("searchEl.addEventListener('input'");
    expect(html).toContain('setTimeout(applyFilters, SEARCH_DEBOUNCE_MS)');
    expect(html).toContain("p.set('q', state.qRaw)");
    expect(html).toContain("p.set('module', state.module)");
    expect(html).toContain("p.set('feature', state.feature)");
    expect(html).toContain("qs ? '#/?' + qs : '#/'");
    expect(html).toContain('history.replaceState');
    expect(html).toContain("getElementById('module-filter-select')");
    expect(html).toContain("getElementById('feature-filter-select')");
    expect(html).toContain('if (state.module && moduleName !== state.module) return false');
    expect(html).toContain('if (state.feature && featureName !== state.feature) return false');
    expect(html).toContain("getElementById('filter-empty')");
    expect(html).toContain("getElementById('filter-empty-reset')");
    expect(html).toContain("getElementById('filter-count')");
  });

  test('jsonForScript keeps embedded JSON parseable with hostile strings', () => {
    const out = jsonForScript({ qaNotes: '</script><script>alert(1)</script>' });
    expect(out).not.toContain('</script>');
    expect(JSON.parse(out)).toEqual({ qaNotes: '</script><script>alert(1)</script>' });
  });

  test('filter hash sync never overwrites deep-link routes (#/compare, #/history, #/detail)', () => {
    const html = renderDocumentShell({
      pageTitle: 'test',
      mode: 'local',
      summary: emptySummary,
      collectedTests: [],
      body: '',
      includeChart: false,
    });
    // The guard bails out BEFORE any replaceState when the current hash is a
    // secondary route — deep links must survive the bootstrap (regression for
    // the dashboard browser suite: #/compare was rewritten to #/ on load).
    expect(html).toContain(
      "if (current && current !== '#' && current.indexOf('#/?') !== 0 && current !== '#/') {",
    );
    expect(html).toContain('return;');
  });
});
