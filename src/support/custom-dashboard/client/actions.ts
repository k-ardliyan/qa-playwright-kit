/**
 * Single entry-point event delegation for the entire dashboard client.
 */
export function buildActionsJs(): string {
  return `
  document.addEventListener('click', function (e) {
    var el = e.target && e.target.closest ? e.target.closest('[data-action]') : null;
    if (!el) return;

    var action = el.getAttribute('data-action');
    if (!action) return;

    switch (action) {
      case 'open-save-modal':
        e.preventDefault();
        if (typeof window.openSaveModal === 'function') window.openSaveModal();
        break;

      case 'close-save-modal':
        e.preventDefault();
        if (typeof window.closeSaveModal === 'function') window.closeSaveModal();
        break;

      case 'open-edit-modal':
        e.preventDefault();
        var runId = el.getAttribute('data-run-id') || (el.closest('[data-run-id]') && el.closest('[data-run-id]').getAttribute('data-run-id'));
        if (typeof window.openEditModal === 'function') window.openEditModal(runId);
        break;

      case 'close-edit-modal':
        e.preventDefault();
        if (typeof window.closeEditModal === 'function') window.closeEditModal();
        break;

      case 'open-delete-modal':
        e.preventDefault();
        var delRunId = el.getAttribute('data-run-id') || (el.closest('[data-run-id]') && el.closest('[data-run-id]').getAttribute('data-run-id'));
        if (typeof window.openDeleteModal === 'function') window.openDeleteModal(delRunId);
        break;

      case 'close-delete-modal':
        e.preventDefault();
        if (typeof window.closeDeleteModal === 'function') window.closeDeleteModal();
        break;

      case 'copy-failure-packet':
        e.preventDefault();
        var packet = el.getAttribute('data-copy-packet') || '';
        copyTextToClipboard(packet, el, 'Copied');
        break;

      case 'reset-filters':
        e.preventDefault();
        if (typeof window.resetDashboardFilters === 'function') window.resetDashboardFilters();
        break;

      case 'theme-toggle':
        e.preventDefault();
        var root = document.documentElement;
        var nextTheme = root.dataset.theme === 'dark' ? 'light' : 'dark';
        if (typeof window.applyTheme === 'function') window.applyTheme(nextTheme);
        break;
    }
  });

  // Global Escape Key Listener for modal dismissal
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      if (typeof window.closeSaveModal === 'function') window.closeSaveModal();
      if (typeof window.closeEditModal === 'function') window.closeEditModal();
      if (typeof window.closeDeleteModal === 'function') window.closeDeleteModal();
    }
  });
  `;
}
