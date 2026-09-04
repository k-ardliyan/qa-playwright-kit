import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { buildDashboardHtml } from '../build-dashboard-html';
import { getDashboardStyles, STYLE_FILES } from '../renderer/render-assets';
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
  skippedSummary,
  skippedTests,
} from './fixtures';

const STYLES_DIR = path.resolve(__dirname, '../styles');

const FIXTURES = [
  { name: 'all-passed', summary: allPassedSummary, tests: allPassedTests },
  { name: 'failures', summary: failureSummary, tests: failureTests },
  { name: 'mixed-results', summary: mixedResultsSummary, tests: mixedResultsTests },
  { name: 'skipped', summary: skippedSummary, tests: skippedTests },
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
});
