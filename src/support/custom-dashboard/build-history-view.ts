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
        ? `alert('Compare requires the dashboard server. Run npm run dashboard.')`
        : `window.location.hash='#/compare?current='+encodeURIComponent(${runIdFromRow})`;
      return `
        <tr class="history-row" data-run-id="${escapeHtml(entry.runId)}" onclick="${viewAction}">
          <td class="history-status"><span class="status-indicator ${statusClass}" title="${statusLabel}"></span></td>
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
        <thead>
          <tr>
            <th></th>
            <th>Run ID</th>
            <th>Saved</th>
            <th>Env</th>
            <th>Pass Rate</th>
            <th>Tests</th>
            <th>Decision</th>
            <th>Notes</th>
            <th>Actions</th>
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
    <div class="modal-overlay" id="save-modal" hidden style="display:none" onclick="if(event.target===this){ closeSaveModal && closeSaveModal(); }">
      <div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="modal-save-title">
        <div class="modal-head">
          <div class="modal-title-wrap">
            <span class="modal-icon-badge" aria-hidden="true"></span>
            <h3 id="modal-save-title">Save Run to History</h3>
          </div>
          <button type="button" class="btn-close" onclick="closeSaveModal && closeSaveModal()" aria-label="Close">✕</button>
        </div>
        <div class="modal-body">
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
          <div id="save-feedback" class="save-feedback"></div>
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
    <div class="modal-overlay" id="confirm-delete-modal" hidden style="display:none" onclick="if(event.target===this){ closeConfirmDelete && closeConfirmDelete(); }">
      <div class="modal-card modal-card--danger" role="dialog" aria-modal="true" aria-labelledby="modal-delete-title">
        <div class="modal-head">
          <div class="modal-title-wrap">
            <span class="modal-icon-badge modal-icon-badge--danger" aria-hidden="true"></span>
            <h3 id="modal-delete-title">Confirm Archive Deletion</h3>
          </div>
          <button type="button" class="btn-close" onclick="closeConfirmDelete && closeConfirmDelete()" aria-label="Close">✕</button>
        </div>
        <div class="modal-body">
          <p>Are you sure you want to permanently delete this archived run?</p>
          <p class="modal-delete-target text-danger" id="confirm-delete-target"></p>
          <p class="modal-delete-warning muted">
            This action removes the saved summary and metadata. This cannot be undone.
          </p>
        </div>
        <div class="modal-foot">
          <button type="button" class="btn-secondary" onclick="closeConfirmDelete && closeConfirmDelete()">Cancel</button>
          <button type="button" class="btn-danger" id="btn-confirm-delete-execute" onclick="confirmDeleteExecute && confirmDeleteExecute()">Delete permanently</button>
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
        <thead>
          <tr>
            <th></th>
            <th>ID</th>
            <th>Name</th>
            <th>Role</th>
            <th>Module</th>
            <th>Before</th>
            <th>After</th>
            <th>Error</th>
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
    '// Clipboard helper',
    'function copyToClipboard(t,el){',
    '  navigator.clipboard.writeText(t).then(function(){',
    '    if(el){el.textContent="\u2705 Copied!";setTimeout(function(){el.textContent="";},2000);}',
    '  }).catch(function(){',
    '    var ta=document.createElement("textarea");',
    '    ta.value=t;ta.style.position="fixed";ta.style.opacity="0";',
    '    document.body.appendChild(ta);ta.select();',
    '    try{',
    '      document.execCommand("copy");',
    '      if(el){el.textContent="\u2705 Copied!";setTimeout(function(){el.textContent="";},2000);}',
    '    }catch(e){if(el)el.textContent="\u26a0\ufe0f Copy failed";}',
    '    document.body.removeChild(ta);',
    '  });',
    '}',
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
    'function refreshCurrentView(){',
    '  if(typeof window.__loadFragment__!=="function"||typeof window.__showFragment__!=="function"){return;}',
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
    '}',
    '',
    '// Save modal',
    'function openSaveModal(){',
    '  var m=document.getElementById("save-modal")||document.getElementById("save-run-modal");if(m){m.hidden=false;m.removeAttribute("hidden");m.style.display="flex";document.body.style.overflow="hidden";}',
    '  var p=document.getElementById("save-preview");',
    '  if(p)p.innerHTML=window.__SERVE_MODE__',
    '    ?`<span class="muted">Fill in details and click Save.</span>`',
    '    :`<code>npm run archive:save</code>`;',
    '  var fb=document.getElementById("save-feedback");if(fb)fb.textContent="";',
    '}',
    'function closeSaveModal(){',
    '  var m=document.getElementById("save-modal")||document.getElementById("save-run-modal");',
    '  if(m){m.hidden=true;m.setAttribute("hidden","");m.style.display="none";document.body.style.overflow="";}',
    '  var btn=document.getElementById("btn-save-confirm");',
    '  if(btn){btn.textContent="Save to History";btn.disabled=false;}',
    '  var fb=document.getElementById("save-feedback");if(fb)fb.textContent="";',
    '}',
    'function dismissSaveBanner(){["save-banner","save-banner-history"].forEach(function(id){var b=document.getElementById(id);if(b)b.style.display="none";});}',
    '',
    'function confirmSave(){',
    '  var le=document.getElementById("save-label");',
    '  var se=document.getElementById("save-series");',
    '  var de=document.getElementById("save-decision");',
    '  var ne=document.getElementById("save-notes");',
    '  var fe=document.getElementById("save-feedback");',
    '  var label=le?le.value.trim():"";',
    '  var series=se?se.value.trim():"";',
    '  var decision=de?de.value:"";',
    '  var notes=ne?ne.value.trim():"";',
    '  if(!decision){alert("Please select a QA Decision");return;}',
    '  if(window.__SERVE_MODE__){',
    '    var btn=document.getElementById("btn-save-confirm");',
    '    if(btn){btn.textContent="Saving\u2026";btn.disabled=true;}',
    '    fetch("/api/archive/save",{method:"POST",headers:{"Content-Type":"application/json"},',
    '      body:JSON.stringify({label:label,series:series,decision:decision,notes:notes})})',
    '      .then(function(r){return r.json();})',
    '      .then(function(d){',
    '        if(d.ok){',
    '          if(fe)fe.innerHTML="Saved! Run ID: <code>"+d.runId+"</code>";',
    '          setTimeout(function(){',
    '            closeSaveModal();',
    '            dismissSaveBanner();',
    '            if(location.pathname==="/history"||location.pathname==="/dashboard"||location.pathname==="/"||location.pathname==="/latest"){',
    '              location.reload();',
    '            }',
    '          },1000);',
    '        }else{',
    '          if(fe)fe.textContent=(d.error||"Save failed");',
    '          if(btn){btn.textContent="Save to History";btn.disabled=false;}',
    '        }',
    '      })',
    '      .catch(function(e){',
    '        if(fe)fe.textContent=e.message;',
    '        if(btn){btn.textContent="Save to History";btn.disabled=false;}',
    '      });',
    '  }else{',
    '    var Q=String.fromCharCode(34);',
    '    var B=String.fromCharCode(92);',
    '    var sn=notes.split(Q).join(B+Q);',
    '    var sl=label.split(Q).join(B+Q);',
    '    var ss=series.split(Q).join(B+Q);',
    '    var cmd=`npm run archive:save -- --decision=`+decision+(label?` --label=`+Q+sl+Q:``)+(series?` --series=`+Q+ss+Q:``)+(notes?` --notes=`+Q+sn+Q:``)+` --yes`;',
    '    copyToClipboard(cmd,fe);',
    '    if(fe)fe.innerHTML="Command copied! Paste in your terminal:<br><code>"+cmd+"</code>";',
    '  }',
    '}',
    '',
    '// Archive detail view',
    'function showArchiveDetail(runId){',
    '  if(window.__SERVE_MODE__){',
    '    window.location.hash = "#/detail/" + encodeURIComponent(runId);',
    '    return;',
    '  }',
    '  // Static (file://) mode: full detail view is only available in serve mode.',
    '  alert("Detail view requires the dashboard server.\\n\\nRun: npm run dashboard");',
    '}',
    'function escapeHtml(s){',
    '  return String(s==null?"":s).replace(/[&<>"\']/g,function(c){',
    '    return {"&":"&amp;","<":"&lt;",">":"&gt;","\\"":"&quot;","\'":"&#39;"}[c];',
    '  });',
    '}',
    '',
    '// Delete archive — uses confirm modal instead of browser confirm()',
    'var _pendingDeleteRunId="";',
    'function deleteArchive(runId){',
    '  _pendingDeleteRunId=runId;',
    '  var el=document.getElementById("confirm-delete-target");',
    '  if(el)el.textContent="Archive: "+runId;',
    '  var m=document.getElementById("confirm-delete-modal");',
    '  if(m){m.hidden=false;m.removeAttribute("hidden");m.style.display="flex";document.body.style.overflow="hidden";}',
    '}',
    'function closeConfirmDelete(){',
    '  _pendingDeleteRunId="";',
    '  var m=document.getElementById("confirm-delete-modal");',
    '  if(m){m.hidden=true;m.setAttribute("hidden","");m.style.display="none";document.body.style.overflow="";}',
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
    '          alert("Delete failed: "+(d.error||"unknown"));',
    '        }',
    '      })',
    '      .catch(function(e){alert("Network error: "+e.message);});',
    '  }else{',
    '    var cmd="npm run archive:delete -- --run="+runId+" --yes";',
    '    copyToClipboard(cmd,null);',
    '    alert("Delete command copied!\\n\\nPaste in your terminal:\\n"+cmd);',
    '  }',
    '}',
    'document.addEventListener("keydown", function(e){',
    '  if(e.key === "Escape" || e.key === "Esc"){',
    '    closeSaveModal();',
    '    closeConfirmDelete();',
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
