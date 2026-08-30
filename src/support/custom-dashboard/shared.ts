import path from 'node:path';
import { getDashboardStyles } from './styles';
import type { CollectedAttachment, CollectedStep, CollectedTestData, TestSummary } from './types';

export const REPORT_DIR = path.resolve(process.cwd(), 'reports');
export function toReportRelativePath(absolutePath: string): string {
  return path.relative(REPORT_DIR, absolutePath).replace(/\\/g, '/');
}

export function escapeHtml(raw: string): string {
  return String(raw ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Serialize a value for embedding inside an inline <script> block safely.
 * JSON.stringify does NOT escape '<', so a string containing '</script>' would
 * terminate the script tag and allow HTML/JS injection. Replacing '<' (and
 * '>'/'&' for symmetry) with unicode escapes makes the payload inert while
 * JSON.parse still round-trips it correctly.
 */
export function jsonForScript(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026');
}

export function renderTraceLinkFromAttachments(attachments: CollectedAttachment[]): string {
  const trace = attachments.find((attachment) => attachment.kind === 'trace');
  if (!trace) {
    return '<span class="muted">No trace</span>';
  }

  return `<a class="btn btn--ghost" href="${escapeHtml(trace.relativePath)}" target="_blank" rel="noopener">View trace</a>`;
}

export function formatDisplayTime(raw: string): string {
  try {
    const d = new Date(raw);
    if (isNaN(d.getTime())) return raw;
    const day = d.getDate();
    const months = [
      'Jan',
      'Feb',
      'Mar',
      'Apr',
      'May',
      'Jun',
      'Jul',
      'Aug',
      'Sep',
      'Oct',
      'Nov',
      'Dec',
    ];
    const mon = months[d.getMonth()];
    const yr = d.getFullYear();
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${day} ${mon} ${yr}, ${hh}:${mm}`;
  } catch {
    return raw;
  }
}

function getVerdict(summary: TestSummary): {
  label: string;
  tone: 'healthy' | 'warning' | 'critical';
  summaryLine: string;
} {
  if (summary.failed > 0) {
    return {
      label: 'Run failed',
      tone: 'critical',
      summaryLine: `${summary.failed} unhealthy test${summary.failed === 1 ? '' : 's'} need${summary.failed === 1 ? 's' : ''} triage.`,
    };
  }

  if (summary.skipped > 0) {
    return {
      label: 'Run degraded',
      tone: 'warning',
      summaryLine: `${summary.skipped} skipped test${summary.skipped === 1 ? '' : 's'} reduced coverage.`,
    };
  }

  return {
    label: 'Run healthy',
    tone: 'healthy',
    summaryLine:
      summary.total > 0 ? 'All executed tests passed.' : 'No tests were captured in this run.',
  };
}

export function renderChartScript(summary: TestSummary): string {
  const verdict = getVerdict(summary);

  return `
    <script>
      const chartData = {
        passed: ${summary.passed},
        failed: ${summary.failed},
        skipped: ${summary.skipped},
        passRate: ${summary.passRate},
        label: ${JSON.stringify(verdict.label)}
      };

      function readThemeColor(name, fallback) {
        const root = document.documentElement;
        const value = getComputedStyle(root).getPropertyValue(name).trim();
        return value || fallback;
      }

      const centerTextPlugin = {
        id: 'centerText',
        afterDatasetsDraw(chart) {
          const { ctx } = chart;
          const meta = chart.getDatasetMeta(0);
          if (!meta || !meta.data || !meta.data[0]) return;
          const x = meta.data[0].x;
          const y = meta.data[0].y;

          ctx.save();
          ctx.font = '700 28px Inter, system-ui, sans-serif';
          ctx.fillStyle = readThemeColor('--chart-center-text', '#0f172a');
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(chartData.passRate + '%', x, y - 8);
          ctx.font = '500 11px Inter, system-ui, sans-serif';
          ctx.fillStyle = readThemeColor('--chart-center-subtext', '#64748b');
          ctx.fillText(chartData.label, x, y + 16);
          ctx.restore();
        }
      };

      function buildChart() {
        const canvas = document.getElementById('resultDonut');
        if (!canvas) return;
        if (!(window.Chart)) {
          // Offline / CDN blocked — simple bar fallback
          const wrap = canvas.parentElement;
          if (wrap && !wrap.querySelector('.fallback-bars')) {
            const total = Math.max(1, chartData.passed + chartData.failed + chartData.skipped);
            wrap.innerHTML = '<div class="fallback-bars">'
              + '<div><strong>Passed</strong> ' + chartData.passed + '<div class="bar bar--passed"><span style="--w:' + Math.round(chartData.passed/total*100) + '%"></span></div></div>'
              + '<div><strong>Failed</strong> ' + chartData.failed + '<div class="bar bar--failed"><span style="--w:' + Math.round(chartData.failed/total*100) + '%"></span></div></div>'
              + '<div><strong>Skipped</strong> ' + chartData.skipped + '<div class="bar bar--skipped"><span style="--w:' + Math.round(chartData.skipped/total*100) + '%"></span></div></div>'
              + '</div>';
          }
          return;
        }
        const theme = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
        const palette = {
          light: {
            data: ['#9fc5a8', '#e2b6b0', '#e4c48a'],
            hover: ['#87b694', '#d49f98', '#d4b06e'],
            border: '#fffbf7',
            legend: '#6b5b4f',
          },
          dark: {
            data: ['#7dcea0', '#e8b4b0', '#e0c070'],
            hover: ['#6bb88c', '#d49f9a', '#c9a84e'],
            border: '#221a14',
            legend: '#b9a594',
          },
        }[theme];

        const existing = window.Chart.getChart ? window.Chart.getChart('resultDonut') : null;
        if (existing) existing.destroy();

        new Chart(canvas, {
          type: 'doughnut',
          data: {
            labels: ['Passed', 'Failed', 'Skipped'],
            datasets: [{
              data: [chartData.passed, chartData.failed, chartData.skipped],
              backgroundColor: palette.data,
              hoverBackgroundColor: palette.hover,
              borderColor: palette.border,
              borderWidth: 3
            }]
          },
          options: {
            responsive: true,
            maintainAspectRatio: true,
            cutout: '72%',
            plugins: {
              legend: {
                position: 'bottom',
                labels: {
                  color: palette.legend,
                  padding: 18,
                  usePointStyle: true,
                  pointStyle: 'circle',
                  boxWidth: 8,
                  font: { family: 'Inter, system-ui, sans-serif', size: 12, weight: '600' }
                }
              }
            }
          },
          plugins: [centerTextPlugin]
        });
      }

      buildChart();
      window.__rebuildDashboardChart = buildChart;
    </script>
  `;
}

export function renderThemeScript(): string {
  return `
    <script>
      (function () {
        const STORAGE_KEY = 'dashboard-theme';
        const root = document.documentElement;

        function detectInitial() {
          try {
            const saved = window.localStorage.getItem(STORAGE_KEY);
            if (saved === 'light' || saved === 'dark') return saved;
          } catch (error) {
            // ignore storage access errors
          }
          if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
            return 'dark';
          }
          return 'light';
        }

        function applyTheme(theme) {
          const next = theme === 'dark' ? 'dark' : 'light';
          root.dataset.theme = next;
          document.querySelectorAll('.theme-toggle, #themeToggle, #theme-toggle-btn, [data-theme-toggle]').forEach(function(btn) {
            btn.setAttribute('aria-pressed', next === 'dark' ? 'true' : 'false');
            btn.setAttribute('aria-label', next === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
            btn.setAttribute('title', next === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
            const iconEl = btn.querySelector('.theme-toggle__icon');
            const labelEl = btn.querySelector('.theme-toggle__label');
            if (iconEl) iconEl.textContent = next === 'dark' ? '☾' : '☀';
            if (labelEl) labelEl.textContent = next === 'dark' ? 'Dark' : 'Light';
          });
          try { window.localStorage.setItem(STORAGE_KEY, next); } catch (error) { /* ignore */ }
          if (typeof window.__rebuildDashboardChart === 'function') {
            window.__rebuildDashboardChart();
          }
          window.dispatchEvent(new CustomEvent('dashboard-theme-change', { detail: { theme: next } }));
        }

        applyTheme(detectInitial());

        document.addEventListener('click', function (e) {
          const btn = e.target.closest('.theme-toggle, #themeToggle, #theme-toggle-btn, [data-theme-toggle]');
          if (btn) {
            applyTheme(root.dataset.theme === 'dark' ? 'light' : 'dark');
          }
        });
      })();
    </script>
  `;
}

export function renderDocumentShell(options: {
  pageTitle: string;
  mode: 'local' | 'ci';
  summary: TestSummary;
  collectedTests: CollectedTestData[];
  body: string;
  includeChart?: boolean;
}): string {
  const { pageTitle, summary, body, includeChart } = options;
  const chartScript = includeChart ? renderChartScript(summary) : '';
  const themeScript = renderThemeScript();
  const interactiveScript = renderInteractiveScript();

  return `<!doctype html>
<html lang="en" data-density="dense">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(pageTitle)}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" />
  ${includeChart ? '<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>' : ''}
  <style>${getDashboardStyles()}</style>
</head>
<body>
  <div class="page-shell">
    <div class="page-backdrop" aria-hidden="true"></div>
    <main class="page">
      ${body}
    </main>
  </div>
  ${themeScript}
  ${chartScript}
  ${interactiveScript}
</body>
</html>`;
}

/** View toggle + filter/search + density + keyboard shortcuts. */
export function renderInteractiveScript(): string {
  return `
  <script>
  (function () {
    /* ---- View toggle (Accordion ↔ Table) ---- */
        document.querySelectorAll('.toggle-btn[data-view]').forEach(function (btn) {
          btn.addEventListener('click', function () {
            var view = btn.getAttribute('data-view');
            document.querySelectorAll('.view-panel').forEach(function (panel) {
              var active = panel.id === 'view-' + view;
              panel.classList.toggle('view-panel--active', active);
              panel.classList.toggle('view-panel--hidden', !active);
              panel.setAttribute('aria-hidden', String(!active));
            });
            // Toolbars sit OUTSIDE view panels — toggle by data-toolbar-for
            document.querySelectorAll('[data-toolbar-for]').forEach(function (tb) {
              var forView = tb.getAttribute('data-toolbar-for');
              var show = forView === view;
              tb.hidden = !show;
              tb.setAttribute('aria-hidden', String(!show));
              tb.classList.toggle('view-toolbar--hidden', !show);
            });
            document.querySelectorAll('.toggle-btn[data-view]').forEach(function (b) {
              var isActive = b === btn;
              b.classList.toggle('toggle-btn--active', isActive);
              b.setAttribute('aria-selected', String(isActive));
            });
            // Hide/show command-bar filter tools when switching to/from History tab
            var isHistory = view === 'history';
            var cmdBar = document.getElementById('command-bar');
            if (cmdBar) {
              var tableOnlyEls = cmdBar.querySelectorAll('#btn-export,#btn-columns,#filter-status,#filter-priority,#filter-role,.cmd-search-wrap');
              tableOnlyEls.forEach(function(el) {
                el.style.display = isHistory ? 'none' : '';
              });
            }
            // Recount after view switch
            if (typeof applyFilters === 'function') applyFilters();
            else {
              var evt = new Event('change');
              var statusEl2 = document.getElementById('filter-status');
              if (statusEl2) statusEl2.dispatchEvent(evt);
            }
          });
        });
        // Initial toolbar visibility (table active by default)
                document.querySelectorAll('[data-toolbar-for]').forEach(function (tb) {
                  var forView = tb.getAttribute('data-toolbar-for');
                  var show = forView === 'table';
                  tb.hidden = !show;
                  tb.setAttribute('aria-hidden', String(!show));
                  tb.classList.toggle('view-toolbar--hidden', !show);
                });

    /* ---- Column visibility (Filter columns) ---- */
    // v3: taxonomy added module/feature/source columns — bump key so users with
    // stale v2 localStorage get the new defaults instead of hidden columns.
    var COL_KEY = 'dashboard-columns-v3';
    var LOCKED_COLS = { testId: true, status: true, no: true };
    var DEFAULT_COLS = {
      no: true,
      testId: true,
      module: false,
      feature: false,
      description: true,
      steps: true,
      input: true,
      expected: true,
      actual: true,
      status: true,
      priority: true,
      source: false,
      notes: true
    };
    var colPicker = document.getElementById('column-picker');
    var colBtn = document.getElementById('column-picker-btn');
    var colMenu = document.getElementById('column-picker-menu');

    function loadColState() {
      try {
        var raw = localStorage.getItem(COL_KEY);
        if (!raw) return Object.assign({}, DEFAULT_COLS);
        var parsed = JSON.parse(raw);
        return Object.assign({}, DEFAULT_COLS, parsed, { testId: true, status: true, no: true });
      } catch (e) {
        return Object.assign({}, DEFAULT_COLS);
      }
    }

    function saveColState(state) {
      try { localStorage.setItem(COL_KEY, JSON.stringify(state)); } catch (e) {}
    }

    function applyColumnVisibility(state) {
      document.querySelectorAll('.qa-report-table [data-col]').forEach(function (cell) {
        var key = cell.getAttribute('data-col');
        if (!key) return;
        var visible = state[key] !== false || LOCKED_COLS[key];
        if (visible) {
          cell.removeAttribute('data-col-hidden');
        } else {
          cell.setAttribute('data-col-hidden', '1');
        }
      });
      document.querySelectorAll('[data-col-toggle]').forEach(function (input) {
        var key = input.getAttribute('data-col-toggle');
        if (!key) return;
        input.checked = state[key] !== false;
      });
    }

    function currentColStateFromUI() {
      var state = Object.assign({}, DEFAULT_COLS);
      document.querySelectorAll('[data-col-toggle]').forEach(function (input) {
        var key = input.getAttribute('data-col-toggle');
        if (!key || LOCKED_COLS[key]) return;
        state[key] = !!input.checked;
      });
      state.testId = true;
      state.status = true;
      state.no = true;
      return state;
    }

    var colState = loadColState();
    applyColumnVisibility(colState);

    if (colBtn && colPicker && colMenu) {
      colBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        var open = !colPicker.classList.contains('is-open');
        colPicker.classList.toggle('is-open', open);
        colBtn.setAttribute('aria-expanded', String(open));
        if (open) colMenu.removeAttribute('hidden');
        else colMenu.setAttribute('hidden', '');
      });
      document.addEventListener('click', function (e) {
        if (!colPicker.contains(e.target)) {
          colPicker.classList.remove('is-open');
          colBtn.setAttribute('aria-expanded', 'false');
          colMenu.setAttribute('hidden', '');
        }
      });
      colMenu.addEventListener('click', function (e) { e.stopPropagation(); });
      document.querySelectorAll('[data-col-toggle]').forEach(function (input) {
        input.addEventListener('change', function () {
          colState = currentColStateFromUI();
          applyColumnVisibility(colState);
          saveColState(colState);
        });
      });
      var showAllBtn = document.getElementById('column-picker-show-all');
      var resetBtn = document.getElementById('column-picker-reset');
      if (showAllBtn) {
        showAllBtn.addEventListener('click', function () {
          var allCols = {};
          for (var k in DEFAULT_COLS) {
            allCols[k] = true;
          }
          document.querySelectorAll('[data-col-toggle]').forEach(function (input) {
            var key = input.getAttribute('data-col-toggle');
            if (key) allCols[key] = true;
          });
          colState = allCols;
          applyColumnVisibility(colState);
          saveColState(colState);
        });
      }
      if (resetBtn) {
        resetBtn.addEventListener('click', function () {
          colState = Object.assign({}, DEFAULT_COLS);
          applyColumnVisibility(colState);
          saveColState(colState);
          // Restore sticky pins to default (on)
          var pinH = document.getElementById('pin-sticky-header');
          var pinL = document.getElementById('pin-sticky-left');
          if (pinH) pinH.checked = true;
          if (pinL) pinL.checked = true;
          applyStickyPins();
          saveStickyPins();
        });
      }
    }

          /* ---- Sticky pin toggles (table-only) ---- */
          var STICKY_KEY = 'dashboard-sticky-pins-v1';
          function applyStickyPins() {
            var pinHeader = document.getElementById('pin-sticky-header');
            var pinLeft = document.getElementById('pin-sticky-left');
            var headerOn = !pinHeader || pinHeader.checked;
            var leftOn = !pinLeft || pinLeft.checked;
            document.documentElement.setAttribute('data-sticky-header', headerOn ? 'on' : 'off');
            document.documentElement.setAttribute('data-sticky-left', leftOn ? 'on' : 'off');
          }
          function saveStickyPins() {
            try {
              var pinHeader = document.getElementById('pin-sticky-header');
              var pinLeft = document.getElementById('pin-sticky-left');
              localStorage.setItem(STICKY_KEY, JSON.stringify({
                header: !pinHeader || pinHeader.checked,
                left: !pinLeft || pinLeft.checked
              }));
            } catch (e) {}
          }
          try {
            var savedPins = JSON.parse(localStorage.getItem(STICKY_KEY) || 'null');
            if (savedPins) {
              var pinHeaderEl = document.getElementById('pin-sticky-header');
              var pinLeftEl = document.getElementById('pin-sticky-left');
              if (pinHeaderEl && typeof savedPins.header === 'boolean') pinHeaderEl.checked = savedPins.header;
              if (pinLeftEl && typeof savedPins.left === 'boolean') pinLeftEl.checked = savedPins.left;
            }
          } catch (e) {}
          applyStickyPins();
          document.querySelectorAll('[data-pin-sticky]').forEach(function (input) {
            input.addEventListener('change', function () {
              applyStickyPins();
              saveStickyPins();
            });
          });

          /* ---- Filters ---- */
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
    var emptyResetBtn = document.getElementById('filter-empty-reset');

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
        evidence: !!(evidenceEl && evidenceEl.checked)
      };
    }

    function rowMatches(el, state) {
      var search = el.getAttribute('data-search') || '';
      var status = el.getAttribute('data-status') || '';
      var priority = el.getAttribute('data-priority') || '';
      var role = el.getAttribute('data-role') || '';
      var moduleName = el.getAttribute('data-module') || '';
      var featureName = el.getAttribute('data-feature') || '';

      if (state.q && search.indexOf(state.q) === -1) return false;
      if (state.module && moduleName !== state.module) return false;
      if (state.feature && featureName !== state.feature) return false;

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

      // Count unique tests from active view only (avoid accordion+table double count)
      var activePanel = document.querySelector('.view-panel--active') || document;
      var nodes = activePanel.querySelectorAll('[data-search]');
      // Still apply hide/show to ALL data-search nodes so switching views stays consistent
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

    var searchDebounceTimer = null;
    if (searchEl) {
      searchEl.addEventListener('input', function () {
        clearTimeout(searchDebounceTimer);
        searchDebounceTimer = setTimeout(applyFilters, SEARCH_DEBOUNCE_MS);
      });
    }
    if (emptyResetBtn) {
      emptyResetBtn.addEventListener('click', function () {
        if (searchEl) searchEl.value = '';
        if (statusEl) statusEl.value = '';
        if (priorityEl) priorityEl.value = '';
        if (roleEl) roleEl.value = '';
        if (moduleEl) moduleEl.value = '';
        if (featureEl) featureEl.value = '';
        if (evidenceEl) evidenceEl.checked = false;
        applyFilters();
      });
    }

    try {
      var savedF = JSON.parse(localStorage.getItem(FILTER_KEY) || 'null');
      if (savedF) {
        if (searchEl && savedF.q) searchEl.value = savedF.q;
        if (statusEl && savedF.status) statusEl.value = savedF.status;
        if (priorityEl && savedF.priority) priorityEl.value = savedF.priority;
        if (roleEl && savedF.role) roleEl.value = savedF.role;
        if (evidenceEl) evidenceEl.checked = !!savedF.evidence;
      }
    } catch (e) {}

    ['input','change'].forEach(function (evt) {
      [searchEl, statusEl, priorityEl, roleEl, evidenceEl].forEach(function (el) {
        if (el) el.addEventListener(evt, applyFilters);
      });
    });
    applyFilters();

    document.addEventListener('keydown', function (e) {
      if (e.key === '/' && e.target && e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA' && e.target.tagName !== 'SELECT') {
        e.preventDefault();
        if (searchEl) searchEl.focus();
      }
    });

    /* ---- Copy failure packet ---- */
        document.addEventListener('click', function (e) {
          var btn = e.target && e.target.closest ? e.target.closest('[data-copy-packet]') : null;
          if (!btn) return;
          var packet = btn.getAttribute('data-copy-packet') || '';
          try {
            navigator.clipboard.writeText(packet).then(function () {
              var orig = btn.textContent;
              btn.textContent = 'Copied';
              setTimeout(function () { btn.textContent = orig; }, 1500);
            });
          } catch (err) {
            /* ignore */
          }
        });

        /* ---- Native-like step filter (per test card)
         * Critical: .tree-item { display:flex } overrides UA [hidden].
         * Always toggle class .tree-item--filtered-out + CSS display:none !important.
         */
        function setTreeItemVisible(item, show) {
          if (!item) return;
          if (show) {
            item.hidden = false;
            item.removeAttribute('hidden');
            if (item.style) item.style.display = '';
            item.classList.remove('tree-item--filtered-out');
          } else {
            item.hidden = true;
            item.setAttribute('hidden', '');
            if (item.style) item.style.display = 'none';
            item.classList.add('tree-item--filtered-out');
          }
        }

        function directChildrenRoot(item) {
          if (!item || !item.children) return null;
          var body = null;
          for (var c = 0; c < item.children.length; c++) {
            var ch = item.children[c];
            if (ch.classList && ch.classList.contains('tree-item__body')) {
              body = ch;
              break;
            }
          }
          if (!body) return null;
          for (var k = 0; k < body.children.length; k++) {
            var g = body.children[k];
            if (g.classList && g.classList.contains('tree-item__children')) return g;
          }
          return null;
        }

        function applyStepFilter(input) {
          if (!input || !input.closest) return;
          var panel = input.closest('[data-steps-panel], .steps-panel, .chip-body--steps, .detail-chip');
          if (!panel) return;
          var tree = panel.querySelector('.steps-tree') || panel.querySelector('.tree-item-list');
          if (!tree) return;
          var emptyEl = panel.querySelector('[data-step-filter-empty]');

          var q = String(input.value || '').trim().toLowerCase();
          var items = Array.prototype.slice.call(tree.querySelectorAll('.tree-item'));

          if (!q) {
            items.forEach(function (item) { setTreeItemVisible(item, true); });
            if (emptyEl) {
              emptyEl.hidden = true;
              emptyEl.setAttribute('hidden', '');
            }
            return;
          }

          var selfHits = new Map();
          items.forEach(function (item) {
            var title = (item.getAttribute('data-step-title') || '').toLowerCase();
            if (!title) {
              var labelEl = item.querySelector('.tree-item__label');
              title = labelEl ? String(labelEl.textContent || '').toLowerCase() : '';
            }
            selfHits.set(item, title.indexOf(q) !== -1);
          });

          // Bottom-up: keep parent if any direct child remains visible.
          var visibleCount = 0;
          items.slice().reverse().forEach(function (item) {
            var selfMatch = !!selfHits.get(item);
            var childVisible = false;
            var kidsRoot = directChildrenRoot(item);
            if (kidsRoot) {
              for (var i = 0; i < kidsRoot.children.length; i++) {
                var child = kidsRoot.children[i];
                if (!child.classList || !child.classList.contains('tree-item')) continue;
                if (!child.classList.contains('tree-item--filtered-out')) {
                  childVisible = true;
                  break;
                }
              }
            }
            var show = selfMatch || childVisible;
            setTreeItemVisible(item, show);
            if (show) visibleCount += 1;
            if (show && childVisible && item.tagName === 'DETAILS') item.open = true;
          });

          if (emptyEl) {
            if (visibleCount === 0) {
              emptyEl.hidden = false;
              emptyEl.removeAttribute('hidden');
            } else {
              emptyEl.hidden = true;
              emptyEl.setAttribute('hidden', '');
            }
          }
        }

        function isStepFilterInput(t) {
          return !!(t && t.nodeType === 1 && t.matches && t.matches('[data-step-filter], .step-filter__input'));
        }

        document.addEventListener('input', function (e) {
          if (isStepFilterInput(e.target)) applyStepFilter(e.target);
        });
        // type=search fires "search" on clear (×) in Chromium
        document.addEventListener('search', function (e) {
          if (isStepFilterInput(e.target)) applyStepFilter(e.target);
        });
        document.addEventListener('keyup', function (e) {
          if (isStepFilterInput(e.target)) applyStepFilter(e.target);
        });
        document.addEventListener('submit', function (e) {
          var form = e.target;
          if (form && form.classList && form.classList.contains('step-filter')) {
            e.preventDefault();
          }
        });
      })();
      </script>`;
}

export type { CollectedStep, CollectedTestData, TestSummary };
