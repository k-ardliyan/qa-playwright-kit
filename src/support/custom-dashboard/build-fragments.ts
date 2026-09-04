import { buildHistorySection, buildComparisonSection } from './build-history-view';
import type { ReportHistoryEntry } from '../../agents/reporter/report-history';
import type { ReportComparison } from '../../agents/reporter/report-compare';
import { escapeHtml } from './shared';
import type { FailureSource } from './types';
import {
  renderStatusBadge,
  renderPriorityBadge,
  renderFailureSourceCell,
  renderInputDataCell,
  renderLayerBadges,
} from './export-helpers';

/**
 * Lightweight HTML-fragment builders for the hash-routed secondary views
 * (history, compare, detail). Each returns only inner content that the
 * client-side router injects into a shared shell — zero extra deps, and the
 * fragment endpoints reuse the same section builders as the main dashboard.
 *
 * Keeping these as fragments (not full documents) means the client shell owns
 * <head>/styles/theme once, and each route only swaps the <main> content.
 */

export interface ComparePageOptions {
  /** Archived run ids to populate the base/current <select> options. */
  runIds: string[];
  /** Pre-computed comparison (server already ran it). */
  comparison?: ReportComparison | null;
  /** Optional query params echoed for the form. */
  baseline?: string;
  current?: string;
}

export function buildComparePage(options: ComparePageOptions): string {
  const { runIds, comparison, baseline, current } = options;

  // runIds arrive pre-sorted newest-first from listArchivedRunIds().
  // Do NOT re-sort here — string-sort breaks legacy runId format (run-<epoch>).
  const canCompare = runIds.length >= 2;

  // Auto-select defaults: newest = current; baseline = first entry that differs
  // from the current selection (user may have deep-linked to ?current=<older run>).
  const defaultCurrent = current || runIds[0] || '';
  const other = runIds.find((id) => id !== defaultCurrent);
  const defaultBaseline = baseline || other || '';

  const opts = (selected?: string) =>
    runIds
      .map(
        (id) =>
          `<option value="${escapeHtml(id)}" ${id === selected ? 'selected' : ''}>${escapeHtml(id)}</option>`,
      )
      .join('');

  return `
    <section class="frag-page" id="frag-compare">
      <div class="frag-head">
        <h2>Compare Runs</h2>
        <p class="muted">Pick two archived runs to diff pass rates, fixes, and regressions.</p>
      </div>

      ${
        !canCompare
          ? `<p class="muted">Need at least 2 archived runs to compare. Save a run first via the History tab.</p>`
          : `<form class="compare-form" data-compare-form>
        <label>
          Baseline (earlier)
          <select name="baseline" class="cmd-select" required>${opts(defaultBaseline)}</select>
        </label>
        <label>
          Current (later)
          <select name="current" class="cmd-select" required>${opts(defaultCurrent)}</select>
        </label>
        <button class="btn-save-primary" type="submit">Compare</button>
      </form>`
      }

      <div id="compare-result">
        ${
          comparison
            ? buildComparisonSection(comparison)
            : canCompare
              ? '<p class="muted">Select two runs and press Compare.</p>'
              : ''
        }
      </div>
    </section>
  `;
}

export function buildHistoryPage(options: {
  history: ReportHistoryEntry[];
  hasLatestRun?: boolean;
  latestRunArchived?: boolean;
  latestRunId?: string;
  serveMode?: boolean;
}): string {
  return `
    <section class="frag-page" id="frag-history">
      ${buildHistorySection(options.history, {
        hasLatestRun: options.hasLatestRun,
        latestRunArchived: options.latestRunArchived,
        latestRunId: options.latestRunId,
        serveMode: options.serveMode,
      })}
    </section>
  `;
}

/** Detail fragment — server-rendered from an archived run. */
export function buildDetailPage(options: {
  runId: string;
  summary?: Record<string, unknown> | null;
  metadata?: {
    displayName?: string;
    testSeriesId?: string;
    requirementId?: string;
    requirementTitle?: string;
    appEnv?: string;
    baseUrl?: string;
    reportMode?: string;
    qaDecision?: string;
    qaNotes?: string;
    savedAt?: string;
    ranAt?: string;
    durationMs?: number;
  } | null;
  scenarios?: Array<{
    testId?: string;
    scenarioId?: string;
    title?: string;
    status?: string;
    role?: string;
    module?: string;
    feature?: string;
    priority?: string;
    duration?: number;
    failureSource?: string;
    errorMessage?: string;
    inputData?: Record<string, string>;
    expectedResult?: string;
    actualResult?: string;
    affectedLayer?: string[];
    attachmentCount?: number;
    hasTrace?: boolean;
    errors?: Array<{ message: string; stack?: string }>;
    steps?: Array<{
      title: string;
      status: string;
      duration: number;
      errorMessage?: string;
      steps?: unknown[];
    }>;
    attachments?: Array<{ name: string; contentType?: string; relativePath: string; kind: string }>;
    fullTitle?: string;
    filePath?: string;
    retry?: number;
  }>;
}): string {
  const { runId, summary, metadata, scenarios } = options;
  const total = (summary?.total as number) ?? 0;
  const passed = (summary?.passed as number) ?? 0;
  const failed = (summary?.failed as number) ?? 0;
  const skipped = (summary?.skipped as number) ?? 0;
  const passRate = (summary?.passRate as number) ?? 0;
  const statusIcon = failed === 0 ? 'Run healthy' : 'Run needs triage';

  const encodeEvidenceUrl = (relativePath: string, archivedRunId: string): string => {
    if (relativePath.startsWith('/')) return relativePath;
    const encoded = relativePath
      .replace(/\\/g, '/')
      .split('/')
      .filter(Boolean)
      .map((segment) => encodeURIComponent(segment))
      .join('/');
    return `/api/archive/${encodeURIComponent(archivedRunId)}/${encoded}`;
  };

  let rowIndex = 0;
  const rows = (scenarios ?? [])
    .map((s) => {
      const status = s.status ?? 'skipped';
      const retry = s.retry ?? 0;
      const fullTitle = s.fullTitle || s.title || '';
      const trace = s.attachments?.find((a) => a.kind === 'trace' && a.relativePath);
      const screenshot = s.attachments?.find((a) => a.kind === 'screenshot' && a.relativePath);
      const idx = rowIndex++;
      const isExpandable = status === 'failed' || (s.errorMessage && s.errorMessage.length > 0);
      const expandBtn = isExpandable
        ? `<button class="detail-expand-btn" type="button" title="Show details" aria-expanded="false" aria-controls="detail-expand-${idx}">▸</button>`
        : '';

      const mainRow = `
        <tr class="tbl-row tbl-row--${status}" data-idx="${idx}" ${isExpandable ? `onclick="toggleDetailRow(${idx})" tabindex="0" role="button" aria-label="Toggle details for ${escapeHtml(s.testId ?? s.title ?? 'test case')}" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();this.click();}" style="cursor:pointer"` : ''}>
          <td class="tbl-test-id col-sticky-0" data-col="testId"><code>${escapeHtml(s.testId ?? '')}</code>${expandBtn}</td>
          <td class="tbl-module" data-col="module"><span class="module-chip">${escapeHtml(s.module ?? 'general')}</span></td>
          <td class="tbl-feature" data-col="feature"><span class="feature-chip">${escapeHtml(s.feature ?? 'general')}</span></td>
          <td class="tbl-description" data-col="description"><span class="tbl-title">${escapeHtml(fullTitle)}</span></td>
          <td class="tbl-status" data-col="status">${renderStatusBadge(status)}</td>
          <td class="tbl-priority" data-col="priority">${renderPriorityBadge(s.priority ?? 'medium')}</td>
          <td class="tbl-source" data-col="source">${renderFailureSourceCell({ status, failureSource: s.failureSource as FailureSource | undefined, errorMessage: s.errorMessage })}</td>
          <td class="tbl-notes" data-col="notes">${s.duration ? s.duration + 'ms' : '—'}${retry > 0 ? ` · retry ×${retry}` : ''}${trace ? ` · <a href="${escapeHtml(encodeEvidenceUrl(trace.relativePath, runId))}" target="_blank" rel="noopener">trace</a>` : ''}${screenshot ? ` · <a href="${escapeHtml(encodeEvidenceUrl(screenshot.relativePath, runId))}" target="_blank" rel="noopener">screenshot</a>` : ''}</td>
        </tr>`;

      if (!isExpandable) return mainRow;

      const inputDataHtml =
        s.inputData && Object.keys(s.inputData).length > 0
          ? renderInputDataCell(s.inputData)
          : '<span class="muted">—</span>';
      const layers = s.affectedLayer?.length
        ? renderLayerBadges(s.affectedLayer)
        : '<span class="muted">—</span>';

      const detailRow = `
        <tr class="detail-expand-row" id="detail-expand-${idx}" style="display:none">
          <td colspan="8">
            <div class="detail-expand-content">
              <div class="detail-expand-grid">
                <div class="detail-expand-block">
                  <h4>Test Details</h4>
                  <p>${escapeHtml(fullTitle)}</p>
                  <p>File: ${escapeHtml(s.filePath || '—')} · Retry: ${retry}</p>
                </div>
                <div class="detail-expand-block">
                  <h4>Input Data</h4>
                  ${inputDataHtml}
                </div>
                <div class="detail-expand-block">
                  <h4>Expected Result</h4>
                  <p>${s.expectedResult ? escapeHtml(s.expectedResult) : '<span class="muted">—</span>'}</p>
                </div>
                <div class="detail-expand-block">
                  <h4>Actual Result</h4>
                  <p>${s.actualResult ? escapeHtml(s.actualResult) : '<span class="muted">—</span>'}</p>
                </div>
                <div class="detail-expand-block">
                  <h4>Affected Layer</h4>
                  <p>${layers}</p>
                </div>
              </div>
              ${s.errors && s.errors.length > 0 ? s.errors.map((error) => `<div class="detail-expand-error"><h4>Error</h4><pre>${escapeHtml([error.message, error.stack].filter(Boolean).join('\n\n'))}</pre></div>`).join('') : ''}
              ${s.errorMessage && (!s.errors || s.errors.length === 0) ? `<div class="detail-expand-error"><h4>Full Error</h4><pre>${escapeHtml(s.errorMessage)}</pre></div>` : ''}
            </div>
          </td>
        </tr>`;

      return mainRow + detailRow;
    })
    .join('');

  return `
    <section class="frag-page" id="frag-detail">
      <div class="frag-head">
        <button class="btn-back" onclick="window.location.hash='#/history'">← Back to History</button>
        <h2>Run Detail: <code>${escapeHtml(runId)}</code> ${statusIcon}</h2>
        <p class="muted">${metadata?.qaDecision ? `Decision: <strong>${escapeHtml(metadata.qaDecision)}</strong>` : 'No QA decision saved'}</p>
      </div>

      <div class="archive-detail__summary" id="detail-summary">
        <div class="compare-stats">
          <span>Total ${total}</span>
          <span>${passed}✅</span>
          <span>${failed}❌</span>
          <span>${skipped}⏭️</span>
          <span>Pass rate <strong>${passRate}%</strong></span>
          ${metadata?.ranAt ? `<span>Ran: <strong><time datetime="${escapeHtml(metadata.ranAt)}" data-iso="${escapeHtml(metadata.ranAt)}">${escapeHtml(metadata.ranAt.replace('T', ' ').replace(/\.\d+Z$/, ' UTC'))}</time></strong></span>` : ''}
          ${metadata?.savedAt ? `<span>Saved: <strong><time datetime="${escapeHtml(metadata.savedAt)}" data-iso="${escapeHtml(metadata.savedAt)}">${escapeHtml(metadata.savedAt.replace('T', ' ').replace(/\.\d+Z$/, ' UTC'))}</time></strong></span>` : ''}
        </div>
      </div>

      ${metadata?.qaNotes ? `<div class="muted">Notes: ${escapeHtml(metadata.qaNotes)}</div>` : ''}

      <div class="table-wrapper" data-scroll-hint="Scroll horizontally to view all columns">
        <table class="qa-report-table data-table detail-table">
          <caption class="sr-only">Archived run test details</caption>
          <thead>
            <tr>
              <th scope="col" class="col-sticky-0" data-col="testId">TEST ID</th>
              <th scope="col" data-col="module">MODULE</th>
              <th scope="col" data-col="feature">FEATURE</th>
              <th scope="col" data-col="description">DESCRIPTION</th>
              <th scope="col" data-col="status">STATUS</th>
              <th scope="col" data-col="priority">PRIORITY</th>
              <th scope="col" data-col="source">SOURCE</th>
              <th scope="col" data-col="notes">DURATION</th>
            </tr>
          </thead>
          <tbody>${rows || '<tr><td colspan="8" class="muted">No test cases recorded for this run.</td></tr>'}</tbody>
        </table>
      </div>
    </section>
  `;
}
