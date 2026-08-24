/** @jsxImportSource @kitajs/html */
import type { ReportHistoryEntry } from '../../../../agents/reporter/report-history';
import { DashboardDocument } from '../../layouts/DashboardDocument';
import { AppNav } from '../../components/navigation/AppNav';
import { Breadcrumb } from '../../components/navigation/Breadcrumb';
import { HistoryToolbar } from './HistoryToolbar';
import { HistoryRunsTable } from './HistoryRunsTable';
import { TrendChart } from './TrendChart';
import { EditRunModal } from './EditRunModal';
import { SaveRunModal } from './SaveRunModal';
import { ConfirmDeleteModal } from './ConfirmDeleteModal';
import { buildHistoryJs } from '../../build-history-view';

export interface HistoryPageProps {
  history: ReportHistoryEntry[];
  hasLatestRun?: boolean;
  latestRunArchived?: boolean;
  latestRunId?: string;
  serveMode?: boolean;
  defaultLabel?: string;
  defaultSeries?: string;
}

export function HistoryPage({
  history = [],
  hasLatestRun = false,
  latestRunArchived = false,
  latestRunId,
  serveMode = true,
  defaultLabel,
  defaultSeries,
}: HistoryPageProps) {
  const envs = [...new Set(history.map((h) => h.appEnv).filter(Boolean))];
  const decisions = [...new Set(history.map((h) => h.qaDecision).filter(Boolean))];

  const breadcrumbs = [{ label: 'Dashboard', href: '/dashboard' }, { label: 'History' }];

  const safeHistoryJs = buildHistoryJs({ serveMode });

  return (
    <DashboardDocument pageTitle="Report History · QA Playwright Kit" includeChart={false}>
      {serveMode && (
        <AppNav
          activeTab="history"
          hasLatestRun={hasLatestRun}
          latestRunArchived={latestRunArchived}
        />
      )}

      {serveMode && <Breadcrumb items={breadcrumbs} />}

      <section class="page-section history-page" id="history-page">
        <div class="section-header">
          <div>
            <h1 class="section-title">Report History</h1>
            <p class="section-subtitle muted">Browse, search, and manage QA-validated test runs.</p>
          </div>
          <TrendChart history={history} />
        </div>

        <HistoryToolbar totalCount={history.length} environments={envs} decisions={decisions} />

        <HistoryRunsTable history={history} latestRunId={latestRunId} serveMode={serveMode} />
      </section>

      <SaveRunModal defaultLabel={defaultLabel} defaultSeries={defaultSeries} />
      <ConfirmDeleteModal />
      <EditRunModal />

      {safeHistoryJs}
      <script>
        {`
        var _pendingEditRunId = '';

        function openEditModal(runId) {
          _pendingEditRunId = runId;
          var row = document.querySelector('[data-run-id="' + runId + '"]');
          var displayName = row ? (row.getAttribute('data-display-name') || '') : '';
          if (!displayName && row) {
            var nameEl = row.querySelector('.run-display-name');
            displayName = nameEl ? (nameEl.textContent || '').trim() : '';
          }
          var series = row ? (row.getAttribute('data-series') || '') : '';
          var req = row ? (row.getAttribute('data-req') || '') : '';
          var decision = row ? (row.getAttribute('data-decision') || '') : '';
          if (!decision && row) {
            var decEl = row.querySelector('.decision-badge');
            decision = decEl ? (decEl.textContent || '').trim() : '';
          }
          var notes = row ? (row.getAttribute('data-notes') || '') : '';
          if (!notes && row) {
            var notesEl = row.querySelector('.history-notes');
            notes = notesEl ? (notesEl.getAttribute('title') || notesEl.textContent || '').trim() : '';
            if (notes === '—') notes = '';
          }

          var runIdDisplay = document.getElementById('edit-run-id-display');
          var runIdInput = document.getElementById('edit-run-id');
          var nameInput = document.getElementById('edit-display-name');
          var seriesInput = document.getElementById('edit-test-series');
          var reqInput = document.getElementById('edit-requirement-id');
          var decisionSelect = document.getElementById('edit-qa-decision');
          var notesTextarea = document.getElementById('edit-qa-notes');
          var feedback = document.getElementById('edit-feedback');

          if (runIdDisplay) runIdDisplay.textContent = runId;
          if (runIdInput) runIdInput.value = runId;
          if (nameInput) nameInput.value = displayName;
          if (seriesInput) seriesInput.value = series;
          if (reqInput) reqInput.value = req;
          if (decisionSelect) decisionSelect.value = decision;
          if (notesTextarea) notesTextarea.value = notes;
          if (feedback) {
            feedback.textContent = '';
            feedback.style.display = 'none';
          }

          var m = document.getElementById('edit-run-modal');
          if (m) {
            m.hidden = false;
            m.removeAttribute('hidden');
            m.style.display = 'flex';
            document.body.style.overflow = 'hidden';
          }

          // Fetch authoritative metadata from server
          if (runId) {
            fetch('/api/archive/' + encodeURIComponent(runId))
              .then(function(r) { return r.json(); })
              .then(function(meta) {
                if (_pendingEditRunId !== runId) return;
                if (nameInput && meta.displayName !== undefined && meta.displayName !== null) {
                  nameInput.value = meta.displayName;
                }
                if (seriesInput && meta.testSeriesId !== undefined && meta.testSeriesId !== null) {
                  seriesInput.value = meta.testSeriesId;
                }
                if (reqInput && meta.requirementId !== undefined && meta.requirementId !== null) {
                  reqInput.value = meta.requirementId;
                }
                if (decisionSelect && meta.qaDecision) {
                  decisionSelect.value = meta.qaDecision;
                }
                if (notesTextarea && meta.qaNotes !== undefined && meta.qaNotes !== null) {
                  notesTextarea.value = meta.qaNotes;
                }
              })
              .catch(function() { /* Ignore fetch errors and keep DOM-extracted values */ });
          }
        }

        function closeEditModal() {
          _pendingEditRunId = '';
          var m = document.getElementById('edit-run-modal');
          if (m) {
            m.hidden = true;
            m.setAttribute('hidden', '');
            m.style.display = 'none';
            document.body.style.overflow = '';
          }
        }

        function confirmEditExecute() {
          var runId = _pendingEditRunId || (document.getElementById('edit-run-id') ? document.getElementById('edit-run-id').value : '');
          if (!runId) return;

          var displayName = (document.getElementById('edit-display-name')?.value || '').trim();
          var testSeriesId = (document.getElementById('edit-test-series')?.value || '').trim();
          var requirementId = (document.getElementById('edit-requirement-id')?.value || '').trim();
          var qaDecision = document.getElementById('edit-qa-decision')?.value || '';
          var qaNotes = (document.getElementById('edit-qa-notes')?.value || '').trim();
          var feedback = document.getElementById('edit-feedback');
          var btn = document.getElementById('btn-edit-confirm');

          if (!displayName) {
            if (feedback) {
              feedback.textContent = 'Please enter a Run Label.';
              feedback.style.display = 'block';
            }
            return;
          }

          if (btn) btn.disabled = true;

          fetch('/api/archive/' + encodeURIComponent(runId), {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              displayName: displayName,
              testSeriesId: testSeriesId,
              requirementId: requirementId,
              qaDecision: qaDecision,
              qaNotes: qaNotes,
            }),
          })
            .then(function (r) {
              return r.json();
            })
            .then(function (d) {
              if (btn) btn.disabled = false;
              if (d.ok) {
                closeEditModal();
                location.reload();
              } else {
                if (feedback) {
                  feedback.textContent = 'Save failed: ' + (d.error || 'Unknown error');
                  feedback.style.display = 'block';
                }
              }
            })
            .catch(function (e) {
              if (btn) btn.disabled = false;
              if (feedback) {
                feedback.textContent = 'Network error: ' + e.message;
                feedback.style.display = 'block';
              }
            });
        }

        function filterHistory() {
          var query = (document.getElementById('history-search')?.value || '').toLowerCase();
          var env = document.getElementById('filter-history-env')?.value || '';
          var dec = document.getElementById('filter-history-decision')?.value || '';
          var rows = document.querySelectorAll('.history-row');
          var visible = 0;
          rows.forEach(function(row) {
            var text = row.textContent.toLowerCase();
            var rowEnv = row.querySelector('.env-tag')?.textContent || '';
            var rowDec = row.querySelector('.decision-badge')?.textContent || '';
            var matchQuery = !query || text.includes(query);
            var matchEnv = !env || rowEnv === env;
            var matchDec = !dec || rowDec === dec;
            if (matchQuery && matchEnv && matchDec) {
              row.style.display = '';
              visible++;
            } else {
              row.style.display = 'none';
            }
          });
          var countEl = document.getElementById('history-count');
          if (countEl) countEl.textContent = visible + ' archived run' + (visible === 1 ? '' : 's');
        }

        document.addEventListener('keydown', function(e) {
          if (e.key === 'Escape' || e.key === 'Esc') {
            closeEditModal();
          }
          if (e.key === '/' && e.target && e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA' && e.target.tagName !== 'SELECT') {
            e.preventDefault();
            var el = document.getElementById('history-search');
            if (el) el.focus();
          }
        });
        `}
      </script>
    </DashboardDocument>
  );
}
