/**
 * Dashboard History View — HTML section for browsing archived reports.
 *
 * Features:
 * - History list with QA decision, savedAt, notes columns
 * - Save to History banner + modal (copies CLI command to clipboard)
 * - Archive Detail View (click row → full detail)
 * - Trend sparkline
 * - Compare diff table
 *
 * @module src/support/custom-dashboard/build-history-view
 */

import { escapeHtml } from './shared';
import type { ReportHistoryEntry } from '../../agents/reporter/report-history';
import type { ReportComparison } from '../../agents/reporter/report-compare';

// ─── History Section ─────────────────────────────────────────────────────────

export { buildSaveModal, buildConfirmDeleteModal };

export function buildHistorySection(
  history: ReportHistoryEntry[],
  options?: {
    maxEntries?: number;
    hasLatestRun?: boolean;
    latestRunArchived?: boolean;
    latestRunId?: string;
    serveMode?: boolean;
  },
): string {
  const max = options?.maxEntries ?? 20;
  const entries = history.slice(0, max);

  if (entries.length === 0) {
    return `
      <div class="history-section" id="history-section">
        <div class="history-placeholder panel">
          <div class="history-placeholder__inner">
            <h3 class="history-placeholder__title">No archived test runs</h3>
            <p class="history-placeholder__desc muted">
              Run tests and save results via CLI <code>npm run archive:save</code> or the
              <strong>Save current run</strong> button.
            </p>
            ${
              options?.serveMode
                ? `<div class="history-placeholder__actions">
                    <button type="button" class="btn btn-primary btn-sm" onclick="openSaveModal && openSaveModal()">
                      Save current run
                    </button>
                  </div>`
                : ''
            }
          </div>
        </div>
      </div>
      ${buildConfirmDeleteModal()}`;
  }

  const rows = entries
    .map((entry) => {
      const statusClass =
        entry.status === 'success'
          ? 'status-indicator--passed'
          : entry.status === 'partial'
            ? 'status-indicator--warning'
            : 'status-indicator--failed';
      const statusLabel =
        entry.status === 'success' ? 'Passed' : entry.status === 'partial' ? 'Partial' : 'Failed';
      const passRateClass =
        entry.passRate >= 80 ? 'rate-good' : entry.passRate >= 50 ? 'rate-warn' : 'rate-bad';
      const decisionBadge = entry.qaDecision
        ? `<span class="decision-badge decision-${entry.qaDecision.toLowerCase().replace(/_/g, '-')}">${escapeHtml(entry.qaDecision)}</span>`
        : '<span class="muted">—</span>';
      const savedAtShort = entry.savedAt ? formatTimestampShort(entry.savedAt) : '—';
      const notesShort = entry.qaNotes
        ? entry.qaNotes.length > 60
          ? escapeHtml(entry.qaNotes.slice(0, 60)) + '…'
          : escapeHtml(entry.qaNotes)
        : '—';

      const isStatic = !options?.serveMode;
      const runIdFromRow = "this.closest('[data-run-id]').getAttribute('data-run-id')";
      const viewAction = `showArchiveDetail(${runIdFromRow})`;
      const compareAction = isStatic
        ? `window.__dashboardAnnounce && window.__dashboardAnnounce('Compare requires the dashboard server. Run npm run dashboard.')`
        : `window.location.hash='#/compare?current='+encodeURIComponent(${runIdFromRow})`;
      return `
        <tr class="history-row" data-run-id="${escapeHtml(entry.runId)}" onclick="${viewAction}" role="button" tabindex="0" role="button" aria-label="Open details for ${escapeHtml(entry.displayName || entry.runId)}" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();this.click();}">
          <td class="history-status"><span class="status-indicator ${statusClass}" title="${statusLabel}" aria-label="${statusLabel}"></span></td>
          <td class="history-run-id" title="${escapeHtml(entry.runId)}">${escapeHtml(entry.runId)}${options?.latestRunId && entry.runId === options.latestRunId ? ' <span class="latest-badge">LATEST</span>' : ''}</td>
          <td class="history-date" title="${escapeHtml(entry.savedAt)}">${savedAtShort}</td>
          <td class="history-env">${escapeHtml(entry.appEnv)}</td>
          <td class="history-rate ${passRateClass}">${entry.passRate}%</td>
          <td class="history-tests">${entry.totalTests}</td>
          <td class="history-decision">${decisionBadge}</td>
          <td class="history-notes" title="${escapeHtml(entry.qaNotes || '')}">${notesShort}</td>
          <td class="history-actions" onclick="event.stopPropagation()">
            <button class="btn-sm btn-view" onclick="event.stopPropagation();${viewAction}" title="View details">View</button>
            <button class="btn-sm btn-compare" onclick="event.stopPropagation();${compareAction}" title="${isStatic ? 'Compare requires server mode' : 'Compare with another run'}">Compare</button>
            <button class="btn-sm btn-delete" onclick="event.stopPropagation();deleteArchive(${runIdFromRow})" title="Delete archive">Delete</button>
          </td>
        </tr>`;
    })
    .join('');

  return `
    <div class="history-section" id="history-section">
      <div class="history-toolbar">
        <h3>Report History</h3>
        <span class="muted">${entries.length} saved run(s)</span>
      </div>
      ${entries.length >= 2 ? `<div class="history-trend" id="history-trend">${buildTrendSparkline(entries)}</div>` : ''}
      <table class="history-table data-table">
        <caption class="sr-only">Archived test runs and QA actions</caption>
        <thead>
          <tr>
            <th scope="col"></th>
            <th scope="col">Run ID</th>
            <th scope="col">Saved</th>
            <th scope="col">Env</th>
            <th scope="col">Pass Rate</th>
            <th scope="col">Tests</th>
            <th scope="col">Decision</th>
            <th scope="col">Notes</th>
            <th scope="col">Actions</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
    </div>
    ${buildConfirmDeleteModal()}`;
}

// ─── Save Modal ──────────────────────────────────────────────────────────────

function buildSaveModal(): string {
  return `
    <div class="modal-overlay" id="save-modal" hidden aria-hidden="true" onclick="if(event.target===this){ closeSaveModal && closeSaveModal(); }">
      <div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="modal-save-title" aria-describedby="modal-save-description">
        <div class="modal-head">
          <div class="modal-title-wrap">
            <span class="modal-icon-badge" aria-hidden="true"></span>
            <h3 id="modal-save-title">Save Run to History</h3>
          </div>
          <button type="button" class="btn-close" onclick="closeSaveModal && closeSaveModal()" aria-label="Close">✕</button>
        </div>
        <div class="modal-body">
          <p id="modal-save-description" class="sr-only">Save the current test run with a QA decision and optional notes.</p>
          <div class="form-group">
            <label for="save-decision" class="form-label">QA Exit Decision <span class="required">*</span></label>
            <select id="save-decision" class="cmd-select form-select" required>
              <option value="">— Select —</option>
              <option value="APPROVE">APPROVE (All scenarios passed / ready)</option>
              <option value="FILE_BUG">FILE_BUG (Defect logged in app)</option>
              <option value="REVISE_REQUIREMENT">REVISE_REQUIREMENT (Spec gap)</option>
              <option value="FIX_TEST">FIX_TEST (Flaky test / generator bug)</option>
              <option value="FIX_ENV">FIX_ENV (Auth / Seed data issue)</option>
              <option value="MARK_BLOCKED">MARK_BLOCKED (Execution blocked)</option>
            </select>
          </div>
          <div class="form-group">
            <label for="save-notes" class="form-label">QA Notes &amp; Observations</label>
            <textarea id="save-notes" class="cmd-input form-textarea" rows="3" placeholder="Optional notes about this run..."></textarea>
          </div>
          <div class="save-preview" id="save-preview"></div>
          <div id="save-feedback" class="save-feedback" role="status" aria-live="polite"></div>
        </div>
        <div class="modal-foot">
          <button type="button" class="btn-secondary" onclick="closeSaveModal && closeSaveModal()">Cancel</button>
          <button type="button" id="btn-save-confirm" class="btn-save-primary" onclick="confirmSave && confirmSave()">Save to History</button>
        </div>
      </div>
    </div>`;
}

// ─── Confirm Delete Modal ──────────────────────────────────────────────────

function buildConfirmDeleteModal(): string {
  return `
    <div class="modal-overlay" id="confirm-delete-modal" hidden aria-hidden="true" onclick="if(event.target===this){ closeConfirmDelete && closeConfirmDelete(); }">
      <div class="modal-card modal-card--danger" role="dialog" aria-modal="true" aria-labelledby="modal-delete-title" aria-describedby="modal-delete-description">
        <div class="modal-head">
          <div class="modal-title-wrap">
            <span class="modal-icon-badge modal-icon-badge--danger" aria-hidden="true"></span>
            <h3 id="modal-delete-title">Confirm Archive Deletion</h3>
          </div>
          <button type="button" class="btn-close" onclick="closeConfirmDelete && closeConfirmDelete()" aria-label="Close">✕</button>
        </div>
        <div class="modal-body">
          <p id="modal-delete-description">Are you sure you want to permanently delete this archived run?</p>
          <p class="modal-delete-target text-danger" id="confirm-delete-target"></p>
          <p class="modal-delete-warning muted">
            This action removes the saved summary and metadata. This cannot be undone.
          </p>
        </div>
        <div class="modal-foot">
          <button type="button" class="btn-secondary" onclick="closeConfirmDelete && closeConfirmDelete()">Cancel</button>
          <button type="button" class="btn-danger" id="btn-confirm-delete-execute" aria-describedby="modal-delete-description" onclick="confirmDeleteExecute && confirmDeleteExecute()">Delete permanently</button>
        </div>
      </div>
    </div>`;
}

// ─── Trend Sparkline ─────────────────────────────────────────────────────────

export function buildTrendSparkline(
  entries: ReportHistoryEntry[],
  options?: { width?: number; height?: number },
): string {
  if (entries.length < 2) return '';

  const width = options?.width ?? 300;
  const height = options?.height ?? 40;
  const padding = 4;

  const data = [...entries].reverse();
  const passRates = data.map((e) => e.passRate);
  const maxRate = Math.max(...passRates, 100);
  const minRate = Math.min(...passRates, 0);

  const range = maxRate - minRate || 1;
  const xStep = (width - 2 * padding) / (data.length - 1);

  const points = data
    .map((entry, i) => {
      const x = padding + i * xStep;
      const y = height - padding - ((entry.passRate - minRate) / range) * (height - 2 * padding);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  return `
    <svg class="trend-sparkline" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <polyline fill="none" stroke="var(--accent, #c4956a)" stroke-width="1.5" stroke-linejoin="round" points="${points}" />
      ${data
        .map((entry, i) => {
          const x = padding + i * xStep;
          const y =
            height - padding - ((entry.passRate - minRate) / range) * (height - 2 * padding);
          return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2" fill="var(--accent, #c4956a)" title="${entry.passRate}% — ${formatTimestampShort(entry.savedAt || entry.ranAt)}" />`;
        })
        .join('\n      ')}
    </svg>`;
}

// ─── Comparison Diff ─────────────────────────────────────────────────────────

export function buildComparisonSection(comparison: ReportComparison): string {
  const allScenarios = [
    ...comparison.regressions.map((s) => ({ ...s, change: 'regressed' as const })),
    ...comparison.fixes.map((s) => ({ ...s, change: 'fixed' as const })),
    ...comparison.newScenarios.map((s) => ({ ...s, change: 'new' as const })),
    ...comparison.removedScenarios.map((s) => ({ ...s, change: 'removed' as const })),
    ...comparison.stableFailures.map((s) => ({ ...s, change: 'stable' as const })),
    ...comparison.flakyScenarios.map((s) => ({ ...s, change: 'flaky' as const })),
  ];

  const rows = allScenarios
    .map((s) => {
      const changeLabel =
        s.change === 'regressed'
          ? 'Regression'
          : s.change === 'fixed'
            ? 'Fix'
            : s.change === 'new'
              ? 'New'
              : s.change === 'removed'
                ? 'Removed'
                : s.change === 'stable'
                  ? 'Stable'
                  : 'Flaky';
      return `
        <tr class="diff-row diff-${s.change}">
          <td>${changeLabel}</td>
          <td>${escapeHtml(s.scenarioId)}</td>
          <td>${escapeHtml(s.name)}</td>
          <td>${escapeHtml(s.role ?? '')}</td>
          <td>${escapeHtml(s.module ?? '')}</td>
          <td>${s.previousStatus}</td>
          <td>${s.currentStatus}</td>
          <td>${s.currentError ? escapeHtml(s.currentError.slice(0, 80)) : '—'}</td>
        </tr>`;
    })
    .join('');

  return `
    <div class="comparison-section">
      <div class="comparison-header">
        <h3>Comparison</h3>
        <div class="comparison-stats">
          <span>${comparison.summary.regressed} regressions</span>
          <span>${comparison.summary.fixed} fixes</span>
          <span>${comparison.summary.stableFailures} stable failures</span>
          <span>${comparison.summary.flaky} flaky</span>
          <span>${comparison.summary.new} new</span>
          <span>${comparison.summary.removed} removed</span>
        </div>
      </div>
      <table class="comparison-table data-table">
        <caption class="sr-only">Differences between compared test runs</caption>
        <thead>
          <tr>
            <th scope="col"></th>
            <th scope="col">ID</th>
            <th scope="col">Name</th>
            <th scope="col">Role</th>
            <th scope="col">Module</th>
            <th scope="col">Before</th>
            <th scope="col">After</th>
            <th scope="col">Error</th>
          </tr>
        </thead>
        <tbody>
          ${rows || '<tr><td colspan="8" class="muted">No changes between runs.</td></tr>'}
        </tbody>
      </table>
    </div>`;
}

// ─── Inline JS ───────────────────────────────────────────────────────────────

export function buildHistoryJs(opts?: { serveMode?: boolean }): string {
  const serveMode = opts?.serveMode ?? false;
  const flag = serveMode ? 'true' : 'false';

  // Build inline JS via array join — avoids nested template-literal escape bugs.
  const lines: string[] = [
    '<script>',
    'window.__SERVE_MODE__ = ' + flag + ';',
    '',
    '// Heartbeat + SSE (serve mode only)',
    'if(window.__SERVE_MODE__){',
    '  // Anti-stack: never fire a new heartbeat while one is still in flight.',
    '  var hbBusy=false;',
    '  setInterval(function(){',
    '    if(hbBusy){return;}',
    '    hbBusy=true;',
    '    fetch("/heartbeat",{method:"POST"}).catch(function(){}).then(function(){hbBusy=false;},function(){hbBusy=false;});',
    '  },5000);',
    '  // SSE with bounded reconnect: onerror closes and retries after 5s.',
    '  var sse=null;',
    '  function connectSse(){',
    '    if(sse){try{sse.close();}catch(e){}}',
    '    sse=new EventSource("/events");',
    '    sse.addEventListener("archive-saved",function(){ refreshCurrentView(); });',
    '    sse.addEventListener("archive-deleted",function(){ refreshCurrentView(); });',
    '    sse.addEventListener("archive-updated",function(){ refreshCurrentView(); });',
    '    sse.onerror=function(){',
    '      try{sse.close();}catch(e){}',
    '      sse=null;',
    '      setTimeout(connectSse,5000);',
    '    };',
    '  }',
    '  connectSse();',
    '}',
    '',
    '// Selective view refresh — no full page reload',
    'var refreshTimer=null;',
    'function refreshCurrentView(){',
    '  if(refreshTimer){return;}',
    '  refreshTimer=setTimeout(function(){',
    '    refreshTimer=null;',
    '    if(typeof window.__loadFragment__!=="function"||typeof window.__showFragment__!=="function"){',
    '      if(location.pathname==="/"||location.pathname==="/dashboard"||location.pathname==="/history"||location.pathname==="/latest"||location.pathname==="/compare"||location.pathname.indexOf("/history/")===0){location.reload();}',
    '      return;',
    '    }',
    '  var h=location.hash||"#/";',
    '  if(h.charAt(1)!=="/")h="#/"+h.slice(1);',
    '  h=h.slice(1);',
    '  if(h.indexOf("/history")===0){',
    '    window.__loadFragment__("/fragment/history").then(window.__showFragment__).catch(function(){});',
    '  }else if(h.indexOf("/compare")===0){',
    '    var qi=h.indexOf("?");',
    '    var qs=qi===-1?"":h.slice(qi);',
    '    window.__loadFragment__("/fragment/compare"+qs).then(window.__showFragment__).catch(function(){});',
    '  }else if(h.indexOf("/detail/")===0){',
    '    var id=h.slice("/detail/".length).split(/[?#]/)[0];',
    '    window.__loadFragment__("/fragment/detail/"+encodeURIComponent(id)).then(window.__showFragment__).catch(function(){});',
    '  }',
    '    },100);',
    '}',
    '',
    'function dismissSaveBanner(){["save-banner","save-banner-history"].forEach(function(id){var b=document.getElementById(id);if(b)b.style.display="none";});}',
    '',
    'function announceDashboard(message){',
    '  var live=document.getElementById("dashboard-live-region");',
    '  if(!live){live=document.createElement("div");live.id="dashboard-live-region";live.className="sr-only";live.setAttribute("role","status");live.setAttribute("aria-live","polite");document.body.appendChild(live);}',
    '  live.textContent=String(message||"");',
    '}',
    '// Archive detail view',
    'function showArchiveDetail(runId){',
    '  if(window.__SERVE_MODE__){',
    '    window.location.hash = "#/detail/" + encodeURIComponent(runId);',
    '    return;',
    '  }',
    '  // Static (file://) mode: full detail view is only available in serve mode.',
    '  announceDashboard("Detail view requires the dashboard server. Run npm run dashboard.");',
    '}',
    '// Delete archive — uses confirm modal instead of browser confirm()',
    'var _pendingDeleteRunId="";',
    'function deleteArchive(runId){',
    '  _pendingDeleteRunId=runId;',
    '  var el=document.getElementById("confirm-delete-target");',
    '  if(el)el.textContent="Archive: "+runId;',
    '  var m=document.getElementById("confirm-delete-modal");',
    '  if(m){m.hidden=false;m.removeAttribute("hidden");m.setAttribute("aria-hidden","false");m.style.display="flex";document.body.style.overflow="hidden";if(typeof window.__qaModalOpened==="function"){window.__qaModalOpened(m,document.getElementById("btn-confirm-delete-execute"));}}',
    '}',
    'function closeConfirmDelete(){',
    '  _pendingDeleteRunId="";',
    '  var m=document.getElementById("confirm-delete-modal");',
    '  if(m){m.hidden=true;m.setAttribute("hidden","");m.setAttribute("aria-hidden","true");m.style.display="none";document.body.style.overflow="";if(typeof window.__qaModalClosed==="function"){window.__qaModalClosed(m);}}',
    '}',
    'function confirmDeleteExecute(){',
    '  var runId=_pendingDeleteRunId;',
    '  closeConfirmDelete();',
    '  if(!runId)return;',
    '  if(window.__SERVE_MODE__){',
    '    fetch("/api/archive/"+encodeURIComponent(runId),{method:"DELETE"})',
    '      .then(function(r){return r.json();})',
    '      .then(function(d){',
    '        if(d.ok){',
    "          var row=document.querySelector('[data-run-id=\"'+runId+'\"]');",
    '          if(row)row.remove();',
    '          else location.reload();',
    '        }else{',
    '          announceDashboard("Delete failed: "+(d.error||"unknown"));',
    '        }',
    '      })',
    '      .catch(function(e){announceDashboard("Network error: "+e.message);});',
    '  }else{',
    '    var cmd="npm run archive:delete -- --run="+runId+" --yes";',
    '    copyToClipboard(cmd,null);',
    '    announceDashboard("Delete command copied. Paste it in your terminal.");',
    '  }',
    '}',
    'document.addEventListener("keydown", function(e){',
    '  if(e.key === "Escape" || e.key === "Esc"){',
    '    if(typeof window.__qaCloseActiveModal === "function"){window.__qaCloseActiveModal();}',
    '    closeSaveModal();',
    '    closeConfirmDelete();',
    '    if(typeof closeEditModal === "function"){closeEditModal();}',
    '  }',
    '});',
    '<' + '/script>',
  ];

  return lines.join('\n');
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatTimestampShort(iso: string): string {
  try {
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  } catch {
    return iso;
  }
}
