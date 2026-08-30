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

    function openEditModal(runId) {
      var modal = document.getElementById('edit-run-modal');
      var backdrop = document.getElementById('edit-modal-backdrop');
      if (!modal) return;
      modal.dataset.runId = runId;
      var idDisplay = document.getElementById('edit-run-id-display') || document.getElementById('edit-modal-run-id');
      if (idDisplay) idDisplay.textContent = runId;
      var idInput = document.getElementById('edit-run-id');
      if (idInput) idInput.value = runId;
      modal.hidden = false;
      modal.removeAttribute('hidden');
      modal.style.display = 'flex';
      document.body.style.overflow = 'hidden';
      if (backdrop) {
        backdrop.hidden = false;
        backdrop.removeAttribute('hidden');
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
    window.openEditModal = openEditModal;
    window.closeEditModal = closeEditModal;
    window.openDeleteModal = openDeleteModal;
    window.closeDeleteModal = closeDeleteModal;
    window.closeConfirmDelete = closeDeleteModal;
  })();
  `;
}
