/**
 * Save Run & History mutation modals handlers.
 */
export function buildSaveHistoryModalJs(): string {
  return `
  (function () {
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

      modal.hidden = false;
      modal.removeAttribute('hidden');
      modal.style.display = 'flex';
      modal.classList.add('modal--open');
      document.body.style.overflow = 'hidden';
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
      modal.hidden = true;
      modal.setAttribute('hidden', '');
      modal.style.display = 'none';
      modal.classList.remove('modal--open');
      document.body.style.overflow = '';
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
        alert('Please select a QA Decision');
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
              if (fe) fe.innerHTML = 'Saved! Run ID: <code>' + d.runId + '</code>';
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
              if (fe) fe.textContent = d.error || 'Save failed';
              if (btn) {
                btn.textContent = 'Save to History';
                btn.disabled = false;
              }
            }
          })
          .catch(function (e) {
            if (fe) fe.textContent = e.message;
            if (btn) {
              btn.textContent = 'Save to History';
              btn.disabled = false;
            }
          });
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
        feedback.style.display = 'none';
      }

      modal.hidden = false;
      modal.removeAttribute('hidden');
      modal.style.display = 'flex';
      document.body.style.overflow = 'hidden';
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
      modal.hidden = true;
      modal.setAttribute('hidden', '');
      modal.style.display = 'none';
      document.body.style.overflow = '';
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
      modal.hidden = false;
      modal.removeAttribute('hidden');
      modal.style.display = 'flex';
      document.body.style.overflow = 'hidden';
      if (backdrop) {
        backdrop.hidden = false;
        backdrop.removeAttribute('hidden');
      }
    }

    function closeDeleteModal() {
      var modal = document.getElementById('confirm-delete-modal');
      var backdrop = document.getElementById('delete-modal-backdrop');
      if (!modal) return;
      modal.hidden = true;
      modal.setAttribute('hidden', '');
      modal.style.display = 'none';
      document.body.style.overflow = '';
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
  })();
  `;
}
