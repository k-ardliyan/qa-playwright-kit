import { test, expect } from '@playwright/test';
import { buildDashboardHtml } from '../build-dashboard-html';
import { buildCiHtml } from '../build-ci-html';
import { buildLocalHtml } from '../build-local-html';
import {
  allPassedTests,
  allPassedSummary,
  failureTests,
  failureSummary,
  mixedResultsTests,
  mixedResultsSummary,
  skippedTests,
  skippedSummary,
  attachmentsTests,
  attachmentsSummary,
  missingAttachmentsTests,
  missingAttachmentsSummary,
  longContentTests,
  longContentSummary,
  multiRoleTests,
  multiRoleSummary,
  emptyTests,
  emptySummary,
  edgeCasesTests,
  edgeCasesSummary,
} from './fixtures';

test.describe('Custom Dashboard Render Baseline', () => {
  test('renders all-passed dataset in local and CI modes', () => {
    const localHtml = buildLocalHtml(allPassedSummary, allPassedTests);
    expect(localHtml).toContain('<!doctype html>');
    expect(localHtml).toContain('LOCAL EXECUTION REPORT');
    expect(localHtml).toContain('SC-01');
    expect(localHtml).toContain('SC-02');
    expect(localHtml).toContain('100%');

    const ciHtml = buildCiHtml(allPassedSummary, allPassedTests);
    expect(ciHtml).toContain('CI EXECUTION REPORT');
    expect(ciHtml).toContain('SC-01');
  });

  test('renders failures dataset with error blocks and badges', () => {
    const html = buildDashboardHtml('local', failureSummary, failureTests);
    expect(html).toContain('SC-03');
    expect(html).toContain('SC-04');
    expect(html).toContain('status-pill--failed');
    expect(html).toContain('Incident queue active');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('403 Forbidden');
    expect(html).toContain('SOURCE');
  });

  test('renders mixed-results dataset with tabs and filters', () => {
    const html = buildDashboardHtml('local', mixedResultsSummary, mixedResultsTests);
    expect(html).toContain('Table');
    expect(html).toContain('Accordion');
    expect(html).toContain('SC-01');
    expect(html).toContain('SC-03');
    expect(html).toContain('SC-05');
  });

  test('renders skipped tests dataset', () => {
    const html = buildDashboardHtml('local', skippedSummary, skippedTests);
    expect(html).toContain('SC-05');
    expect(html).toContain('SC-06');
    expect(html).toContain('status-pill--skipped');
  });

  test('renders attachments with screenshot, video, trace, and other files', () => {
    const html = buildDashboardHtml('local', attachmentsSummary, attachmentsTests);
    expect(html).toContain('balance-sheet-preview.png');
    expect(html).toContain('balance-sheet-export.mp4');
    expect(html).toContain('trace-balance.zip');
    expect(html).toContain('balance-sheet-2026.xlsx');
  });

  test('renders missing attachments gracefully without crashing', () => {
    const html = buildDashboardHtml('local', missingAttachmentsSummary, missingAttachmentsTests);
    expect(html).toContain('SC-08');
    expect(html).toContain('attachment-chip--missing');
  });

  test('safely escapes special HTML characters in long content dataset (XSS prevention)', () => {
    const html = buildDashboardHtml('local', longContentSummary, longContentTests);
    expect(html).not.toContain('<script>alert("xss")</script>');
    expect(html).toContain('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
    expect(html).toContain('SC-VERY-LONG-TEST-IDENTIFIER');
  });

  test('renders multi-role sections for role-aware reports', () => {
    const html = buildDashboardHtml('local', multiRoleSummary, multiRoleTests);
    expect(html).toContain('filter-role');
    expect(html).toContain('filter-scope');
    expect(html).toContain('Has evidence');
    expect(html).toContain('ROLE: FINANCE');
    expect(html).toContain('ROLE: HRD');
    expect(html).toContain('ROLE: SUPER-ADMIN');
    expect(html).toContain('SC-FIN-01');
    expect(html).toContain('SC-HRD-01');
    expect(html).toContain('SC-ADMIN-01');
    expect(html).toContain('GENERAL');
  });

  test('renders empty dataset without throwing', () => {
    const html = buildDashboardHtml('local', emptySummary, emptyTests);
    expect(html).toContain('Total 0 results');
  });

  test('renders accessible table, dialog, and chart contracts', () => {
    const html = buildDashboardHtml('local', failureSummary, failureTests);
    expect(html).toContain('caption class="sr-only"');
    expect(html).toContain('triage evidence');
    expect(html).toContain('<th scope="col"');
    expect(html).toContain('aria-describedby="modal-save-description"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('aria-controls="column-picker-menu"');
  });

  test('renders edge cases with invalid dates and special unicode', () => {
    const html = buildDashboardHtml('local', edgeCasesSummary, edgeCasesTests);
    expect(html).toContain('SC-SPECIAL-SYMBOLS');
    expect(html).toContain('🚀');
  });
});
