import type { CollectedTestData, ReportMode } from './types';
import type { FailureSource } from './types';
import { escapeHtml, jsonForScript } from './shared';
import { decisionHintFor, decisionHintTooltipFor, decisionHintBlurbFor } from './failure-source';

// ---------------------------------------------------------------------------
// Column definitions — same order for all export formats
// ---------------------------------------------------------------------------

type ExportRow = {
  testId: string;
  module: string;
  feature: string;
  description: string;
  steps: string;
  inputData: string;
  expectedResult: string;
  actualResult: string;
  status: string;
  priority: string;
  source: string;
  notes: string;
};

const GENERAL_HEADERS = [
  'TEST ID',
  'MODULE',
  'FEATURE',
  'DESCRIPTION',
  'TEST STEP',
  'INPUT DATA',
  'EXPECTED RESULT',
  'ACTUAL RESULT',
  'STATUS',
  'PRIORITY',
  'SOURCE',
  'NOTES',
];

const ROLE_HEADERS = [
  'TEST ID',
  'MODULE',
  'FEATURE',
  'DESCRIPTION',
  'TEST STEP',
  'INPUT DATA',
  'EXPECTED RESULT',
  'ACTUAL RESULT',
  'STATUS',
  'PRIORITY',
  'SOURCE',
  'NOTES',
];

function formatDuration(ms: number): string {
  const safe = Number.isFinite(ms) ? ms : 0;
  return `${(safe / 1000).toFixed(2)}s`;
}

function formatInputData(inputData: Record<string, string>): string {
  const entries = Object.entries(inputData);
  if (entries.length === 0) return '-';
  return entries.map(([k, v]) => `${k}: ${v}`).join('\n');
}

const STEP_NOISE = ['Before', 'After', 'Worker Cleanup', 'worker', 'Fixture'];

function formatSteps(steps: Array<{ title: string; subtitle?: string }>): string {
  if (steps.length === 0) return '-';
  const filtered = steps.filter((s) => !STEP_NOISE.some((prefix) => s.title.startsWith(prefix)));
  if (filtered.length === 0) return '-';
  return filtered
    .map((s, i) => `${i + 1}. ${s.title}${s.subtitle ? ` (${s.subtitle})` : ''}`)
    .join('\n');
}

function formatNotes(test: CollectedTestData): string {
  const parts: string[] = [];
  if (test.scenarioId) parts.push(test.scenarioId);
  parts.push(formatDuration(test.duration));
  if (test.affectedLayer && test.affectedLayer.length > 0) {
    parts.push(test.affectedLayer.map((l) => `[${l}]`).join(''));
  }
  const traceCount = test.attachments.filter((a) => a.kind === 'trace').length;
  const ssCount = test.attachments.filter((a) => a.kind === 'screenshot').length;
  if (traceCount > 0) parts.push(`${traceCount} trace`);
  if (ssCount > 0) parts.push(`${ssCount} screenshot`);
  return parts.join(' · ');
}

function buildRow(test: CollectedTestData): ExportRow {
  return {
    testId: test.testId || '-',
    module: test.module || '-',
    feature: test.feature || '-',
    description: test.title,
    steps: formatSteps(test.steps || []),
    inputData: formatInputData(test.inputData || {}),
    expectedResult: test.expectedResult || '-',
    actualResult: test.actualResult || '-',
    status: (test.status || '').toUpperCase(),
    priority: (test.priority || '').toUpperCase(),
    source: (test.failureSource || '').toUpperCase() || '-',
    notes: formatNotes(test),
  };
}

function exportRowValues(role: string | null, row: ExportRow): string[] {
  const base = [
    row.testId,
    row.module,
    row.feature,
    row.description,
    row.steps,
    row.inputData,
    row.expectedResult,
    row.actualResult,
    row.status,
    row.priority,
    row.source,
    row.notes,
  ];
  return role == null ? base : [role, ...base];
}

// ---------------------------------------------------------------------------
// TSV (Tab-Separated Values) — paste directly into Google Sheets / Excel
// ---------------------------------------------------------------------------

/**
 * Neutralize spreadsheet formula injection: Excel/Sheets interpret cells that
 * start with =, +, -, @, tab, or CR as formulas. Prefix with a single quote
 * (renders as text, invisible to users in Sheets/Excel).
 */
function sanitizeFormulaCell(value: string): string {
  const s = String(value ?? '');
  // A lone "-" is a common placeholder (e.g. empty SOURCE) — not a formula.
  if (s.length > 1 && /^[=+\-@\t\r]/.test(s)) {
    return `'${s}`;
  }
  return s;
}

function rowToTsvLine(values: string[]): string {
  return values
    .map((v) => sanitizeFormulaCell(v).replace(/\t/g, ' ').replace(/\n/g, ' | '))
    .join('\t');
}

export function toTsv(tests: CollectedTestData[], mode: ReportMode): string {
  const lines: string[] = [];

  if (mode === 'role-aware') {
    lines.push(rowToTsvLine(['ROLE', ...ROLE_HEADERS]));
    const roles = [...new Set(tests.map((t) => t.role).filter(Boolean))];
    for (const role of roles) {
      const roleTests = tests.filter((t) => t.role === role);
      roleTests.forEach((test) => {
        lines.push(rowToTsvLine(exportRowValues(role.toUpperCase(), buildRow(test))));
      });
    }
  } else {
    lines.push(rowToTsvLine(GENERAL_HEADERS));
    tests.forEach((test) => {
      lines.push(rowToTsvLine(exportRowValues(null, buildRow(test))));
    });
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// CSV (RFC 4180) — for file download
// ---------------------------------------------------------------------------

function csvQuote(value: string): string {
  // Prevent formula injection (same rationale as sanitizeFormulaCell) and
  // escape embedded quotes per RFC 4180.
  const sanitized = sanitizeFormulaCell(value).replace(/"/g, '""');
  return `"${sanitized}"`;
}

function rowToCsvLine(values: string[]): string {
  return values.map(csvQuote).join(',');
}

export function toCsv(tests: CollectedTestData[], mode: ReportMode): string {
  const lines: string[] = [];

  if (mode === 'role-aware') {
    lines.push(rowToCsvLine(['ROLE', ...ROLE_HEADERS]));
    const roles = [...new Set(tests.map((t) => t.role).filter(Boolean))];
    for (const role of roles) {
      const roleTests = tests.filter((t) => t.role === role);
      roleTests.forEach((test) => {
        lines.push(rowToCsvLine(exportRowValues(role.toUpperCase(), buildRow(test))));
      });
    }
  } else {
    lines.push(rowToCsvLine(GENERAL_HEADERS));
    tests.forEach((test) => {
      lines.push(rowToCsvLine(exportRowValues(null, buildRow(test))));
    });
  }

  return lines.join('\r\n');
}

// ---------------------------------------------------------------------------
// Confluence Wiki Markup — plain-text fallback (legacy editor / ClipboardItem fail)
// Docs: ||header|| + |cell| rows. Newlines inside cells break table → flatten.
// ---------------------------------------------------------------------------

/** Flatten cell text for wiki tables (no raw newlines / unescaped pipes). */
function confluenceWikiCellText(value: string): string {
  return String(value ?? '')
    .replace(/\r\n|\n|\r/g, ' · ')
    .replace(/\s+/g, ' ')
    .replace(/\|/g, '\\|')
    .trim();
}

function confluenceCell(value: string, isHeader = false): string {
  const delimiter = isHeader ? '||' : '|';
  const safe = confluenceWikiCellText(value);
  return `${delimiter} ${safe} `;
}

function rowToConfluenceLine(values: string[], isHeader = false): string {
  const cells = values.map((v) => confluenceCell(v, isHeader)).join('');
  return cells + (isHeader ? '||' : '|');
}

export function toConfluenceMarkup(tests: CollectedTestData[], mode: ReportMode): string {
  const lines: string[] = [];
  // Title line helps QA identify the paste source in a page
  lines.push(`h3. QA Report export (${mode === 'role-aware' ? 'role-aware' : 'general'})`);
  lines.push('');

  if (mode === 'role-aware') {
    lines.push(rowToConfluenceLine(['ROLE', ...ROLE_HEADERS], true));
    const roles = [...new Set(tests.map((t) => t.role).filter(Boolean))];
    for (const role of roles) {
      const roleTests = tests.filter((t) => t.role === role);
      roleTests.forEach((test) => {
        const r = buildRow(test);
        lines.push(
          rowToConfluenceLine(
            exportRowValues(role.toUpperCase(), {
              ...r,
              status: confluenceStatus(r.status),
            }),
          ),
        );
      });
    }
  } else {
    lines.push(rowToConfluenceLine(GENERAL_HEADERS, true));
    tests.forEach((test) => {
      const r = buildRow(test);
      lines.push(
        rowToConfluenceLine(
          exportRowValues(null, {
            ...r,
            status: confluenceStatus(r.status),
          }),
        ),
      );
    });
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Confluence HTML — rich clipboard paste (Confluence Cloud / Server modern editor)
// Prefer simple table + inline styles (Atlassian N20/N40 palette). Complex CSS
// and external classes are stripped on paste.
// ---------------------------------------------------------------------------

const CONF = {
  border: '#dfe1e6',
  headerBg: '#f4f5f7',
  headerFg: '#172b4d',
  text: '#172b4d',
  muted: '#6b778c',
  failedBg: '#ffebe6',
  failedFg: '#bf2600',
  passedBg: '#e3fcef',
  passedFg: '#006644',
  skippedBg: '#fffae6',
  skippedFg: '#974f0c',
  accentBg: '#f3e4d4',
  accentFg: '#a87648',
  font: '-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif',
  mono: 'ui-monospace,SFMono-Regular,Menlo,Consolas,monospace',
} as const;

function getRowBg(status: string): string {
  const s = (status || '').toLowerCase();
  if (s === 'failed' || s === 'timedout' || s === 'interrupted')
    return `background:${CONF.failedBg};`;
  if (s === 'skipped') return `background:${CONF.skippedBg};`;
  return '';
}

const STATUS_ICON: Record<string, string> = {
  passed: '✓',
  failed: '✗',
  timedout: '⏱',
  interrupted: '✗',
  skipped: '⊘',
};

function confluenceStatus(status: string): string {
  const s = (status || '').toLowerCase();
  const icon = STATUS_ICON[s] ?? '?';
  return `${icon} ${(status || 'UNKNOWN').toUpperCase()}`;
}

function confluenceStatusHtml(status: string): string {
  const s = (status || '').toLowerCase();
  const label = confluenceStatus(status);
  let bg: string = CONF.headerBg;
  let fg: string = CONF.muted;
  if (s === 'failed' || s === 'timedout' || s === 'interrupted') {
    bg = CONF.failedBg;
    fg = CONF.failedFg;
  } else if (s === 'passed') {
    bg = CONF.passedBg;
    fg = CONF.passedFg;
  } else if (s === 'skipped') {
    bg = CONF.skippedBg;
    fg = CONF.skippedFg;
  }
  return `<span style="display:inline-block;padding:2px 8px;border-radius:3px;background:${bg};color:${fg};font-weight:700;font-size:11px;white-space:nowrap;">${escapeHtml(label)}</span>`;
}

function confluencePriorityHtml(priority: string): string {
  const p = (priority || 'medium').toLowerCase();
  let bg: string = CONF.headerBg;
  let fg: string = CONF.muted;
  if (p === 'high') {
    bg = CONF.failedBg;
    fg = CONF.failedFg;
  } else if (p === 'medium') {
    bg = CONF.skippedBg;
    fg = CONF.skippedFg;
  } else if (p === 'low') {
    bg = CONF.passedBg;
    fg = CONF.passedFg;
  }
  return `<span style="display:inline-block;padding:2px 8px;border-radius:3px;background:${bg};color:${fg};font-weight:700;font-size:11px;">${escapeHtml((priority || 'MEDIUM').toUpperCase())}</span>`;
}

function confluenceSourceHtml(source: string): string {
  const s = (source || '-').toUpperCase();
  if (!s || s === '-') return `<span style="color:${CONF.muted};">-</span>`;
  return `<span style="display:inline-block;padding:2px 8px;border-radius:3px;background:${CONF.accentBg};color:${CONF.accentFg};font-weight:700;font-size:11px;">${escapeHtml(s)}</span>`;
}

function confluenceMultilineHtml(value: string): string {
  const safe = escapeHtml(value || '-').replace(/\r\n|\n|\r/g, '<br>');
  return safe;
}

function htmlCell(innerHtml: string, rowStyle?: string, extra = ''): string {
  const style = [
    'padding:6px 10px',
    `border:1px solid ${CONF.border}`,
    'vertical-align:top',
    'font-size:12px',
    `color:${CONF.text}`,
    'line-height:1.4',
    rowStyle || '',
    extra,
  ]
    .filter(Boolean)
    .join(';');
  return `<td style="${style}">${innerHtml}</td>`;
}

function htmlHeaderCell(value: string): string {
  return `<th style="padding:7px 10px;border:1px solid ${CONF.border};background:${CONF.headerBg};color:${CONF.headerFg};text-align:left;font-size:11px;font-weight:700;letter-spacing:0.03em;white-space:nowrap;">${escapeHtml(value)}</th>`;
}

function confluenceRowCells(r: ExportRow, bg: string): string {
  return [
    htmlCell(
      `<code style="font-family:${CONF.mono};font-size:11px;font-weight:700;color:${CONF.accentFg};">${escapeHtml(r.testId)}</code>`,
      bg,
    ),
    htmlCell(escapeHtml(r.module || '-'), bg, 'white-space:nowrap;font-weight:600'),
    htmlCell(escapeHtml(r.feature || '-'), bg, 'white-space:nowrap'),
    htmlCell(confluenceMultilineHtml(r.description), bg),
    htmlCell(confluenceMultilineHtml(r.steps), bg, 'min-width:140px'),
    htmlCell(confluenceMultilineHtml(r.inputData), bg, 'min-width:120px'),
    htmlCell(confluenceMultilineHtml(r.expectedResult), bg),
    htmlCell(confluenceMultilineHtml(r.actualResult), bg),
    htmlCell(confluenceStatusHtml(r.status), bg, 'text-align:center;white-space:nowrap'),
    htmlCell(confluencePriorityHtml(r.priority), bg, 'text-align:center;white-space:nowrap'),
    htmlCell(confluenceSourceHtml(r.source), bg, 'text-align:center;white-space:nowrap'),
    htmlCell(
      confluenceMultilineHtml(r.notes),
      bg,
      `color:${CONF.muted};font-size:11px;white-space:nowrap`,
    ),
  ].join('');
}

export function toConfluenceHtml(tests: CollectedTestData[], mode: ReportMode): string {
  const headers = mode === 'role-aware' ? ['ROLE', ...ROLE_HEADERS] : GENERAL_HEADERS;
  const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');

  let html = '';
  html += `<div style="font-family:${CONF.font};color:${CONF.text};">`;
  html += `<p style="margin:0 0 8px;font-size:12px;color:${CONF.muted};"><strong style="color:${CONF.headerFg};">QA Report</strong> · ${escapeHtml(stamp)} · ${tests.length} row${tests.length === 1 ? '' : 's'} · paste into Confluence editor</p>`;
  html += `<table border="1" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid ${CONF.border};font-family:${CONF.font};font-size:12px;width:100%;table-layout:auto;">`;
  html += '<thead><tr>' + headers.map(htmlHeaderCell).join('') + '</tr></thead>';
  html += '<tbody>';

  if (mode === 'role-aware') {
    const roles = [...new Set(tests.map((t) => t.role).filter(Boolean))];
    for (const role of roles) {
      const roleTests = tests.filter((t) => t.role === role);
      roleTests.forEach((test, idx) => {
        const r = buildRow(test);
        const bg = getRowBg(r.status);
        html += '<tr>';
        if (idx === 0) {
          html += `<td rowspan="${roleTests.length}" style="padding:6px 10px;border:1px solid ${CONF.border};font-weight:700;vertical-align:middle;text-align:center;font-size:12px;letter-spacing:0.04em;color:${CONF.headerFg};">${escapeHtml(role.toUpperCase())}</td>`;
        }
        html += confluenceRowCells(r, bg);
        html += '</tr>';
      });
    }
  } else {
    tests.forEach((test) => {
      const r = buildRow(test);
      const bg = getRowBg(r.status);
      html += '<tr>';
      html += confluenceRowCells(r, bg);
      html += '</tr>';
    });
  }

  html += '</tbody></table></div>';
  return html;
}

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
          ? ['role','testId','description','steps','input','expected','actual','status','priority','source','notes']
          : ['testId','description','steps','input','expected','actual','status','priority','source','notes'];
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
          notes: 'NOTES'
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

// ---------------------------------------------------------------------------
// HTML rendering helpers used by build-table-view.ts
// ---------------------------------------------------------------------------

export function renderStatusBadge(status: string): string {
  const map: Record<string, { cls: string; icon: string; label: string }> = {
    passed: { cls: 'status-pill--passed', icon: '✓', label: 'Passed' },
    failed: { cls: 'status-pill--failed', icon: '✗', label: 'Failed' },
    timedOut: { cls: 'status-pill--failed', icon: '⏱', label: 'Timed out' },
    interrupted: { cls: 'status-pill--failed', icon: '✗', label: 'Interrupted' },
    skipped: { cls: 'status-pill--skipped', icon: '⊘', label: 'Skipped' },
  };
  const entry = map[status] ?? {
    cls: 'status-pill--skipped',
    icon: '?',
    label: status || 'Unknown',
  };
  return `<span class="status-pill status-pill--full ${entry.cls}" role="img" aria-label="Status: ${escapeHtml(entry.label)}"><span class="status-pill__icon" aria-hidden="true">${entry.icon}</span> ${entry.label}</span>`;
}

export function renderPriorityBadge(priority: string): string {
  const map: Record<string, string> = {
    high: 'priority-badge--high',
    medium: 'priority-badge--medium',
    low: 'priority-badge--low',
  };
  const safe = (priority || '').toLowerCase();
  const cls = map[safe] ?? 'priority-badge--medium';
  const label = (priority || 'MEDIUM').toUpperCase();
  return `<span class="priority-badge ${cls}" role="img" aria-label="Priority: ${escapeHtml(label)}">${escapeHtml(label)}</span>`;
}

export function renderFailureSourceCell(test: {
  status?: string;
  failureSource?: FailureSource;
  errorMessage?: string;
}): string {
  if (!['failed', 'timedOut', 'interrupted'].includes(test.status || '') || !test.failureSource) {
    return '<span class="muted">-</span>';
  }
  const src = test.failureSource;
  const hint = decisionHintFor(src);
  const tip = decisionHintTooltipFor(src, test.errorMessage ?? '');
  const blurb = decisionHintBlurbFor(src, test.errorMessage ?? '');
  return `<div class="src-cell" title="${escapeHtml(tip)}">
      <div class="src-cell__row">
        <span class="src-cell__k">Cause</span>
        <span class="failure-source failure-source--${escapeHtml(src)}">${escapeHtml(src.toUpperCase())}</span>
      </div>
      <div class="src-cell__row">
        <span class="src-cell__k">Do</span>
        <span class="decision-hint">${escapeHtml(hint)}</span>
      </div>
      <p class="src-cell__blurb">${escapeHtml(blurb)}</p>
    </div>`;
}

export function renderLayerBadges(layers: string[]): string {
  if (layers.length === 0) return '';
  return layers
    .map((l) => `<span class="layer-badge layer-badge--${l.toLowerCase()}">${escapeHtml(l)}</span>`)
    .join('');
}

export function renderInputDataCell(inputData: Record<string, string>): string {
  if (!inputData || typeof inputData !== 'object') return '<span class="muted">-</span>';
  const entries = Object.entries(inputData);
  if (entries.length === 0) return '<span class="muted">-</span>';
  // Multi-line key/value rows — no inline " · " join, no truncation
  return `<div class="input-flat">${entries
    .map(
      ([k, v]) =>
        `<div class="input-flat__pair"><span class="key">${escapeHtml(k)}:</span> <span class="val">${escapeHtml(v)}</span></div>`,
    )
    .join('')}</div>`;
}

export function renderStepsCell(steps: Array<{ title: string }>): string {
  const visible = steps.filter(
    (s) => !s.title.startsWith('Before') && !s.title.startsWith('After'),
  );
  if (visible.length === 0) return '<span class="muted">-</span>';
  // Multi-line steps (one per row) — full text, no ellipsis, no list markers
  return `<div class="steps-flat">${visible
    .map(
      (s, i) =>
        `<div class="steps-flat__item"><span class="steps-flat__n">${i + 1}.</span> ${escapeHtml(s.title)}</div>`,
    )
    .join('')}</div>`;
}

export function renderActualResultCell(test: CollectedTestData): string {
  const isUnhealthy = ['failed', 'timedOut', 'interrupted'].includes(test.status);
  const cls = isUnhealthy ? 'actual-result--failed' : 'actual-result--passed';
  const full = test.actualResult || '-';
  // Full text always — no "…" truncation / collapsible cut
  const html = escapeHtml(full).replace(/\r\n|\n|\r/g, '<br>');
  return `<div class="${cls}">${html}</div>`;
}

/** Multi-line plain text cell (description / expected) — full content, newlines → <br> */
export function renderMultilineTextCell(text: string, className: string): string {
  const full = text || '-';
  const html = escapeHtml(full).replace(/\r\n|\n|\r/g, '<br>');
  return `<div class="${className}">${html}</div>`;
}

export function renderNotesCell(test: CollectedTestData): string {
  const rows: string[] = [];

  // 0) Scenario ID (only when present) — surfaces traceability in the table
  if (test.scenarioId) {
    rows.push(
      `<div class="notes-row notes-row--scenario"><code class="notes-scenario" title="Scenario ID">${escapeHtml(test.scenarioId)}</code></div>`,
    );
  }

  // 1) Time
  rows.push(
    `<div class="notes-row notes-row--time"><span class="duration" title="Duration">${formatDuration(test.duration)}</span></div>`,
  );

  // 2) Screenshot(s)
  const screenshots = test.attachments.filter((a) => a.kind === 'screenshot' && a.relativePath);
  if (screenshots.length > 0) {
    const ss = screenshots[0];
    const more =
      screenshots.length > 1
        ? `<span class="evidence-more" title="${screenshots.length - 1} more screenshots">+${screenshots.length - 1}</span>`
        : '';
    rows.push(
      `<div class="notes-row notes-row--screenshot"><a href="${escapeHtml(ss.relativePath)}" target="_blank" rel="noopener noreferrer" class="evidence-thumb" title="Screenshot"><img src="${escapeHtml(ss.relativePath)}" alt="screenshot" loading="lazy" onerror="this.closest('a')?.classList.add('evidence-missing')"></a>${more}</div>`,
    );
  }

  // 3) Video
  const videos = test.attachments.filter((a) => a.kind === 'video' && a.relativePath);
  if (videos.length > 0) {
    const v = videos[0];
    rows.push(
      `<div class="notes-row notes-row--video"><a class="evidence-link" href="${escapeHtml(v.relativePath)}" target="_blank" rel="noopener noreferrer" title="Video">video</a></div>`,
    );
  }

  // 4) Trace
  const trace = test.attachments.find((a) => a.kind === 'trace' && a.relativePath);
  if (trace) {
    rows.push(
      `<div class="notes-row notes-row--trace"><a class="evidence-link" href="${escapeHtml(trace.relativePath)}" target="_blank" rel="noopener noreferrer" title="Trace">trace</a></div>`,
    );
  }

  // 5) Layer badges (FE/BE/…)
  if (test.affectedLayer?.length) {
    const badges = test.affectedLayer
      .map(
        (l) => `<span class="layer-badge layer-badge--${l.toLowerCase()}">${escapeHtml(l)}</span>`,
      )
      .join('');
    rows.push(`<div class="notes-row notes-row--badges">${badges}</div>`);
  }

  return `<div class="notes-cell">${rows.join('')}</div>`;
}
