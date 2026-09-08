import type { CollectedTestData, ReportMode } from './types';
import { escapeHtml } from './shared';

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
  aiNotes: string;
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
  'AI NOTES',
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
  'AI NOTES',
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
  if (test.qaNotes && test.qaNotes.trim()) parts.push(`QA: ${test.qaNotes.trim()}`);
  return parts.join(' · ');
}

function formatAiNotes(test: CollectedTestData): string {
  const text = (test.aiNotes || '').trim();
  return text || '-';
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
    aiNotes: formatAiNotes(test),
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
    row.aiNotes,
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
    htmlCell(confluenceMultilineHtml(r.aiNotes), bg, `color:${CONF.muted};font-size:11px`),
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

export * from './export-script';
export * from './render-cells';
