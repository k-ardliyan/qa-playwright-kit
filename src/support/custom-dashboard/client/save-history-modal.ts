/**
 * Save Run & History mutation modals handlers.
 */
export function buildSaveHistoryModalJs(): string {
  return `
  (function () {
    var modalState = { element: null, restore: null };
    function focusables(root) {
      return Array.prototype.slice.call(root.querySelectorAll('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'));
    }
    function openAccessibleModal(modal, initialId) {
      if (!modal) return;
      var dialog = modal.querySelector('[role="dialog"]');
      if (dialog) dialog.setAttribute('tabindex', '-1');
      if (modalState.element && modalState.element !== modal) closeAccessibleModal();
      modalState.element = modal;
      modalState.restore = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      modal.hidden = false;
      modal.removeAttribute('hidden');
      modal.style.display = 'flex';
      modal.classList.add('modal--open');
      modal.setAttribute('aria-hidden', 'false');
      document.body.style.overflow = 'hidden';
      var target = (initialId && document.getElementById(initialId)) || focusables(modal)[0] || modal.querySelector('[role="dialog"]');
      if (target instanceof HTMLElement) { if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1'); setTimeout(function () { target.focus(); }, 0); }
    }
    function closeAccessibleModal(modal) {
      var current = modal || modalState.element;
      if (!current) return;
      current.hidden = true;
      current.setAttribute('hidden', '');
      current.style.display = 'none';
      current.classList.remove('modal--open');
      current.setAttribute('aria-hidden', 'true');
      document.body.style.overflow = '';
      var restore = modalState.restore;
      if (modalState.element === current) { modalState.element = null; modalState.restore = null; }
      if (restore && restore.isConnected) setTimeout(function () { restore.focus(); }, 0);
    }
    document.addEventListener('keydown', function (e) {
      var modal = modalState.element;
      if (!modal || modal.hidden) return;
      if (e.key === 'Escape' || e.key === 'Esc') { e.preventDefault(); closeAccessibleModal(modal); return; }
      if (e.key !== 'Tab') return;
      var list = focusables(modal);
      if (!list.length) { e.preventDefault(); return; }
      var first = list[0], last = list[list.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });

    function openSaveModal() {
      var modal = document.getElementById('save-modal') || document.getElementById('save-run-modal');
      var backdrop = document.getElementById('save-modal-backdrop');
      if (!modal) return;

      var labelInput = document.getElementById('save-label');
      var seriesInput = document.getElementById('save-series');

      // In serve mode, fetch latest run info to prefill label & series if fields are empty
      if (window.__SERVE_MODE__ && (!labelInput || !labelInput.value || !seriesInput || !seriesInput.value)) {
        fetch('/api/runs/latest')
          .then(function (r) { return r.json(); })
          .then(function (data) {
            if (data && data.latestRun) {
              if (labelInput && !labelInput.value && data.latestRun.displayName) {
                labelInput.value = data.latestRun.displayName;
              }
              if (seriesInput && !seriesInput.value && data.latestRun.testSeriesId) {
                seriesInput.value = data.latestRun.testSeriesId;
              }
            }
          })
          .catch(function () {});
      }

      openAccessibleModal(modal, 'save-decision');
      if (backdrop) {
        backdrop.hidden = false;
        backdrop.removeAttribute('hidden');
      }
      var p = document.getElementById('save-preview');
      if (p && !p.innerHTML) {
        p.innerHTML = window.__SERVE_MODE__
          ? '<span class="muted">Fill in details and click Save.</span>'
          : '<code>npm run archive:save</code>';
      }
      var fb = document.getElementById('save-feedback');
      if (fb) fb.textContent = '';
    }

    function closeSaveModal() {
      var modal = document.getElementById('save-modal') || document.getElementById('save-run-modal');
      var backdrop = document.getElementById('save-modal-backdrop');
      if (!modal) return;
      closeAccessibleModal(modal);
      if (backdrop) {
        backdrop.hidden = true;
        backdrop.setAttribute('hidden', '');
      }
      var btn = document.getElementById('btn-save-confirm');
      if (btn) {
        btn.textContent = 'Save to History';
        btn.disabled = false;
      }
      var fb = document.getElementById('save-feedback');
      if (fb) fb.textContent = '';
    }

    function confirmSave() {
      var le = document.getElementById('save-label');
      var se = document.getElementById('save-series');
      var de = document.getElementById('save-decision');
      var ne = document.getElementById('save-notes');
      var fe = document.getElementById('save-feedback');
      var label = le ? le.value.trim() : '';
      var series = se ? se.value.trim() : '';
      var decision = de ? de.value : '';
      var notes = ne ? ne.value.trim() : '';

      if (!decision) {
        if (fe) {
          fe.textContent = 'Please select a QA Decision.';
          fe.setAttribute('role', 'alert');
          fe.setAttribute('aria-live', 'assertive');
          fe.style.display = 'block';
        }
        if (de && typeof de.focus === 'function') de.focus();
        return;
      }

      if (window.__SERVE_MODE__) {
        var btn = document.getElementById('btn-save-confirm');
        if (btn) {
          btn.textContent = 'Saving…';
          btn.disabled = true;
        }
        fetch('/api/archive/save', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ label: label, series: series, decision: decision, notes: notes }),
        })
          .then(function (r) { return r.json(); })
          .then(function (d) {
            if (d.ok) {
              if (fe) {
                fe.innerHTML = 'Saved! Run ID: <code>' + d.runId + '</code>';
                fe.setAttribute('role', 'status');
                fe.setAttribute('aria-live', 'polite');
              }
              setTimeout(function () {
                closeSaveModal();
                var banners = document.querySelectorAll('.save-banner-top, #save-banner, #save-banner-history');
                banners.forEach(function (b) { b.style.display = 'none'; });
                var btnHeader = document.querySelector('.btn-save-sm');
                if (btnHeader) btnHeader.style.display = 'none';
                if (location.pathname === '/history' || location.pathname === '/dashboard' || location.pathname === '/' || location.pathname === '/latest') {
                  location.reload();
                }
              }, 1000);
            } else {
              if (fe) {
                fe.textContent = d.error || 'Save failed';
                fe.setAttribute('role', 'alert');
                fe.setAttribute('aria-live', 'assertive');
              }
              if (btn) {
                btn.textContent = 'Save to History';
                btn.disabled = false;
              }
            }
          })
          .catch(function (e) {
            if (fe) {
              fe.textContent = e.message;
              fe.setAttribute('role', 'alert');
              fe.setAttribute('aria-live', 'assertive');
            }
            if (btn) {
              btn.textContent = 'Save to History';
              btn.disabled = false;
            }
          });
      } else {
        var Q = String.fromCharCode(34);
        var B = String.fromCharCode(92);
        var sn = notes.split(Q).join(B + Q);
        var sl = label.split(Q).join(B + Q);
        var ss = series.split(Q).join(B + Q);
        var cmd = 'npm run archive:save -- --decision=' + decision
          + (label ? ' --label=' + Q + sl + Q : '')
          + (series ? ' --series=' + Q + ss + Q : '')
          + (notes ? ' --notes=' + Q + sn + Q : '')
          + ' --yes';
        if (fe) {
          fe.textContent = 'Command copied! Paste in your terminal: ' + cmd;
          fe.setAttribute('role', 'status');
          fe.setAttribute('aria-live', 'polite');
        }
        if (typeof copyTextToClipboard === 'function') copyTextToClipboard(cmd, null, 'Copied');
      }
    }

    function openEditModal(runId) {
      var modal = document.getElementById('edit-run-modal');
      var backdrop = document.getElementById('edit-modal-backdrop');
      if (!modal) return;
      modal.dataset.runId = runId;

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

      var idDisplay = document.getElementById('edit-run-id-display') || document.getElementById('edit-modal-run-id');
      if (idDisplay) idDisplay.textContent = runId;
      var idInput = document.getElementById('edit-run-id');
      if (idInput) idInput.value = runId;

      var nameInput = document.getElementById('edit-display-name');
      if (nameInput) nameInput.value = displayName;
      var seriesInput = document.getElementById('edit-test-series');
      if (seriesInput) seriesInput.value = series;
      var reqInput = document.getElementById('edit-requirement-id');
      if (reqInput) reqInput.value = req;
      var decisionSelect = document.getElementById('edit-qa-decision');
      if (decisionSelect) decisionSelect.value = decision;
      var notesTextarea = document.getElementById('edit-qa-notes');
      if (notesTextarea) notesTextarea.value = notes;
      var feedback = document.getElementById('edit-feedback');
      if (feedback) {
        feedback.textContent = '';
        feedback.setAttribute('role', 'status');
        feedback.setAttribute('aria-live', 'polite');
        feedback.style.display = 'none';
      }

      openAccessibleModal(modal, 'edit-display-name');
      if (backdrop) {
        backdrop.hidden = false;
        backdrop.removeAttribute('hidden');
      }

      if (runId) {
        fetch('/api/archive/' + encodeURIComponent(runId))
          .then(function(r) { return r.json(); })
          .then(function(meta) {
            if (modal.dataset.runId !== runId) return;
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
          .catch(function() {});
      }
    }

    function closeEditModal() {
      var modal = document.getElementById('edit-run-modal');
      var backdrop = document.getElementById('edit-modal-backdrop');
      if (!modal) return;
      closeAccessibleModal(modal);
      if (backdrop) {
        backdrop.hidden = true;
        backdrop.setAttribute('hidden', '');
      }
    }

    function openDeleteModal(runId) {
      var modal = document.getElementById('confirm-delete-modal');
      var backdrop = document.getElementById('delete-modal-backdrop');
      if (!modal) return;
      modal.dataset.runId = runId;
      var el = document.getElementById('confirm-delete-target');
      if (el) el.textContent = 'Archive: ' + runId;
      openAccessibleModal(modal, 'btn-confirm-delete-execute');
      if (backdrop) {
        backdrop.hidden = false;
        backdrop.removeAttribute('hidden');
      }
    }

    function closeDeleteModal() {
      var modal = document.getElementById('confirm-delete-modal');
      var backdrop = document.getElementById('delete-modal-backdrop');
      if (!modal) return;
      closeAccessibleModal(modal);
      if (backdrop) {
        backdrop.hidden = true;
        backdrop.setAttribute('hidden', '');
      }
    }

    window.openSaveModal = openSaveModal;
    window.closeSaveModal = closeSaveModal;
    window.confirmSave = confirmSave;
    window.openEditModal = openEditModal;
    window.closeEditModal = closeEditModal;
    window.openDeleteModal = openDeleteModal;
    window.closeDeleteModal = closeDeleteModal;
    window.closeConfirmDelete = closeDeleteModal;

    // Triage strip: apply a suggested decision to the run. On the latest run
    // it preselects the Save modal; on an archived run it opens the Edit
    // modal (which fetches current metadata itself).
    window.applyTriageDecision = function (decision, isArchived) {
      if (isArchived) {
        var runId = document.getElementById('edit-run-id')?.value || window.__TRIAGE_RUN_ID__ || '';
        if (runId && typeof window.openEditModal === 'function') {
          window.openEditModal(runId);
        }
        var sel = document.getElementById('edit-qa-decision');
        if (sel) sel.value = decision;
        return;
      }
      if (typeof window.openSaveModal === 'function') window.openSaveModal();
      var de = document.getElementById('save-decision');
      if (de) de.value = decision;
    };
  })();
  `;
}

/**
 * Per-test QA note dialog for the NOTES cell and detail views.
 * Serve mode persists via the notes API and patches the row in place;
 * static (file://) mode copies the equivalent `npm run note:set` CLI command.
 */
export function buildQaNotesJs(): string {
  return `
  (function () {
    var sourceBtn = null;

    function modal() { return document.getElementById('qa-note-modal'); }

    window.openQaNoteModal = function (btn) {
      var m = modal();
      if (!m || !btn) return;
      sourceBtn = btn;
      var scenarioId = btn.getAttribute('data-scenario-id') || '';
      var testId = btn.getAttribute('data-test-id') || '';
      var role = btn.getAttribute('data-role') || '';
      var runId = btn.getAttribute('data-run-id') || '';
      var label = btn.getAttribute('data-test-label') || testId || scenarioId || 'test';

      var labelEl = document.getElementById('qa-note-test-label');
      if (labelEl) labelEl.textContent = label;
      var sidInput = document.getElementById('qa-note-scenario-id');
      if (sidInput) sidInput.value = scenarioId;
      var tidInput = document.getElementById('qa-note-test-id');
      if (tidInput) tidInput.value = testId;
      var roleInput = document.getElementById('qa-note-role');
      if (roleInput) roleInput.value = role;
      var runInput = document.getElementById('qa-note-run-id');
      if (runInput) runInput.value = runId;

      var ta = document.getElementById('qa-note-input');
      if (ta) ta.value = btn.getAttribute('data-note') || '';
      var feedback = document.getElementById('qa-note-feedback');
      if (feedback) feedback.textContent = '';
      var save = document.getElementById('btn-qa-note-save');
      if (save) { save.disabled = false; }

      m.hidden = false;
      m.removeAttribute('hidden');
      m.style.display = 'flex';
      m.classList.add('modal--open');
      m.setAttribute('aria-hidden', 'false');
      document.body.style.overflow = 'hidden';
      if (typeof window.__qaModalOpened === 'function') window.__qaModalOpened(m, ta);
    };

    window.closeQaNoteModal = function () {
      var m = modal();
      if (!m) return;
      m.hidden = true;
      m.setAttribute('hidden', '');
      m.style.display = 'none';
      m.classList.remove('modal--open');
      m.setAttribute('aria-hidden', 'true');
      document.body.style.overflow = '';
      if (typeof window.__qaModalClosed === 'function') window.__qaModalClosed(m);
      sourceBtn = null;
    };

    function announce(msg) {
      if (typeof window.__dashboardAnnounce === 'function') window.__dashboardAnnounce(msg);
      var feedback = document.getElementById('qa-note-feedback');
      if (feedback) feedback.textContent = String(msg || '');
    }

    // Reflect the saved note back into the row the dialog was opened from —
    // works for table rows, accordion cards, and archived detail fragments.
    function applyQaNoteToDom(note) {
      if (!sourceBtn) return;
      sourceBtn.setAttribute('data-note', note || '');
      var scope =
        sourceBtn.closest('tr') ||
        sourceBtn.closest('.test-card') ||
        sourceBtn.closest('.detail-expand-content') ||
        document;
      var span = scope.querySelector('.qa-note');
      if (note && !span) {
        var row = document.createElement('div');
        row.className = 'notes-row notes-row--qa';
        span = document.createElement('span');
        span.className = 'qa-note';
        span.title = 'Catatan QA';
        row.appendChild(span);
        var timeRow = scope.querySelector('.notes-row--time');
        (timeRow && timeRow.parentNode || scope).insertBefore(row, timeRow || null);
      }
      if (span) {
        span.textContent = note || '';
        span.style.display = note ? '' : 'none';
      }
    }

    window.saveQaNoteModal = function () {
      var m = modal();
      if (!m) return;
      var ta = document.getElementById('qa-note-input');
      var note = ta ? ta.value : '';
      var scenarioId = (document.getElementById('qa-note-scenario-id') || {}).value || '';
      var testId = (document.getElementById('qa-note-test-id') || {}).value || '';
      var role = (document.getElementById('qa-note-role') || {}).value || '';
      var runId = (document.getElementById('qa-note-run-id') || {}).value || '';
      var save = document.getElementById('btn-qa-note-save');

      if (window.__SERVE_MODE__) {
        if (save) { save.disabled = true; }
        var url = runId
          ? '/api/archive/' + encodeURIComponent(runId) + '/notes'
          : '/api/notes/latest';
        fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            scenarioId: scenarioId,
            testId: testId,
            role: role || undefined,
            qaNotes: note
          })
        })
          .then(function (r) { return r.json(); })
          .then(function (d) {
            if (d.ok) {
              applyQaNoteToDom(note);
              window.closeQaNoteModal();
              announce('Catatan QA tersimpan.');
            } else {
              if (save) { save.disabled = false; }
              announce((d && d.error) || 'Gagal menyimpan catatan.');
            }
          })
          .catch(function (e) {
            if (save) { save.disabled = false; }
            announce('Network error: ' + e.message);
          });
      } else {
        var Q = String.fromCharCode(34);
        var B = String.fromCharCode(92);
        var sn = note.split(Q).join(B + Q);
        var cmd = 'npm run note:set -- '
          + (scenarioId ? '--scenario=' + Q + scenarioId + Q : '--test-id=' + Q + testId + Q)
          + (role ? ' --role=' + Q + role + Q : '')
          + ' --note=' + Q + sn + Q;
        if (typeof copyTextToClipboard === 'function') copyTextToClipboard(cmd, null, 'Copied');
        window.closeQaNoteModal();
        announce('Mode file://: perintah CLI disalin \\u2014 paste di terminal, lalu rebuild report.');
      }
    };
  })();
  `;
}
