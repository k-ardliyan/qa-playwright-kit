/**
 * Save Run & History mutation modals handlers.
 */
export function buildSaveHistoryModalJs(): string {
  return `
  (function () {
    function openSaveModal() {
      var modal = document.getElementById('save-run-modal');
      var backdrop = document.getElementById('save-modal-backdrop');
      if (!modal) return;
      modal.hidden = false;
      modal.removeAttribute('hidden');
      modal.classList.add('modal--open');
      if (backdrop) {
        backdrop.hidden = false;
        backdrop.removeAttribute('hidden');
      }
    }

    function closeSaveModal() {
      var modal = document.getElementById('save-run-modal');
      var backdrop = document.getElementById('save-modal-backdrop');
      if (!modal) return;
      modal.hidden = true;
      modal.setAttribute('hidden', '');
      modal.classList.remove('modal--open');
      if (backdrop) {
        backdrop.hidden = true;
        backdrop.setAttribute('hidden', '');
      }
    }

    function openEditModal(runId) {
      var modal = document.getElementById('edit-run-modal');
      var backdrop = document.getElementById('edit-modal-backdrop');
      if (!modal) return;
      modal.dataset.runId = runId;
      var idDisplay = document.getElementById('edit-modal-run-id');
      if (idDisplay) idDisplay.textContent = runId;
      modal.hidden = false;
      modal.removeAttribute('hidden');
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
      modal.hidden = false;
      modal.removeAttribute('hidden');
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
  })();
  `;
}
