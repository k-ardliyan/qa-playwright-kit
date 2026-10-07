import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { buildDashboardHtml } from '../build-dashboard-html';
import { getDashboardStyles, STYLE_FILES } from '../renderer/render-assets';
import { DashboardPage } from '../pages/dashboard/DashboardPage';
import { buildDashboardOverview } from '../domain/dashboard-overview';
import {
  allPassedSummary,
  allPassedTests,
  attachmentsSummary,
  attachmentsTests,
  edgeCasesSummary,
  edgeCasesTests,
  emptySummary,
  emptyTests,
  failureSummary,
  failureTests,
  longContentSummary,
  longContentTests,
  missingAttachmentsSummary,
  missingAttachmentsTests,
  mixedResultsSummary,
  mixedResultsTests,
  multiRoleSummary,
  multiRoleTests,
  notImplementedSummary,
  notImplementedTests,
  skippedSummary,
  skippedTests,
} from './fixtures';

const STYLES_DIR = path.resolve(__dirname, '../styles');

const FIXTURES = [
  { name: 'all-passed', summary: allPassedSummary, tests: allPassedTests },
  { name: 'failures', summary: failureSummary, tests: failureTests },
  { name: 'mixed-results', summary: mixedResultsSummary, tests: mixedResultsTests },
  { name: 'skipped', summary: skippedSummary, tests: skippedTests },
  { name: 'not-implemented', summary: notImplementedSummary, tests: notImplementedTests },
  { name: 'attachments', summary: attachmentsSummary, tests: attachmentsTests },
  {
    name: 'missing-attachments',
    summary: missingAttachmentsSummary,
    tests: missingAttachmentsTests,
  },
  { name: 'long-content', summary: longContentSummary, tests: longContentTests },
  { name: 'multi-role', summary: multiRoleSummary, tests: multiRoleTests },
  { name: 'empty', summary: emptySummary, tests: emptyTests },
  { name: 'edge-cases', summary: edgeCasesSummary, tests: edgeCasesTests },
];

function extractClassNames(html: string): Set<string> {
  const classes = new Set<string>();
  // Strip <script> tags to avoid false matches from JS string templates
  const htmlNoScripts = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
  const classRegex = /class=["']([^"']+)["']/g;
  let match;
  while ((match = classRegex.exec(htmlNoScripts)) !== null) {
    const names = match[1].split(/\s+/).filter(Boolean);
    for (const name of names) {
      classes.add(name);
    }
  }
  return classes;
}

function extractCssClassSelectors(css: string): Set<string> {
  const selectors = new Set<string>();
  // Match .class-name selectors, stripping pseudo-classes / pseudo-elements
  const regex = /\.([a-zA-Z0-9_-]+)/g;
  let match;
  while ((match = regex.exec(css)) !== null) {
    selectors.add(match[1]);
  }
  return selectors;
}

test.describe('Custom Dashboard Style Contract', () => {
  test('all 8 CSS modular files exist and are non-empty', () => {
    for (const file of STYLE_FILES) {
      const filePath = path.join(STYLES_DIR, file);
      expect(fs.existsSync(filePath)).toBe(true);
      const content = fs.readFileSync(filePath, 'utf-8');
      expect(content.trim().length).toBeGreaterThan(0);
    }
  });

  test('getDashboardStyles returns concatenated stylesheet with tokens', () => {
    const styles = getDashboardStyles();
    expect(styles).toContain(':root');
    expect(styles).toMatch(/html\[data-theme=['"]dark['"]\]/);
    expect(styles).toContain('--bg');
    expect(styles).toContain('--surface');
    expect(styles).toContain('--text');
    expect(styles).toContain('.page-shell');
    expect(styles).toContain('.qa-report-table');
    expect(styles).toContain('.test-card');
    expect(styles).toContain('.status-pill');
    expect(styles).toContain('--z-bar');
    expect(styles).toContain('--z-modal');
    expect(styles).toContain('.filter-empty');
    expect(styles).toContain('.scope-tag');
    expect(styles).toContain('[data-scroll-hint]');
    expect(styles).toContain('focus-visible');
    expect(styles).toContain('--on-accent');
    for (const selector of [
      '.hero__mark-x',
      '.page-section--bleed',
      '.panel--elevated',
      '.card--elevated',
      '.btn-primary-action',
      '.btn-secondary-action',
      '.btn-cancel',
      '.btn-dismiss',
      '.badge--ci',
      '.archived-badge',
      '.unarchived-badge',
      '.modal-input',
      '.modal-select',
      '.modal-textarea',
      '.filter-empty__title',
      '.filter-empty__copy',
      '.portfolio-line',
      '.dashboard-grid-layout',
      '.health-grid-layout',
      '.deep-links--row',
      '.deep-link__title',
      '.deep-link__copy',
      '.deep-link__path',
      '.deep-links__hint',
      '.info-strip',
      '.stat-grid',
      '.kpi-card',
      '.dropdown-item',
      '.top-action-bar',
    ]) {
      expect(styles, `${selector} is dead CSS`).not.toContain(selector);
    }
    expect(styles).toContain('.stat-card');
    expect(styles).toContain('.command-bar');
    expect(styles).not.toContain('125, 211, 252');
    expect(styles).not.toContain('#0a1929');
    expect(styles).not.toContain('#ffb3c9');
  });

  test('Missing Style Detector: every rendered HTML class exists in CSS stylesheet', () => {
    const css = getDashboardStyles();
    const definedClasses = extractCssClassSelectors(css);

    // Some dynamic/runtime classes added by client script or external libs
    const KNOWN_EXEMPTIONS = new Set([
      'test-file-test', // Legacy data hook
      'test-file-details-row', // Legacy hook
      'test-file-test-outcome-passed',
      'test-file-test-outcome-failed',
      'test-file-test-outcome-skipped',
      'test-file-test-outcome-timedOut',
      'test-file-test-outcome-interrupted',
      'test-error-text',
      'flex-1',
      'icon-doc',
      'icon-layers',
      'icon-calendar',
      'icon-clock',
      'icon-heart',
      'icon-list',
      'icon-check',
      'icon-x',
      'icon-skip',
      'icon-chart',
      'icon-pin',
      'icon-search',
      'icon-warn',
      'icon-download',
      'icon-table',
      'icon-sun',
      'icon-moon',
    ]);

    for (const fixture of FIXTURES) {
      const localHtml = buildDashboardHtml('local', fixture.summary, fixture.tests);
      const ciHtml = buildDashboardHtml('ci', fixture.summary, fixture.tests);

      for (const html of [localHtml, ciHtml]) {
        const renderedClasses = extractClassNames(html);

        for (const cls of renderedClasses) {
          if (KNOWN_EXEMPTIONS.has(cls)) continue;
          if (cls.startsWith('test-file-test-outcome-')) continue;
          if (cls.startsWith('icon-')) continue;

          expect(
            definedClasses.has(cls),
            `Rendered class "${cls}" in fixture "${fixture.name}" is missing from CSS rules!`,
          ).toBe(true);
        }
      }
    }
  });

  test('overview page classes are contracted too (Kenapa belum jalan panel included)', () => {
    // The Missing Style Detector above only renders the REPORT page — the
    // overview (DashboardPage) has its own panels, so it gets its own pass.
    // The not-implemented fixture activates the why-not panel on purpose.
    const css = getDashboardStyles();
    const definedClasses = extractCssClassSelectors(css);
    const overview = buildDashboardOverview({
      latestSummary: notImplementedSummary as unknown as Record<string, unknown>,
      history: [],
    });
    const html = String(DashboardPage({ overview, serveMode: false }));

    const renderedClasses = extractClassNames(html);
    for (const cls of renderedClasses) {
      if (cls.startsWith('icon-')) continue;
      if (cls.startsWith('test-file-test-outcome-')) continue;
      if (cls === 'test-file-test' || cls === 'test-file-details-row') continue;
      if (cls === 'flex-1') continue;
      // Pure JS/anchor hook — never styled, and that is fine.
      if (cls === 'dashboard-overview-page') continue;
      // Legacy marker classes shipped without CSS (styled via .panel alone).
      if (cls === 'health-panel' || cls === 'flaky-panel') continue;
      expect(definedClasses.has(cls), `Overview class "${cls}" is missing from CSS!`).toBe(true);
    }

    // The panel must actually render with its data — not silently null.
    expect(html).toContain('why-not-panel');
    expect(html).toContain('Kenapa belum jalan');
  });

  // Regression guard: the chip stack must be a CHILD element, not the <td>
  // itself. A `display: flex` on the <td> drops table-cell semantics; the
  // browser then wraps it in an anonymous cell whose border-bottom spans only
  // the content box, rendering a short stray rule under the last chip instead
  // of the full row separator. That shipped once — this locks it out.
  test('chip stacks live in a child element, never on the table cell', () => {
    const css = getDashboardStyles();
    // No rule may put a flex/grid display directly on the module/feature cell.
    expect(css).not.toMatch(/\.tbl-(?:module|feature)\s*\{[^}]*display\s*:\s*(?:flex|grid)/);
    // The stack class carries the layout instead.
    expect(css).toMatch(/\.tbl-chip-stack\s*\{[^}]*display\s*:\s*flex/);

    for (const fixture of FIXTURES) {
      const html = buildDashboardHtml('local', fixture.summary, fixture.tests);
      // Every rendered module cell wraps its chips in the stack div.
      const moduleCells = html.match(/<td class="tbl-module"[^>]*>[\s\S]*?<\/td>/g) ?? [];
      for (const cell of moduleCells) {
        expect(cell).toContain('class="tbl-chip-stack"');
      }
    }
  });

  // Regression guard: the latest-run strip once held 4 metric cells with a 5th
  // appended conditionally, so it wrapped onto a second row and re-flowed
  // between runs (and the desktop grid stayed 4-wide even with the 5th present).
  // The strip is now a permanent five-cell row.
  test('the metric strip is a fixed five-cell row and the 5th cell is permanent', () => {
    const css = getDashboardStyles();
    expect(css).toMatch(
      /\.latest-run-card__metrics\s*\{[^}]*grid-template-columns:\s*repeat\(5,\s*minmax\(0,\s*1fr\)\)/,
    );

    // Five metric boxes render even on an all-passed run (0 unbuilt is a
    // baseline QA must see, not a hidden cell).
    const allPassedOverview = buildDashboardOverview({
      latestSummary: allPassedSummary as unknown as Record<string, unknown>,
      history: [],
    });
    const allPassedHtml = String(DashboardPage({ overview: allPassedOverview, serveMode: false }));
    const metricCells = allPassedHtml.match(/class="metric-box[ "]/g) ?? [];
    expect(metricCells.length).toBe(5);
    expect(allPassedHtml).toContain('Belum dibangun');

    // The unbuilt cell carries the construction mark, not the pencil: a pencil
    // reads as "editable", which the status is not.
    expect(allPassedHtml).toContain('icon-hammer');
    const statusCell = allPassedHtml.match(
      /class="metric-box metric-box--not-implemented"[\s\S]*?<\/div>/,
    );
    expect(statusCell?.[0]).toContain('icon-hammer');
    expect(statusCell?.[0]).not.toContain('icon-square-pen');
  });

  test('not-implemented rendering uses the hammer, never the pencil', () => {
    const html = buildDashboardHtml('local', notImplementedSummary, notImplementedTests);
    // The status pill in the table renders the hammer geometry.
    expect(html).toContain('icon-hammer');
    // Each pill block: non-greedy up to the FIRST closing span of the label —
    // the icon span closes first, so bound the match at the pill's own end.
    const pills =
      html.match(
        /class="status-pill status-pill--full status-pill--not-implemented"[\s\S]*?<span>Belum dibangun<\/span>/g,
      ) ?? [];
    expect(pills.length).toBeGreaterThan(0);
    for (const pill of pills) {
      expect(pill).toContain('icon-hammer');
      expect(pill).not.toContain('icon-square-pen');
    }
  });

  // Regression guard: the step number and its text were separate flex children,
  // so the text dropped to line 2 whenever it could not fit beside the number,
  // orphaning "1." on its own line (the "habis nomor langsung ke enter" report).
  // No CSS property keeps a list marker with its text across browsers, so the
  // fix is structural: one grid item per step, marker in its own track.
  test('a step keeps its number attached — grid item, not two flex children', () => {
    const css = getDashboardStyles();
    expect(css).toMatch(
      /\.steps-flat__item\s*\{[^}]*display:\s*grid[^}]*grid-template-columns:\s*auto\s+minmax\(0,\s*1fr\)/,
    );
    // The marker must not be a wrapping flex child any more. Strip comments
    // first: the rule's own doc-comment mentions "flex-wrap", which would
    // otherwise trip a content assertion on prose.
    const cssNoComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
    const itemBlock = cssNoComments.match(/\.steps-flat__item\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(itemBlock).not.toContain('flex-wrap');
    expect(itemBlock).not.toContain('display: flex');

    const html = buildDashboardHtml('local', failureSummary, failureTests);
    // Each step is ONE grid item holding the marker + the text body. The marker
    // sits in its own track (CSS above), so the body wraps under it instead of
    // pushing the number onto a line of its own.
    const items = html.match(/class="steps-flat__item"[\s\S]*?<\/div>/g) ?? [];
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      expect(item).toContain('class="steps-flat__n"');
      expect(item).toContain('class="steps-flat__txt"');
      // The text body must be its own element (wraps under the marker), and the
      // subtitle badge must live INSIDE it — never as a third grid child that
      // would take a track of its own.
      const body = item.match(/class="steps-flat__txt"[\s\S]*$/) ?? [''];
      expect(body[0]).toContain(item.includes('step-subtitle-badge') ? 'step-subtitle-badge' : '');
    }
  });

  // Regression guard: the live-page Copy/TSV export omitted MODULE and FEATURE,
  // so it silently dropped two columns the on-screen table and the server-side
  // export both show. The client ORDER must match the 13-column contract.
  test('the client export covers the same columns as the on-screen table', () => {
    const { buildDashboardHtml: build } = require('../build-dashboard-html') as {
      buildDashboardHtml: typeof import('../build-dashboard-html').buildDashboardHtml;
    };
    const html = build('local', failureSummary, failureTests);
    const order = html.match(/var ORDER = MODE === 'role-aware'[\s\S]*?\];/);
    expect(order?.[0]).toBeTruthy();
    expect(order?.[0]).toContain("'module'");
    expect(order?.[0]).toContain("'feature'");
    // And the value readers exist for them, or the columns would export blank.
    expect(html).toContain("key === 'module'");
    expect(html).toContain("key === 'feature'");
    expect(html).toContain("module: 'MODULE'");
    expect(html).toContain("feature: 'FEATURE'");
  });
});
