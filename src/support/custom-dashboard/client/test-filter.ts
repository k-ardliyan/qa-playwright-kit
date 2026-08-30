/**
 * Filter, search, debounce, quick-filter preset, and hash syncing module.
 */
export function buildTestFilterJs(): string {
  return `
  (function () {
    var FILTER_KEY = 'dashboard-filters-v1';
    var SEARCH_DEBOUNCE_MS = 250;
    var searchEl = document.getElementById('dash-search');
    var statusEl = document.getElementById('filter-status');
    var priorityEl = document.getElementById('filter-priority');
    var roleEl = document.getElementById('filter-role');
    var evidenceEl = document.getElementById('filter-evidence');
    var countEl = document.getElementById('filter-count');
    var moduleEl = document.getElementById('module-filter-select');
    var featureEl = document.getElementById('feature-filter-select');
    var emptyEl = document.getElementById('filter-empty');

    var currentQuickFilter = null;

    function readState() {
      var qRaw = searchEl && searchEl.value || '';
      return {
        qRaw: qRaw,
        q: qRaw.trim().toLowerCase(),
        status: statusEl && statusEl.value || '',
        priority: priorityEl && priorityEl.value || '',
        role: roleEl && roleEl.value || '',
        module: moduleEl && moduleEl.value || '',
        feature: featureEl && featureEl.value || '',
        evidence: !!(evidenceEl && evidenceEl.checked),
        quickFilter: currentQuickFilter
      };
    }

    function rowMatches(el, state) {
      var search = el.getAttribute('data-search') || '';
      var status = el.getAttribute('data-status') || '';
      var priority = el.getAttribute('data-priority') || '';
      var role = el.getAttribute('data-role') || '';
      var moduleName = el.getAttribute('data-module') || '';
      var featureName = el.getAttribute('data-feature') || '';
      var duration = parseFloat(el.getAttribute('data-duration') || '0');

      if (state.q && search.indexOf(state.q) === -1) return false;
      if (state.module && moduleName !== state.module) return false;
      if (state.feature && featureName !== state.feature) return false;

      // Quick filter preset handlers
      if (state.quickFilter === 'failed') {
        if (['failed','timedOut','interrupted'].indexOf(status) === -1) return false;
      } else if (state.quickFilter === 'trace') {
        if (el.getAttribute('data-has-trace') !== '1') return false;
      } else if (state.quickFilter === 'screenshot') {
        if (el.getAttribute('data-has-screenshot') !== '1') return false;
      } else if (state.quickFilter === 'video') {
        if (el.getAttribute('data-has-video') !== '1') return false;
      } else if (state.quickFilter === 'slow') {
        if (duration < 5000) return false; // Slow test threshold >= 5s
      } else if (state.quickFilter === 'skipped') {
        if (status !== 'skipped') return false;
      }

      // Explicit select dropdown filters
      if (state.status === 'failed') {
        if (['failed','timedOut','interrupted'].indexOf(status) === -1) return false;
      } else if (state.status && status !== state.status) return false;
      if (state.priority && priority !== state.priority) return false;
      if (state.role && role !== state.role) return false;
      if (state.evidence) {
        if (el.getAttribute('data-has-trace') !== '1'
          && el.getAttribute('data-has-screenshot') !== '1'
          && el.getAttribute('data-has-video') !== '1') return false;
      }
      return true;
    }

    function syncUrlHash(state) {
      try {
        var p = new URLSearchParams();
        if (state.qRaw) p.set('q', state.qRaw);
        if (state.status) p.set('status', state.status);
        if (state.priority) p.set('priority', state.priority);
        if (state.role) p.set('role', state.role);
        if (state.module) p.set('module', state.module);
        if (state.feature) p.set('feature', state.feature);
        if (state.evidence) p.set('evidence', '1');
        if (state.quickFilter) p.set('filter', state.quickFilter);
        var qs = p.toString();
        var targetHash = qs ? '#/?' + qs : '#/';
        if (window.location.hash !== targetHash && (!window.location.hash || window.location.hash.indexOf('#/') === 0)) {
          history.replaceState(null, '', targetHash);
        }
      } catch (e) {}
    }

    function applyFilters() {
      var state = readState();
      syncUrlHash(state);

      var activePanel = document.querySelector('.view-panel--active') || document;
      var nodes = activePanel.querySelectorAll('[data-search]');

      document.querySelectorAll('[data-search]').forEach(function (el) {
        var ok = rowMatches(el, state);
        if (ok) {
          el.hidden = false;
          el.removeAttribute('hidden');
          if (el.style) el.style.display = '';
        } else {
          el.hidden = true;
          if (el.tagName === 'TR') el.style.display = 'none';
        }
      });

      var shown = 0, total = 0;
      nodes.forEach(function (el) {
        total += 1;
        if (!el.hidden && !(el.style && el.style.display === 'none')) shown += 1;
      });

      document.querySelectorAll('.role-section').forEach(function (section) {
        var any = section.querySelector('[data-search]:not([hidden])');
        section.hidden = !any;
      });
      document.querySelectorAll('.test-group').forEach(function (group) {
        var any = group.querySelector('[data-search]:not([hidden])');
        group.hidden = !any;
      });

      if (countEl) countEl.textContent = 'Showing ' + shown + ' of ' + total;
      if (emptyEl) emptyEl.hidden = shown > 0 || total === 0;

      try { localStorage.setItem(FILTER_KEY, JSON.stringify(state)); } catch (e) {}
      window.__DASHBOARD_FILTER_STATE__ = state;
    }

    window.applyFilters = applyFilters;

    window.applyQuickFilter = function (preset, btnEl) {
      if (currentQuickFilter === preset) {
        currentQuickFilter = null;
        if (btnEl) btnEl.classList.remove('quick-filter-btn--active');
      } else {
        currentQuickFilter = preset;
        document.querySelectorAll('[data-quick-filter]').forEach(function(b) {
          b.classList.toggle('quick-filter-btn--active', b === btnEl);
        });
      }
      applyFilters();
    };

    window.resetDashboardFilters = function () {
      if (searchEl) searchEl.value = '';
      if (statusEl) statusEl.value = '';
      if (priorityEl) priorityEl.value = '';
      if (roleEl) roleEl.value = '';
      if (moduleEl) moduleEl.value = '';
      if (featureEl) featureEl.value = '';
      if (evidenceEl) evidenceEl.checked = false;
      currentQuickFilter = null;
      document.querySelectorAll('[data-quick-filter]').forEach(function(b) {
        b.classList.remove('quick-filter-btn--active');
      });
      applyFilters();
    };

    var searchDebounceTimer = null;
    if (searchEl) {
      searchEl.addEventListener('input', function () {
        clearTimeout(searchDebounceTimer);
        searchDebounceTimer = setTimeout(applyFilters, SEARCH_DEBOUNCE_MS);
      });
    }

    try {
      var savedF = JSON.parse(localStorage.getItem(FILTER_KEY) || 'null');
      if (savedF) {
        if (searchEl && savedF.qRaw) searchEl.value = savedF.qRaw;
        if (statusEl && savedF.status) statusEl.value = savedF.status;
        if (priorityEl && savedF.priority) priorityEl.value = savedF.priority;
        if (roleEl && savedF.role) roleEl.value = savedF.role;
        if (moduleEl && savedF.module) moduleEl.value = savedF.module;
        if (featureEl && savedF.feature) featureEl.value = savedF.feature;
        if (evidenceEl) evidenceEl.checked = !!savedF.evidence;
        if (savedF.quickFilter) {
          currentQuickFilter = savedF.quickFilter;
          var activeBtn = document.querySelector('[data-quick-filter="' + savedF.quickFilter + '"]');
          if (activeBtn) activeBtn.classList.add('quick-filter-btn--active');
        }
      }
    } catch (e) {}

    ['change'].forEach(function (evt) {
      [statusEl, priorityEl, roleEl, evidenceEl, moduleEl, featureEl].forEach(function (el) {
        if (el) el.addEventListener(evt, applyFilters);
      });
    });

    applyFilters();

    // Keyboard shortcut '/' to search
    document.addEventListener('keydown', function (e) {
      if (e.key === '/' && e.target && e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA' && e.target.tagName !== 'SELECT') {
        e.preventDefault();
        if (searchEl) searchEl.focus();
      }
    });
  })();
  `;
}
