import path from 'node:path';
import { resolveWorkspaceReportDir } from '../../shared/workspace-paths';
import { getDashboardStyles } from './render-assets';
import { buildClientBootstrapJs } from './client';
import { renderChartScript, renderThemeScript } from './client-scripts';
import { escapeHtml } from './format';
import type { CollectedStep, CollectedTestData, TestSummary } from './report-model';

// Seams split out of this file (formatting + inline client scripts). The
// re-exports keep every existing consumer importing from shared.ts working.
export { escapeHtml, formatDuration, jsonForScript, getVerdict } from './format';
export { renderChartScript, renderThemeScript } from './client-scripts';

function resolveReportDir(): string {
  return resolveWorkspaceReportDir();
}

export const REPORT_DIR = resolveReportDir();
export function toReportRelativePath(absolutePath: string): string {
  return path.relative(resolveReportDir(), absolutePath).replace(/\\/g, '/');
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
  <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@400;500;600;700&display=swap" rel="stylesheet" />
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
    var liveRegion = document.getElementById('dashboard-live-region');
    function announce(message) {
      if (!liveRegion) {
        liveRegion = document.createElement('div');
        liveRegion.id = 'dashboard-live-region';
        liveRegion.className = 'sr-only';
        liveRegion.setAttribute('role', 'status');
        liveRegion.setAttribute('aria-live', 'polite');
        document.body.appendChild(liveRegion);
      }
      liveRegion.textContent = message;
    }

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
