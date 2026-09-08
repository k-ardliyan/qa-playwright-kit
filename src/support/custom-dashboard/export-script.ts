import type { ReportMode } from './types';
import { jsonForScript } from './shared';

// ---------------------------------------------------------------------------
// Inline JS snippets — embedded in HTML dashboard for clipboard/download
// ---------------------------------------------------------------------------

/**
 * Returns an inline <script> block that wires up the three export buttons.
 * When payload is provided, export prefers currently visible filtered rows.
 */
export function buildExportScript(
  tsvContent: string,
  csvContent: string,
  confluenceContent: string,
  confluenceHtml: string,
  featureName: string,
  payload?: unknown[],
  mode: ReportMode = 'general',
): string {
  // jsonForScript (NOT JSON.stringify): these strings contain test-controlled
  // text (titles, error messages, notes). JSON.stringify leaves '<' unescaped,
  // so a payload containing '</script>' would terminate the inline <script>
  // block and allow XSS. jsonForScript escapes <, >, & as unicode sequences.
  const safeTsv = jsonForScript(tsvContent);
  const safeCsv = jsonForScript(csvContent);
  const safeConfluence = jsonForScript(confluenceContent);
  const safeConfluenceHtml = jsonForScript(confluenceHtml);
  const safeFilename = JSON.stringify(`qa-report-${featureName}.csv`);
  const safePayload = jsonForScript(payload ?? []);
  const safeMode = JSON.stringify(mode);

  return `
(function () {
  var FULL_TSV = ${safeTsv};
  var FULL_CSV = ${safeCsv};
  var FULL_CONF = ${safeConfluence};
  var FULL_CONF_HTML = ${safeConfluenceHtml};
  var PAYLOAD = ${safePayload};
  var MODE = ${safeMode};

  function showFeedback(btnId, msg) {
    var btn = document.getElementById(btnId);
    if (!btn) return;
    var orig = btn.textContent;
    btn.textContent = msg;
    setTimeout(function () { btn.textContent = orig; }, 2000);
  }

  function copyPlainText(text, btnId) {
    navigator.clipboard.writeText(text).then(function () {
      showFeedback(btnId, '\\u2713 Copied!');
    }).catch(function () {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.top = '0';
      ta.style.left = '0';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      showFeedback(btnId, '\\u2713 Copied!');
    });
  }

  function copyRichText(plainText, htmlContent, btnId) {
    try {
      var htmlBlob = new Blob([htmlContent], { type: 'text/html' });
      var textBlob = new Blob([plainText], { type: 'text/plain' });
      var item = new ClipboardItem({ 'text/html': htmlBlob, 'text/plain': textBlob });
      navigator.clipboard.write([item]).then(function () {
        showFeedback(btnId, '\\u2713 Copied!');
      }).catch(function () {
        copyPlainText(plainText, btnId);
      });
    } catch (err) {
      copyPlainText(plainText, btnId);
    }
  }

  function downloadFile(content, filename, mimeType) {
    var blob = new Blob([content], { type: mimeType });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function visibleKeys() {
        var keys = [];
        var seen = {};
        // Prefer table rows in the active table panel so accordion cards don't double-count
        var scope = document.querySelector('#view-table.view-panel--active') || document;
        scope.querySelectorAll('tr[data-row-key], .test-card[data-row-key]').forEach(function (el) {
          if (el.hidden) return;
          if (el.style && el.style.display === 'none') return;
          var k = el.getAttribute('data-row-key');
          if (!k || seen[k]) return;
          seen[k] = true;
          keys.push(k);
        });
        return keys;
      }

      function filteredPayload() {
        if (!PAYLOAD || !PAYLOAD.length) return null;
        var keys = visibleKeys();
        // If nothing visible after filter, export empty table (headers only) — not full dump
        if (!keys.length) return [];
        var set = {};
        keys.forEach(function (k) { set[k] = true; });
        var rows = PAYLOAD.filter(function (row) { return set[row.key]; });
        // Fallback: if keys came from accordion cards with different key space, match by testId
        if (!rows.length) {
          var ids = {};
          keys.forEach(function (k) {
            var el = document.querySelector('[data-row-key=' + JSON.stringify(k) + ']');
            if (el) {
              var id = el.getAttribute('data-test-id');
              if (id) ids[id] = true;
            }
          });
          rows = PAYLOAD.filter(function (row) { return ids[row.testId]; });
        }
        return rows;
      }

      function csvQuote(v) {
        var q = String.fromCharCode(34);
        return q + String(v == null ? '' : v).split(q).join(q + q) + q;
      }

      function formatSteps(steps) {
        if (!steps || !steps.length) return '-';
        return steps
          .map(function (s, i) {
            if (typeof s === 'object' && s !== null) {
              return (i + 1) + '. ' + (s.title || '') + (s.subtitle ? ' (' + s.subtitle + ')' : '');
            }
            return (i + 1) + '. ' + s;
          })
          .join('\\n');
      }

      function formatInput(input) {
        if (!input || typeof input !== 'object') return '-';
        var entries = Object.keys(input);
        if (!entries.length) return '-';
        return entries.map(function (k) { return k + ': ' + input[k]; }).join('\\n');
      }

      function formatNotesClient(r) {
        var parts = [];
        if (r.scenarioId) parts.push(r.scenarioId);
        parts.push(((r.duration || 0) / 1000).toFixed(2) + 's');
        if (r.affectedLayer && r.affectedLayer.length) {
          parts.push(r.affectedLayer.map(function (l) { return '[' + l + ']'; }).join(''));
        }
        if (r.qaNotes && String(r.qaNotes).trim()) parts.push('QA: ' + String(r.qaNotes).trim());
        return parts.length ? parts.join(' · ') : '-';
      }

      function statusLabel(status) {
        var s = String(status || '').toLowerCase();
        var icon = s === 'passed' ? '✓' : s === 'failed' || s === 'interrupted' ? '✗' : s === 'timedout' ? '⏱' : s === 'skipped' ? '⊘' : '?';
        return icon + ' ' + String(status || 'UNKNOWN').toUpperCase();
      }

      function wikiCell(value) {
        var s = String(value == null ? '' : value);
        var crlf = String.fromCharCode(13, 10);
        var lf = String.fromCharCode(10);
        var cr = String.fromCharCode(13);
        s = s.split(crlf).join(' · ').split(lf).join(' · ').split(cr).join(' · ');
        s = s.replace(new RegExp('[' + String.fromCharCode(9, 10, 11, 12, 13, 32) + ']+', 'g'), ' ');
        s = s.split('|').join(String.fromCharCode(92) + '|');
        return s.trim();
      }

      function confEsc(value) {
        return String(value == null ? '' : value)
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;');
      }

      function confMultiline(value) {
        var s = confEsc(value);
        var crlf = String.fromCharCode(13, 10);
        var lf = String.fromCharCode(10);
        var cr = String.fromCharCode(13);
        return s.split(crlf).join('<br>').split(lf).join('<br>').split(cr).join('<br>');
      }

      function confPill(label, bg, fg) {
        return '<span style="display:inline-block;padding:2px 8px;border-radius:3px;background:' + bg + ';color:' + fg + ';font-weight:700;font-size:11px;white-space:nowrap;">' + confEsc(label) + '</span>';
      }

      function confStatusHtml(status) {
        var s = String(status || '').toLowerCase();
        var label = statusLabel(status);
        if (s === 'failed' || s === 'timedout' || s === 'interrupted') return confPill(label, '#ffebe6', '#bf2600');
        if (s === 'passed') return confPill(label, '#e3fcef', '#006644');
        if (s === 'skipped') return confPill(label, '#fffae6', '#974f0c');
        return confPill(label, '#f4f5f7', '#6b778c');
      }

      function confPriorityHtml(priority) {
        var p = String(priority || 'medium').toLowerCase();
        var label = String(priority || 'MEDIUM').toUpperCase();
        if (p === 'high') return confPill(label, '#ffebe6', '#bf2600');
        if (p === 'medium') return confPill(label, '#fffae6', '#974f0c');
        if (p === 'low') return confPill(label, '#e3fcef', '#006644');
        return confPill(label, '#f4f5f7', '#6b778c');
      }

      function confSourceHtml(source) {
        var s = String(source || '-').toUpperCase() || '-';
        if (!s || s === '-') return '<span style="color:#6b778c;">-</span>';
        return confPill(s, '#f3e4d4', '#a87648');
      }

      /**
       * Visible column keys from Filter columns picker (live DOM),
       * falling back to localStorage dashboard-columns-v1.
       * Locked: testId + status always included.
       */
      function visibleColumnKeys() {
        var LOCKED = { testId: true, status: true };
        var ORDER = MODE === 'role-aware'
          ? ['role','testId','description','steps','input','expected','actual','status','priority','source','notes','aiNotes']
          : ['testId','description','steps','input','expected','actual','status','priority','source','notes','aiNotes'];
        var state = null;

        // 1) Prefer live checkboxes in column picker
        var toggles = document.querySelectorAll('[data-col-toggle]');
        if (toggles && toggles.length) {
          state = {};
          toggles.forEach(function (input) {
            var key = input.getAttribute('data-col-toggle');
            if (!key) return;
            state[key] = !!input.checked;
          });
        }

        // 2) Fallback: localStorage — current key is v3 (column picker shell);
        //    keep v1 for legacy static reports.
        if (!state) {
          try {
            var raw = localStorage.getItem('dashboard-columns-v3') || localStorage.getItem('dashboard-columns-v1');
            if (raw) state = JSON.parse(raw);
          } catch (e) {}
        }

        // 3) Fallback: table header cells with data-col-hidden
        if (!state) {
          state = {};
          var ths = document.querySelectorAll('.qa-report-table thead th[data-col]');
          if (ths && ths.length) {
            ths.forEach(function (th) {
              var key = th.getAttribute('data-col');
              if (!key) return;
              state[key] = th.getAttribute('data-col-hidden') !== '1';
            });
          }
        }

        // Default: all visible
        if (!state) {
          return ORDER.slice();
        }

        return ORDER.filter(function (key) {
          if (LOCKED[key]) return true;
          if (key === 'role') return true; // role-aware mode column always kept when present
          return state[key] !== false;
        });
      }

      function columnHeader(key) {
        var map = {
          role: 'ROLE',
          testId: 'TEST ID',
          description: 'DESCRIPTION',
          steps: 'TEST STEP',
          input: 'INPUT DATA',
          expected: 'EXPECTED RESULT',
          actual: 'ACTUAL RESULT',
          status: 'STATUS',
          priority: 'PRIORITY',
          source: 'SOURCE',
          notes: 'NOTES',
          aiNotes: 'AI NOTES'
        };
        return map[key] || key.toUpperCase();
      }

      function cellValue(r, key) {
        if (key === 'role') return r.role || '';
        if (key === 'testId') return r.testId;
        if (key === 'description') return r.title;
        if (key === 'steps') return formatSteps(r.steps);
        if (key === 'input') return formatInput(r.inputData);
        if (key === 'expected') return r.expectedResult;
        if (key === 'actual') return r.actualResult;
        if (key === 'status') return statusLabel(r.status);
        if (key === 'priority') return String(r.priority || '').toUpperCase();
        if (key === 'source') return (r.failureSource || '').toUpperCase() || '-';
        if (key === 'notes') return formatNotesClient(r);
        if (key === 'aiNotes') return String(r.aiNotes || '').trim() || '-';
        return '';
      }

      function cellHtmlValue(r, key) {
        if (key === 'role') return confEsc((r.role || '').toUpperCase());
        if (key === 'testId') return '<code style="font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11px;font-weight:700;color:#a87648;">' + confEsc(r.testId || '-') + '</code>';
        if (key === 'description') return confMultiline(r.title || '-');
        if (key === 'steps') return confMultiline(formatSteps(r.steps));
        if (key === 'input') return confMultiline(formatInput(r.inputData));
        if (key === 'expected') return confMultiline(r.expectedResult || '-');
        if (key === 'actual') return confMultiline(r.actualResult || '-');
        if (key === 'status') return confStatusHtml(r.status);
        if (key === 'priority') return confPriorityHtml(r.priority);
        if (key === 'source') return confSourceHtml(r.failureSource);
        if (key === 'notes') return confEsc(formatNotesClient(r));
        if (key === 'aiNotes') return confMultiline(String(r.aiNotes || '').trim() || '-');
        return confEsc(cellValue(r, key));
      }

      function buildCsv(rows) {
        var cols = visibleColumnKeys();
        var headers = cols.map(columnHeader);
        var lines = [headers.map(csvQuote).join(',')];
        rows.forEach(function (r) {
          lines.push(cols.map(function (k) { return csvQuote(cellValue(r, k)); }).join(','));
        });
        return lines.join('\\n');
      }

      function buildTsv(rows) {
        var cols = visibleColumnKeys();
        var headers = cols.map(columnHeader);
        var lines = [headers.join('\\t')];
        rows.forEach(function (r) {
          lines.push(cols.map(function (k) {
            return String(cellValue(r, k) == null ? '' : cellValue(r, k)).replace(/\\t/g, ' ').replace(/\\n/g, ' | ');
          }).join('\\t'));
        });
        return lines.join('\\n');
      }

      function buildConfluenceWiki(rows) {
              var cols = visibleColumnKeys();
              var headers = cols.map(columnHeader);
              var lines = [];
              lines.push('h3. QA Report export');
              lines.push('');
              lines.push('|| ' + headers.map(wikiCell).join(' || ') + ' ||');
              // Wiki markup has no rowspan — show ROLE only on first row of a consecutive role group.
              var prevRole = null;
              rows.forEach(function (r) {
                var roleKey = String(r.role || '').toUpperCase() || '';
                lines.push('| ' + cols.map(function (k) {
                  if (k === 'role') {
                    if (roleKey && roleKey === prevRole) return '';
                    prevRole = roleKey;
                    return wikiCell(roleKey || cellValue(r, k));
                  }
                  return wikiCell(cellValue(r, k));
                }).join(' | ') + ' |');
              });
              return lines.join('\\n');
            }

            function buildConfluenceHtml(rows) {
        var cols = visibleColumnKeys();
        var headers = cols.map(columnHeader);
        var stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
        var hasRoleCol = cols.indexOf('role') !== -1;
        var html = '<div style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#172b4d;">';
        html += '<p style="margin:0 0 8px;font-size:12px;color:#6b778c;"><strong style="color:#172b4d;">QA Report</strong> · ' + confEsc(stamp) + ' · ' + rows.length + ' row' + (rows.length === 1 ? '' : 's') + ' · paste into Confluence editor</p>';
        html += '<table border="1" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid #dfe1e6;font-size:12px;width:100%;">';
        html += '<thead><tr>';
        headers.forEach(function (h) {
          html += '<th style="padding:7px 10px;border:1px solid #dfe1e6;background:#f4f5f7;color:#172b4d;text-align:left;font-size:11px;font-weight:700;white-space:nowrap;">' + confEsc(h) + '</th>';
        });
        html += '</tr></thead><tbody>';

        // Group consecutive same-role rows so ROLE column can rowspan (Confluence-friendly).
        var groups = [];
        if (hasRoleCol) {
          var cur = null;
          rows.forEach(function (r) {
            var roleKey = String(r.role || '').toUpperCase() || '-';
            if (!cur || cur.roleKey !== roleKey) {
              cur = { roleKey: roleKey, rows: [] };
              groups.push(cur);
            }
            cur.rows.push(r);
          });
        } else {
          groups = [{ roleKey: '', rows: rows.slice() }];
        }

        groups.forEach(function (g) {
          g.rows.forEach(function (r, idx) {
            var st = String(r.status || '').toLowerCase();
            var bg = (st === 'failed' || st === 'timedout' || st === 'interrupted')
              ? 'background:#ffebe6;'
              : (st === 'skipped' ? 'background:#fffae6;' : '');
            html += '<tr>';
            cols.forEach(function (k) {
              if (k === 'role') {
                // Only first row of the role group emits the ROLE cell with rowspan.
                if (idx !== 0) return;
                var span = g.rows.length;
                // Bold role label, no background fill — matches Atlassian default
                var roleStyle = 'border:1px solid #dfe1e6;padding:6px 10px;vertical-align:middle;text-align:center;font-size:12px;font-weight:700;letter-spacing:0.04em;color:#172b4d;';
                html += '<td' + (span > 1 ? ' rowspan="' + span + '"' : '') + ' style="' + roleStyle + '">' + confEsc(g.roleKey) + '</td>';
                return;
              }
              var center = (k === 'status' || k === 'priority' || k === 'source') ? 'text-align:center;' : '';
              html += '<td style="border:1px solid #dfe1e6;padding:6px 10px;vertical-align:top;font-size:12px;line-height:1.4;' + bg + center + '">' + cellHtmlValue(r, k) + '</td>';
            });
            html += '</tr>';
          });
        });

        html += '</tbody></table></div>';
        return html;
      }

      document.addEventListener('click', function (e) {
        var btn = e.target.closest ? e.target.closest('[id]') : e.target;
        if (!btn || !btn.id) return;
        if (['btn-copy-confluence','btn-copy-tsv','btn-download-csv'].indexOf(btn.id) === -1) return;

        // Always rebuild from currently visible rows + currently visible columns
        // so Filter columns show/hide is reflected live in every export path.
        var filtered = filteredPayload();
        var rows = (filtered && filtered.length >= 0) ? filtered : (PAYLOAD || []);
        // When no payload available, fall back to full static snapshot
        if (!PAYLOAD || !PAYLOAD.length) {
          if (btn.id === 'btn-copy-confluence') {
            copyRichText(FULL_CONF, FULL_CONF_HTML, 'btn-copy-confluence');
          } else if (btn.id === 'btn-copy-tsv') {
            copyPlainText(FULL_TSV, 'btn-copy-tsv');
          } else if (btn.id === 'btn-download-csv') {
            downloadFile('\\uFEFF' + FULL_CSV, ${safeFilename}, 'text/csv;charset=utf-8;');
            showFeedback('btn-download-csv', '\\u2713 Downloaded');
          }
          return;
        }

        var tsv = buildTsv(rows);
        var csv = '\\uFEFF' + buildCsv(rows);
        var confWiki = buildConfluenceWiki(rows);
        var confHtml = buildConfluenceHtml(rows);

        if (btn.id === 'btn-copy-confluence') {
          // text/html = rich table for Confluence Cloud; text/plain = wiki markup fallback
          copyRichText(confWiki, confHtml, 'btn-copy-confluence');
        } else if (btn.id === 'btn-copy-tsv') {
          copyPlainText(tsv, 'btn-copy-tsv');
        } else if (btn.id === 'btn-download-csv') {
          downloadFile(csv, ${safeFilename}, 'text/csv;charset=utf-8;');
          showFeedback('btn-download-csv', '\\u2713 Downloaded');
        }
      });
    })();
      `.trim();
}
