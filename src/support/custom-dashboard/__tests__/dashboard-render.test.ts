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
  notImplementedTests,
  notImplementedSummary,
} from './fixtures';

test.describe('Custom Dashboard Render Baseline', () => {
  test('renders all-passed dataset in local and CI modes', () => {
    const localHtml = buildLocalHtml(allPassedSummary, allPassedTests);
    expect(localHtml).toContain('<!doctype html>');
    // Mode is carried by the document title, not a badge in the masthead —
    // "LOCAL MODE" beside a local run said nothing a QA did not already know.
    expect(localHtml).toContain('Playwright Custom Dashboard (Local)');
    expect(localHtml).not.toContain('LOCAL MODE');
    expect(localHtml).not.toContain('EXECUTION REPORT');
    expect(localHtml).toContain('SC-01');
    expect(localHtml).toContain('SC-02');
    expect(localHtml).toContain('100%');

    const ciHtml = buildCiHtml(allPassedSummary, allPassedTests);
    expect(ciHtml).toContain('Playwright Custom Dashboard (CI Detailed)');
    expect(ciHtml).not.toContain('CI MODE');
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
    // The static report has no server exports: the alert keeps the client-side
    // copy/download row, and the masthead renders no export menu at all.
    expect(html).toContain('btn-copy-confluence');
    expect(html).not.toContain('summary class="btn-export-sm"');
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
    expect(html).not.toContain('results-footer');
    expect(html).not.toContain('Total 0 results');
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

  test('renders not-implemented distinctly from skipped', () => {
    const html = buildDashboardHtml('local', notImplementedSummary, notImplementedTests);
    // Its own badge class — never the grey skipped chrome.
    expect(html).toContain('status-pill--not-implemented');
    expect(html).toContain('Belum dibangun');
    // The scenarios must actually appear: an earlier bucketing bug dropped any
    // status that matched none of the known groups.
    expect(html).toContain('SC-07');
    expect(html).toContain('SC-08');
  });

  test('explains the two easily-confused statuses in the QA language', () => {
    // Both statuses carry an Indonesian tooltip so a non-coder can tell them
    // apart without reading the AI notes panel.
    const notImpl = buildDashboardHtml('local', notImplementedSummary, notImplementedTests);
    expect(notImpl).toContain('utang kerja, bukan skip');

    const skipped = buildDashboardHtml('local', skippedSummary, skippedTests);
    expect(skipped).toContain('Tidak berlaku untuk otomasi');
  });

  test('surfaces the per-scenario fixme reason, not just the generic tooltip', () => {
    // The annotation reason ("Butuh payroll berjalan sampai status Dibayar…")
    // is what answers QA's "kenapa belum jalan" — the static definition alone
    // never could.
    const html = buildDashboardHtml('local', notImplementedSummary, notImplementedTests);
    expect(html).toContain(
      'Butuh payroll berjalan sampai status Dibayar — prasyarat rantai payroll belum tersedia.',
    );
    // Detail view carries it as a labeled field, not only a hover title.
    expect(html).toContain('Alasan');
  });

  test('the overview counts unbuilt work in its own metric box', () => {
    const withUnbuilt = buildDashboardHtml('local', notImplementedSummary, notImplementedTests);
    expect(withUnbuilt).toContain('metric-box--not-implemented');
    expect(withUnbuilt).toContain('Belum dibangun');

    const allPassed = buildDashboardHtml('local', allPassedSummary, allPassedTests);
    // The stylesheet embeds the class NAME — assert on the rendered ELEMENT,
    // not the substring, or the negative match trips on its own CSS rule.
    expect(allPassed).not.toContain('class="metric-box metric-box--not-implemented"');
  });

  test('a run with only unbuilt scenarios is not reported healthy', () => {
    const html = buildDashboardHtml('local', notImplementedSummary, notImplementedTests);
    expect(html).toContain('Run Belum Lengkap');
    expect(html).not.toContain('Run Healthy');
  });

  test('an unknown status renders honestly, never as the grey skipped chrome', () => {
    // A row whose status is unrecognized (old/hand-edited summary rehydrated in
    // serve mode) must not claim "Skipped" — it says "Tidak diketahui" and
    // carries no tone class.
    const unknownSummary = {
      ...allPassedSummary,
      total: 1,
      passed: 0,
      failed: 0,
      skipped: 0,
    } as typeof allPassedSummary;
    const unknownTests = [
      {
        ...allPassedTests[0]!,
        status: 'weird' as never,
        testId: 'SC-UNKNOWN',
        title: 'Unclassified row',
      },
    ];
    const html = buildDashboardHtml('local', unknownSummary, unknownTests);
    expect(html).toContain('Tidak diketahui');
    expect(html).not.toContain('status-pill--full status-pill--skipped');
  });
});
