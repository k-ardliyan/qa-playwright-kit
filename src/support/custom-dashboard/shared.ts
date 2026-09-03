import path from 'node:path';
import { getDashboardStyles } from './styles';
import { buildClientBootstrapJs } from './client';
import type { CollectedAttachment, CollectedStep, CollectedTestData, TestSummary } from './types';

function resolveReportDir(): string {
  const override = process.env['QA_REPORT_DIR'];
  if (override) return path.resolve(override);
  return path.resolve('artifacts', 'reports');
}

export const REPORT_DIR = resolveReportDir();
export function toReportRelativePath(absolutePath: string): string {
  return path.relative(resolveReportDir(), absolutePath).replace(/\\/g, '/');
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
  const clientBootstrap = buildClientBootstrapJs();

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
  ${clientBootstrap}
</body>
</html>`;
}

/** View toggle + filter/search + density + keyboard shortcuts. */
export function renderInteractiveScript(): string {
  return `
  <script>
  (function () {
    /* ---- Column visibility (Filter columns) ---- */
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

    /* ---- Native-like step filter (per test card) ---- */
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
