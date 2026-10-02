/**
 * Single entry-point event delegation for the entire dashboard client.
 */
export function buildActionsJs(): string {
  return `
  (function () {
    var modalState = { modal: null, trigger: null };
    function modalFocusable(modal) {
      return Array.prototype.slice.call(modal.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'))
        .filter(function (el) { return !el.disabled && el.getAttribute('aria-hidden') !== 'true' && el.offsetParent !== null; });
    }
    window.__qaModalOpened = function (modal, initial) {
      if (!modal) return;
      modalState.modal = modal;
      modal.setAttribute('aria-hidden', 'false');
      modalState.trigger = document.activeElement && typeof document.activeElement.focus === 'function' ? document.activeElement : null;
      setTimeout(function () {
        var target = initial && typeof initial.focus === 'function' ? initial : modalFocusable(modal)[0];
        if (target && typeof target.focus === 'function') target.focus();
      }, 0);
    };
    window.__qaModalClosed = function (modal) {
      if (modalState.modal !== modal) return;
      var trigger = modalState.trigger;
      modal.setAttribute('aria-hidden', 'true');
      modalState.modal = null;
      modalState.trigger = null;
      if (trigger && document.contains(trigger) && typeof trigger.focus === 'function') trigger.focus();
    };
    window.__qaCloseActiveModal = function () {
      var modal = modalState.modal || document.querySelector('.modal-overlay:not([hidden])');
      if (!modal) return;
      if (!modalState.modal) {
        modalState.modal = modal;
        modalState.trigger = document.activeElement;
      }
      var close = modal.id === 'save-modal' || modal.id === 'save-run-modal'
        ? window.closeSaveModal
        : modal.id === 'edit-run-modal'
          ? window.closeEditModal
          : modal.id === 'qa-note-modal'
            ? window.closeQaNoteModal
            : window.closeConfirmDelete || window.closeDeleteModal;
      if (typeof close === 'function') close();
    };
    window.__dashboardAnnounce = function (message) {
      var live = document.getElementById('dashboard-live-region');
      if (!live) {
        live = document.createElement('div');
        live.id = 'dashboard-live-region';
        live.className = 'sr-only';
        live.setAttribute('role', 'status');
        live.setAttribute('aria-live', 'polite');
        document.body.appendChild(live);
      }
      live.textContent = '';
      setTimeout(function () { live.textContent = String(message || ''); }, 20);
    };
    document.addEventListener('keydown', function (e) {
      var modal = modalState.modal;
      if (!modal || modal.hidden) {
        var fallback = document.querySelector('.modal-overlay:not([hidden])');
        if (fallback && (e.key === 'Escape' || e.key === 'Esc')) {
          e.preventDefault();
          window.__qaCloseActiveModal();
        }
        return;
      }
      if (e.key === 'Escape' || e.key === 'Esc') {
        e.preventDefault();
        window.__qaCloseActiveModal();
        return;
      }
      if (e.key !== 'Tab') return;
      var items = modalFocusable(modal);
      if (!items.length) { e.preventDefault(); return; }
      var first = items[0];
      var last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    });

    // One toolbar serves both views, so it is never hidden on view change.
    // (It used to toggle on the data-toolbar-for attribute, which hid the
    // search box and every filter as soon as the user opened the accordion.)
    document.querySelectorAll('[data-toolbar-for]').forEach(function (tb) {
      tb.hidden = false;
      tb.setAttribute('aria-hidden', 'false');
    });

    // Trailing controls are view-specific (column picker vs expand-all): show
    // only the ones that act on the view currently rendered.
    window.__qaSyncViewControls = function (view) {
      document.querySelectorAll('[data-view-only]').forEach(function (el) {
        var match = el.getAttribute('data-view-only') === view;
        el.hidden = !match;
        if (!match) el.setAttribute('aria-hidden', 'true');
        else el.removeAttribute('aria-hidden');
      });
    };
    var initialView = document.querySelector('.view-panel--active');
    window.__qaSyncViewControls(
      initialView && initialView.id === 'view-accordion' ? 'accordion' : 'table',
    );
  })();

  document.addEventListener('click', function (e) {
    var el = e.target && e.target.closest ? e.target.closest('[data-action], .toggle-btn[data-view]') : null;
    if (!el) return;

    var action = el.getAttribute('data-action') || (el.hasAttribute('data-view') ? 'toggle-view' : null);
    if (!action) return;

    switch (action) {
      case 'toggle-view':
        e.preventDefault();
        var targetView = el.getAttribute('data-view');
        if (!targetView) return;
        document.querySelectorAll('.view-panel').forEach(function (panel) {
          var active = panel.id === 'view-' + targetView;
          panel.classList.toggle('view-panel--active', active);
          panel.classList.toggle('view-panel--hidden', !active);
          panel.setAttribute('aria-hidden', String(!active));
        });
        document.querySelectorAll('.toggle-btn[data-view]').forEach(function (b) {
          var isActive = b.getAttribute('data-view') === targetView;
          b.classList.toggle('toggle-btn--active', isActive);
          b.setAttribute('aria-selected', String(isActive));
        });
        document.querySelectorAll('[data-toolbar-for]').forEach(function (tb) {
          // Always visible — one toolbar serves table and accordion alike.
          tb.hidden = false;
          tb.setAttribute('aria-hidden', 'false');
        });
        if (typeof window.__qaSyncViewControls === 'function') window.__qaSyncViewControls(targetView);
        if (typeof window.applyFilters === 'function') window.applyFilters();
        break;

      case 'toggle-all-accordion':
        e.preventDefault();
        var accRoot = document.getElementById('view-accordion');
        if (!accRoot) break;
        var cards = accRoot.querySelectorAll('details.test-card');
        var anyClosed = Array.prototype.some.call(cards, function (c) { return !c.open; });
        Array.prototype.forEach.call(cards, function (c) { c.open = anyClosed; });
        el.setAttribute('aria-expanded', String(anyClosed));
        var accLabel = el.querySelector('span');
        if (accLabel) accLabel.textContent = anyClosed ? 'Collapse all' : 'Expand all';
        break;

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

      case 'edit-qa-note':
        e.preventDefault();
        if (typeof window.openQaNoteModal === 'function') window.openQaNoteModal(el);
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

  `;
}
