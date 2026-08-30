/**
 * Inspection drawer management, tabs, copy failure context, next/prev failure navigation.
 */
export function buildInspectionDrawerJs(): string {
  return `
  (function () {
    var drawer = document.getElementById('test-drawer');
    var backdrop = document.getElementById('drawer-backdrop');

    function closeTestDrawer() {
      if (!drawer) return;
      drawer.hidden = true;
      drawer.setAttribute('hidden', '');
      drawer.classList.remove('test-drawer--open');
      if (backdrop) {
        backdrop.hidden = true;
        backdrop.setAttribute('hidden', '');
        backdrop.classList.remove('drawer-backdrop--open');
      }
      document.body.classList.remove('drawer-open');
    }

    function switchDrawerTab(tabName) {
      if (!drawer) return;
      var tabs = drawer.querySelectorAll('[data-drawer-tab]');
      var panels = drawer.querySelectorAll('.drawer-panel');

      tabs.forEach(function (tab) {
        var active = tab.getAttribute('data-drawer-tab') === tabName;
        tab.classList.toggle('drawer-tab--active', active);
        tab.setAttribute('aria-selected', String(active));
      });

      panels.forEach(function (panel) {
        var active = panel.id === 'drawer-panel-' + tabName;
        panel.classList.toggle('drawer-panel--active', active);
        panel.classList.toggle('drawer-panel--hidden', !active);
      });
    }

    function openTestDrawer(testId) {
      if (!drawer) return;
      var map = window.__TEST_DATA_MAP__ || {};
      var test = map[testId];
      if (!test) return;

      drawer.dataset.activeTestId = testId;

      var idEl = document.getElementById('drawer-test-id');
      var titleEl = document.getElementById('drawer-test-title');
      var metaEl = document.getElementById('drawer-meta-bar');

      if (idEl) idEl.textContent = test.scenarioId || test.testId || 'TEST';
      if (titleEl) titleEl.textContent = test.title || test.fullTitle || '';

      if (metaEl) {
        metaEl.innerHTML = [
          '<span class="status-pill status-pill--' + (test.status || 'passed') + '">' + (test.status || 'passed') + '</span>',
          '<span class="drawer-meta-item">⏱ ' + ((test.duration || 0) / 1000).toFixed(1) + 's</span>',
          test.role ? '<span class="drawer-meta-item">👤 ' + test.role + '</span>' : '',
          test.filePath ? '<span class="drawer-meta-item" title="' + test.filePath + '">📁 ' + test.filePath.split(/[\\\\/]/).pop() + '</span>' : ''
        ].filter(Boolean).join('');
      }

      // Populate error panel
      var traceContent = document.getElementById('drawer-content-trace');
      if (traceContent) {
        var errParts = [];
        if (test.errorMessage) errParts.push(test.errorMessage);
        if (test.errors && test.errors.length) {
          test.errors.forEach(function(e) {
            if (e.message && e.message !== test.errorMessage) errParts.push(e.message);
            if (e.stack) errParts.push(e.stack);
          });
        }
        if (errParts.length) {
          traceContent.innerHTML = '<div class="drawer-actions-bar">'
            + '<button class="btn btn--sm btn--primary" data-action="copy-failure-context">📋 Copy Failure Context</button>'
            + '</div>'
            + '<pre class="error-block">' + errParts.join('\\n\\n') + '</pre>';
        } else {
          traceContent.innerHTML = '<p class="muted">No error recorded for this test.</p>';
        }
      }

      // Populate diagnosis panel
      var diagContent = document.getElementById('drawer-content-diagnosis');
      if (diagContent) {
        diagContent.innerHTML = '<div class="diag-card">'
          + '<h3>Triage Suggestion</h3>'
          + '<p><strong>Source:</strong> ' + (test.failureSource || 'Unknown') + '</p>'
          + '<p><strong>Action:</strong> ' + (test.failureSource === 'app' ? 'File bug defect ticket.' : 'Inspect test locators or environment.') + '</p>'
          + '</div>';
      }

      drawer.hidden = false;
      drawer.removeAttribute('hidden');
      drawer.classList.add('test-drawer--open');
      if (backdrop) {
        backdrop.hidden = false;
        backdrop.removeAttribute('hidden');
        backdrop.classList.add('drawer-backdrop--open');
      }
      document.body.classList.add('drawer-open');

      switchDrawerTab('trace');
    }

    window.openTestDrawer = openTestDrawer;
    window.closeTestDrawer = closeTestDrawer;
    window.switchDrawerTab = switchDrawerTab;
  })();
  `;
}
