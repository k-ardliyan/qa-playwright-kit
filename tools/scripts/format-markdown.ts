import fs from 'fs';
import path from 'path';

const SKIPPED_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'artifacts',
  '.auth',
  'test-results',
  '.tmp',
  'brain',
  '.zcode',
  '.hermes',
]);

function findMdFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIPPED_DIRS.has(entry.name)) continue;
      results.push(...findMdFiles(full));
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      results.push(full);
    }
  }
  return results;
}

function splitRow(line: string): string[] {
  const trimmed = line.trim();
  let content = trimmed;
  if (content.startsWith('|')) content = content.slice(1);
  if (content.endsWith('|')) content = content.slice(0, -1);

  // Split by | while ignoring escaped \|
  const cells: string[] = [];
  let current = '';
  let escaped = false;

  for (let i = 0; i < content.length; i++) {
    const char = content[i];
    if (escaped) {
      current += char;
      escaped = false;
    } else if (char === '\\') {
      current += char;
      escaped = true;
    } else if (char === '|') {
      cells.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  cells.push(current.trim());
  return cells;
}

function isDelimiterRow(cells: string[]): boolean {
  if (cells.length === 0) return false;
  return cells.every((c) => /^:?-+:?$/.test(c.trim()) && c.trim().replace(/:/g, '').length >= 1);
}

type Alignment = 'left' | 'center' | 'right' | 'none';

// Visual-width alignment per markdownlint MD060 / wcwidth conventions:
// East Asian Wide/Fullwidth and emoji-presentation code points occupy 2 columns.
const ZERO_WIDTH_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x0300, 0x036f], // combining diacritics
  [0x200b, 0x200f], // zero-width chars
  [0x20d0, 0x20f0], // combining marks
  [0xfe00, 0xfe0f], // variation selectors
  [0x1f3fb, 0x1f3ff], // skin-tone modifiers
];

const WIDE_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x1100, 0x115f],
  [0x2e80, 0x303e],
  [0x3041, 0x33ff],
  [0x3400, 0x4dbf],
  [0x4e00, 0x9fff],
  [0xa000, 0xa4cf],
  [0xa960, 0xa97f],
  [0xac00, 0xd7a3],
  [0xf900, 0xfaff],
  [0xfe10, 0xfe19],
  [0xfe30, 0xfe6f],
  [0xff00, 0xff60],
  [0xffe0, 0xffe6],
  [0x1f300, 0x1f64f],
  [0x1f680, 0x1f6ff],
  [0x1f900, 0x1f9ff],
  [0x1fa70, 0x1faff],
  [0x20000, 0x2fffd],
  [0x30000, 0x3fffd],
];

// Emoji-presentation symbols rendered wide despite sitting outside the ranges above
const WIDE_SINGLES = new Set([
  0x231a, 0x231b, 0x2329, 0x232a, 0x23e9, 0x23ea, 0x23eb, 0x23ec, 0x23ed, 0x23ee, 0x23ef, 0x23f0,
  0x23f1, 0x23f2, 0x23f3, 0x25fd, 0x25fe, 0x2614, 0x2615, 0x2648, 0x2649, 0x264a, 0x264b, 0x264c,
  0x264d, 0x264e, 0x264f, 0x2650, 0x2651, 0x2652, 0x2653, 0x267f, 0x2693, 0x26a1, 0x26aa, 0x26ab,
  0x26bd, 0x26be, 0x26c4, 0x26c5, 0x26ce, 0x26d4, 0x26ea, 0x26f2, 0x26f3, 0x26f5, 0x26fa, 0x26fd,
  0x2705, 0x270a, 0x270b, 0x2728, 0x274c, 0x274e, 0x2753, 0x2754, 0x2755, 0x2757, 0x2795, 0x2796,
  0x2797, 0x27b0, 0x27bf, 0x2b1b, 0x2b1c, 0x2b50, 0x2b55,
]);

function charVisualWidth(code: number): number {
  for (const [lo, hi] of ZERO_WIDTH_RANGES) {
    if (code >= lo && code <= hi) return 0;
  }
  for (const [lo, hi] of WIDE_RANGES) {
    if (code >= lo && code <= hi) return 2;
  }
  if (WIDE_SINGLES.has(code)) return 2;
  return 1;
}

function visualWidth(text: string): number {
  let width = 0;
  for (const char of text) {
    width += charVisualWidth(char.codePointAt(0) ?? 0);
  }
  return width;
}

function getAlignment(delimiterCell: string): Alignment {
  const t = delimiterCell.trim();
  const left = t.startsWith(':');
  const right = t.endsWith(':');
  if (left && right) return 'center';
  if (left) return 'left';
  if (right) return 'right';
  return 'none';
}

function padCell(text: string, width: number, align: Alignment): string {
  const spaceNeeded = Math.max(0, width - visualWidth(text));
  if (align === 'right') {
    return ' '.repeat(spaceNeeded) + text;
  }
  if (align === 'center') {
    const leftPad = Math.floor(spaceNeeded / 2);
    const rightPad = spaceNeeded - leftPad;
    return ' '.repeat(leftPad) + text + ' '.repeat(rightPad);
  }
  // left or none
  return text + ' '.repeat(spaceNeeded);
}

function formatDelimiterCell(width: number, align: Alignment): string {
  const totalDashes = Math.max(3, width);
  if (align === 'center') {
    return ':' + '-'.repeat(Math.max(1, totalDashes - 2)) + ':';
  }
  if (align === 'left') {
    return ':' + '-'.repeat(Math.max(2, totalDashes - 1));
  }
  if (align === 'right') {
    return '-'.repeat(Math.max(2, totalDashes - 1)) + ':';
  }
  return '-'.repeat(totalDashes);
}

function formatTableBlock(lines: string[]): string[] {
  if (lines.length < 2) return lines;

  const rows = lines.map((line) => ({ raw: line, cells: splitRow(line) }));
  if (rows.length < 2) return lines;

  // Check if second row is delimiter
  const delimiterCells = rows[1].cells;
  if (!isDelimiterRow(delimiterCells)) {
    return lines;
  }

  // Determine num columns
  const numCols = Math.max(...rows.map((r) => r.cells.length));
  if (numCols === 0) return lines;

  // Determine alignments
  const alignments: Alignment[] = [];
  for (let c = 0; c < numCols; c++) {
    const dCell = delimiterCells[c] || '---';
    alignments.push(getAlignment(dCell));
  }

  // Calculate max width per column
  const colWidths: number[] = new Array(numCols).fill(3);
  for (let r = 0; r < rows.length; r++) {
    if (r === 1) continue; // Skip delimiter row for text width calculation
    for (let c = 0; c < numCols; c++) {
      const cellText = rows[r].cells[c] || '';
      colWidths[c] = Math.max(colWidths[c], visualWidth(cellText));
    }
  }

  // Format rows
  const formatted: string[] = [];
  for (let r = 0; r < rows.length; r++) {
    const isDelim = r === 1;
    const rowCells = rows[r].cells;
    const formattedCells: string[] = [];

    for (let c = 0; c < numCols; c++) {
      const align = alignments[c];
      const width = colWidths[c];
      if (isDelim) {
        formattedCells.push(formatDelimiterCell(width, align));
      } else {
        const cellText = rowCells[c] || '';
        formattedCells.push(padCell(cellText, width, align));
      }
    }

    formatted.push(`| ${formattedCells.join(' | ')} |`);
  }

  return formatted;
}

/**
 * Normalize trailing whitespace while preserving Markdown hard breaks:
 * a run of 2+ trailing spaces is a hard break (canonically two spaces),
 * a single trailing space/tab is noise and gets removed.
 */
function normalizeTrailingWhitespace(line: string): string {
  const match = line.match(/[ \t]+$/);
  if (!match) return line;
  return line.slice(0, line.length - match[0].length) + (match[0].length >= 2 ? '  ' : '');
}

function formatContentLine(line: string): string {
  let out = normalizeTrailingWhitespace(line);
  out = out.replace(/^(\s*)[*+] /, '$1- '); // unordered list markers -> '-'
  out = out.replace(/^(\s*)(\d+)\) /, '$1$2. '); // ordered list ')' -> '.'
  if (/^#{1,6}/.test(out)) {
    // ATX heading family: trailing whitespace is insignificant (no hard breaks in headings)
    out = out.replace(/^(#{1,6})([A-Za-z])/, '$1 $2'); // '#Title' -> '# Title'
    out = out.replace(/[ \t]+$/, '');
    out = out.replace(/^(#{1,6})\s+(.+?)\s+#+$/, '$1 $2'); // strip closing '#'-sequence
  }
  return out;
}

function isHeadingLine(line: string): boolean {
  return /^#{1,6} /.test(line);
}

export function formatMarkdownInText(content: string): string {
  if (content === '') return content;
  const eol = content.includes('\r\n') ? '\r\n' : '\n';
  const lines = content.split(/\r?\n/);

  const result: string[] = [];
  let inCodeBlock = false;
  let currentTable: string[] = [];
  // A heading/table/fence just ended: the next non-blank line needs a blank before it
  let pendingBlank = false;

  const pushBlankIfNeeded = () => {
    const prev = result[result.length - 1];
    if (prev !== undefined && prev.trim() !== '') result.push('');
    pendingBlank = false;
  };

  const flushTable = () => {
    if (currentTable.length === 0) return;
    pushBlankIfNeeded();
    result.push(...formatTableBlock(currentTable));
    currentTable = [];
    pendingBlank = true;
  };

  const pushContent = (line: string) => {
    const formatted = formatContentLine(line);
    if (formatted.trim() === '') {
      const prev = result[result.length - 1];
      if (prev === undefined || prev.trim() === '') return; // collapse leading/extra blanks
      result.push('');
      return;
    }
    const heading = isHeadingLine(formatted);
    if (heading || pendingBlank) pushBlankIfNeeded();
    result.push(formatted);
    if (heading) pendingBlank = true;
  };

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed.startsWith('```') || trimmed.startsWith('~~~')) {
      flushTable();
      if (!inCodeBlock) pushBlankIfNeeded();
      // Fence lines get whitespace-normalized; content inside stays byte-identical
      result.push(inCodeBlock ? line : normalizeTrailingWhitespace(line));
      inCodeBlock = !inCodeBlock;
      if (!inCodeBlock) pendingBlank = true;
      continue;
    }

    if (inCodeBlock) {
      result.push(line);
      continue;
    }

    if (trimmed.startsWith('|') && trimmed.slice(1).includes('|')) {
      currentTable.push(line);
      continue;
    }

    flushTable();
    pushContent(line);
  }
  flushTable();

  while (result.length > 0 && result[result.length - 1].trim() === '') result.pop();
  if (result.length === 0) return '';
  return result.join(eol) + eol;
}

function processFile(filePath: string, check: boolean): boolean {
  const content = fs.readFileSync(filePath, 'utf-8');
  const formatted = formatMarkdownInText(content);

  if (formatted === content) return false;
  if (check) return true;

  fs.writeFileSync(filePath, formatted, 'utf-8');
  console.log(`✓ Formatted: ${path.relative(process.cwd(), filePath)}`);
  return true;
}

function collectTargetFiles(args: string[]): string[] {
  if (args.length === 0) return findMdFiles(process.cwd());

  const files: string[] = [];
  for (const arg of args) {
    const abs = path.resolve(arg);
    if (!fs.existsSync(abs)) {
      console.error(`✗ Path not found: ${arg}`);
      process.exitCode = 1;
      continue;
    }
    if (fs.statSync(abs).isDirectory()) {
      files.push(...findMdFiles(abs));
    } else if (abs.endsWith('.md')) {
      files.push(abs);
    }
  }
  return files;
}

if (require.main === module) {
  const argv = process.argv.slice(2);
  const check = argv.includes('--check');
  const targetArgs = argv.filter((a) => a !== '--check');

  const mdFiles = collectTargetFiles(targetArgs);
  const scope = targetArgs.length > 0 ? 'targeted' : 'all';

  if (check) {
    const unformatted = mdFiles.filter((file) => processFile(file, true));
    if (unformatted.length > 0) {
      console.error(`✗ ${unformatted.length} markdown file(s) need formatting:`);
      for (const file of unformatted) {
        console.error(`  - ${path.relative(process.cwd(), file)}`);
      }
      console.error('Run `npm run format` to fix.');
      process.exitCode = 1;
    } else {
      console.log(`✓ All ${mdFiles.length} markdown file(s) formatted (${scope}).`);
    }
  } else {
    console.log(`Found ${mdFiles.length} markdown files (${scope}). Formatting markdown...`);
    let updated = 0;
    for (const file of mdFiles) {
      if (processFile(file, false)) updated++;
    }
    console.log(`✨ ${updated}/${mdFiles.length} markdown file(s) updated.`);
  }
}
