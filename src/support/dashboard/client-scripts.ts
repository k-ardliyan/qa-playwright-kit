/**
 * Inline <script> blocks emitted into the dashboard HTML: the results donut
 * (renderChartScript) and the theme/bottom-sheet controller (renderThemeScript).
 *
 * Split from shared.ts (client-script seam). The document shell that stitches
 * these into the page and the larger interactive-script block remain in
 * shared.ts. renderChartScript depends on getVerdict/format.ts only for the
 * center label; everything here is a plain string builder.
 *
 * @module support/dashboard/client-scripts
 */

import type { TestSummary } from './report-model';
import { getVerdict } from './format';

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
          // Light is the dashboard default, deliberately NOT following
          // prefers-color-scheme: QA opens this while triaging and the light
          // surfaces are the calibrated baseline. Dark stays one click away and
          // the choice is remembered.
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

        // ------------------------------------------------------------------
        // Bottom sheets (nav + filter toolbar)
        // ------------------------------------------------------------------
        // A modal <dialog> gives focus trapping and Escape for free, but NOT
        // click-outside-to-dismiss: a click on ::backdrop lands on the dialog
        // element itself, so "event.target === dialog" is the reliable signal
        // that the pointer hit the backdrop rather than the sheet contents.
        //
        // The drag follows the conventions a native bottom sheet uses, because
        // a naive "translate by dy, close past 60px" feels broken:
        //   - pointer capture, so the drag survives the pointer leaving the
        //     element and never gets lost mid-gesture;
        //   - the drag starts from the grab HANDLE (or anywhere when the sheet
        //     is not scrolled), so it never fights a scroll of a long list;
        //   - a vertical-intent check, so a horizontal drag is ignored;
        //   - resistance past the top, so it feels like a physical object;
        //   - release decides on VELOCITY as well as distance, so a quick flick
        //     dismisses even when it travelled only a little;
        //   - a spring-back transition when the gesture does not dismiss.
        //
        // This runs after DOMContentLoaded because the theme script is emitted
        // in <head>, where the sheets do not exist yet.
        function wireSheets() {
          var DISMISS_PX = 96;      // distance that always dismisses
          var DISMISS_VELOCITY = 0.5; // px/ms — a flick dismisses from anywhere
          var RESISTANCE = 0.5;     // rubber-band factor past the start
          var SETTLE_MS = 220;

          document.querySelectorAll('dialog.app-nav-sheet, dialog.filter-sheet').forEach(function (sheet) {
            // A backdrop click must be judged on where the gesture STARTED.
            // A drag that begins on the handle and ends on the sheet body
            // produces a synthesized click whose target is the common ancestor
            // — the dialog itself — so testing target === sheet alone would
            // dismiss the sheet the moment a user drags and lets go.
            var downOnBackdrop = false;
            sheet.addEventListener('click', function (e) {
              if (e.target === sheet && downOnBackdrop) sheet.close();
              downOnBackdrop = false;
            });

            var startY = null;
            var lastY = 0;
            var lastT = 0;
            var velocity = 0;
            var dragging = false;

            function reset(animate) {
              startY = null;
              dragging = false;
              sheet.classList.remove('is-dragging');
              if (animate) {
                sheet.style.transition = 'transform ' + SETTLE_MS + 'ms cubic-bezier(0.22, 1, 0.36, 1)';
              }
              sheet.style.transform = '';
              window.setTimeout(function () { sheet.style.transition = ''; }, SETTLE_MS);
            }

            sheet.addEventListener('pointerdown', function (e) {
              // Only the primary button/touch starts a drag.
              if (e.button !== undefined && e.button !== 0) return;
              downOnBackdrop = e.target === sheet;
              // Start from the handle, or from anywhere when the sheet is not
              // scrolled — never mid-list, or the drag steals the scroll.
              var fromHandle = e.target.closest && e.target.closest('.sheet-handle, .filter-sheet__head');
              if (!fromHandle && sheet.scrollTop > 0) return;
              startY = e.clientY;
              lastY = e.clientY;
              lastT = e.timeStamp;
              velocity = 0;
              dragging = false;
              sheet.style.transition = '';
              // NOTE: pointer capture is deliberately NOT taken here. Capturing
              // on pointerdown retargets every later pointer event — including
              // the synthesized click — to the dialog, so a plain tap on a nav
              // link inside the sheet never reached the link and navigation
              // stopped working. Capture is taken in pointermove, once the
              // gesture is confirmed to be a vertical drag.
            });

            sheet.addEventListener('pointermove', function (e) {
              if (startY === null) return;
              var dy = e.clientY - startY;
              var dt = e.timeStamp - lastT;
              if (dt > 0) velocity = (e.clientY - lastY) / dt;
              lastY = e.clientY;
              lastT = e.timeStamp;

              // Ignore a mostly-horizontal gesture.
              if (!dragging) {
                if (Math.abs(dy) < 6) return;
                dragging = true;
                sheet.classList.add('is-dragging');
                // Now that this is a real drag, capture so it survives the
                // pointer leaving the sheet.
                try { sheet.setPointerCapture(e.pointerId); } catch (err) { /* older engines */ }
              }
              if (dy <= 0) {
                // Rubber-band upwards instead of a hard stop.
                dy = dy * RESISTANCE;
              }
              sheet.style.transform = 'translateY(' + dy + 'px)';
            });

            function releaseCapture(e) {
              try {
                if (sheet.hasPointerCapture && sheet.hasPointerCapture(e.pointerId)) {
                  sheet.releasePointerCapture(e.pointerId);
                }
              } catch (err) { /* already released */ }
            }

            function endDrag(e) {
              if (startY === null) return;
              var dy = (e.clientY || lastY) - startY;
              // A flick only counts if the pointer was still MOVING at release.
              // Without this, holding the sheet and pausing before letting go
              // would reuse a stale velocity sample and dismiss it — the exact
              // "swipe is too sensitive" complaint.
              var sinceMove = (e.timeStamp || lastT) - lastT;
              var flicked = sinceMove < 100 && velocity > DISMISS_VELOCITY;
              var draggedFar = dy > DISMISS_PX;
              startY = null;
              dragging = false;
              releaseCapture(e);
              if (flicked || draggedFar) {
                // Let it finish the motion before closing, so it does not snap.
                sheet.style.transition = 'transform ' + SETTLE_MS + 'ms cubic-bezier(0.22, 1, 0.36, 1)';
                sheet.style.transform = 'translateY(100%)';
                window.setTimeout(function () {
                  sheet.classList.remove('is-dragging');
                  sheet.style.transition = '';
                  sheet.style.transform = '';
                  sheet.close();
                }, SETTLE_MS - 20);
              } else {
                reset(true);
              }
            }

            sheet.addEventListener('pointerup', endDrag);
            sheet.addEventListener('pointercancel', function (e) { releaseCapture(e); reset(true); });
          });
        }

        if (document.readyState === 'loading') {
          document.addEventListener('DOMContentLoaded', wireSheets);
        } else {
          wireSheets();
        }
      })();
    </script>
  `;
}
