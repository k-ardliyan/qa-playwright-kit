/**
 * Shared markdown label reader — dual-mode (bullet + table).
 *
 * The format contract: a field is written EITHER as
 *
 *   - **Label:** value            (legacy bullet)
 *   **Label:**                    (label heading; values as bullets below)
 *
 * OR as a two-column table row
 *
 *   | Label | value |             (table form)
 *
 * This module is the ONLY place that knows those shapes. Every parser
 * (requirement, plan, validator, normalizer) calls it instead of carrying
 * its own regex — that duplication is what made the format rigid.
 *
 * @module tools/mcp/src/tools/parsers/md-labels
 */

/** Leading list/numbering marker on a bullet item. */
const ITEM_PREFIX = /^(?:[-*]|\d+[.)])\s+/;

/** Strip bold markers, `\|` escapes and surrounding whitespace. */
function clean(value: string): string {
  return value
    .trim()
    .replace(/^\*\*|\*\*$/g, '')
    .replace(/\\\|/g, '|')
    .trim();
}

/**
 * Unwrap a value that is ENTIRELY wrapped in backticks: `` `TC-001` `` → `TC-001`.
 *
 * Only applied when the first and last characters are both backticks and no
 * other backtick sits between them, so an inline code span inside prose
 * (`URL diarahkan ke `/dashboard``) keeps its backticks instead of losing the
 * closing one. Cell-level cleaning uses `clean()`, which never strips them.
 */
function unwrapCode(value: string): string {
  const t = value.trim();
  if (t.length >= 2 && t.startsWith('`') && t.endsWith('`') && !t.slice(1, -1).includes('`')) {
    return t.slice(1, -1).trim();
  }
  return t;
}

/** Split one table row into its cells (keeping escaped `\|` inside a cell). */
export function splitRow(line: string): string[] {
  const inner = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return inner.split(/(?<!\\)\|/).map((c) => unwrapCode(clean(c)));
}

/** True when the line is a table row (`| a | b |`). */
function isRow(line: string): boolean {
  return /^\s*\|.*\|\s*$/.test(line);
}

/** True when the line is a table separator (`| --- | --- |`). */
function isSeparator(line: string): boolean {
  return /^\s*\|[\s:|-]+\|\s*$/.test(line) && /-/.test(line);
}

/** Build the bullet-form matcher for one or more accepted label names. */
function labelPattern(labels: readonly string[]): RegExp {
  const alt = labels.map((l) => l.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  return new RegExp(`^\\s*(?:[-*]\\s+)?\\*\\*(?:${alt}):\\*\\*\\s*(.*)$`, 'i');
}

/**
 * Read one label's value from a markdown text block.
 *
 * Accepts BOTH shapes:
 *   `- **Module:** finance`      (bullet)
 *   `| Module | finance |`       (table row — value in column 2)
 *
 * Only two-column rows are considered, so a wider table (e.g. the Access
 * Matrix) can never be mistaken for a label/value pair. Header rows (a row
 * immediately followed by a `| --- | --- |` separator) are skipped, so
 * `| Field | Nilai |` never returns `Nilai`.
 *
 * @returns the value with backticks stripped, or null when the label is absent
 */
export function readLabel(text: string, ...labels: string[]): string | null {
  const re = labelPattern(labels);
  const lines = text.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const bullet = line.match(re);
    if (bullet) {
      const value = unwrapCode(clean(bullet[1]));
      if (value) return value;
    }
    if (isRow(line) && !isSeparator(line)) {
      // Skip table headers: the next line is the `| --- |` separator.
      if (i + 1 < lines.length && isSeparator(lines[i + 1])) continue;
      const cells = splitRow(line);
      // Only 2-column rows are label/value pairs. A 3+ column row belongs to a
      // real table (Access Matrix, Coverage Gaps) and is parsed by its own reader.
      if (cells.length === 2) {
        const head = clean(cells[0]).toLowerCase();
        if (labels.some((l) => l.toLowerCase() === head)) {
          const value = clean(cells[1]);
          if (value) return value;
        }
      }
    }
  }
  return null;
}

/**
 * Read a list-valued label. Accepts:
 *   - a table row whose cell uses `<br>` separators
 *   - `**Label:**` on its own line, followed by bullet/numbered lines
 *
 * @returns the items with list markers and a literal `none` removed
 */
export function readLabelFromSection(text: string, labels: readonly string[]): string[] {
  const lines = text.split(/\r?\n/);
  const re = labelPattern(labels);

  // Table form first: one row, items separated by `<br>`.
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!isRow(line) || isSeparator(line)) continue;
    // Header rows carry column names, never values.
    if (i + 1 < lines.length && isSeparator(lines[i + 1])) continue;
    const cells = splitRow(line);
    if (cells.length !== 2) continue;
    const head = clean(cells[0]).toLowerCase();
    if (labels.some((l) => l.toLowerCase() === head)) {
      return splitCellItems(cells[1]);
    }
  }

  // Bullet form: the label line, then the items that follow it.
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(re);
    if (!m) continue;
    const inline = clean(m[1]);
    if (inline) return splitCellItems(inline);
    const items: string[] = [];
    for (let j = i + 1; j < lines.length; j++) {
      const t = lines[j].trim();
      // A blank line ends the list — but only once it has started, because the
      // real template writes `**Langkah:**`, a blank line, then the items.
      if (!t) {
        if (items.length > 0) break;
        continue;
      }
      if (/^\*\*[^*]+:\*\*/.test(t) || /^#{2,}/.test(t) || isRow(t)) break;
      items.push(t.replace(ITEM_PREFIX, '').trim());
    }
    return items.filter(Boolean);
  }
  return [];
}

/**
 * Split a cell value into items: `<br>` separated, list markers and a literal
 * `none` stripped. `none` means "no items", never an item called "none".
 */
export function splitCellItems(cell: string): string[] {
  return cell
    .split(/<br\s*\/?>/i)
    .map((part) => unwrapCode(clean(part).replace(ITEM_PREFIX, '').trim()))
    .filter((part) => part && part.toLowerCase() !== 'none' && part !== '-');
}

/**
 * True when a value's inline-code spans are structurally broken — the
 * free-hand authoring artifact behind `| Covers | AC-03\`, \`AC-16 |` and
 * `` | Layer | \`FE\`\` \`BE\` | ``. The parsers strip backticks silently, so
 * without this check the malformed authoring is invisible and the rendered
 * document lies.
 *
 * Deliberately local, tuned to zero false positives on canonical cells:
 * balanced multi-code lists (`` `AC-01`, `AC-02` ``), prose+code
 * ("URL ke `/dashboard`"), and the template's whitespace-only literal
 * (`` literal:`   ` `` — a spaces-only input value) stay clean; only an
 * unclosed span, an EXACTLY-empty span (adjacent ticks), or a span wrapping
 * just separator punctuation is broken.
 */
export function hasBrokenInlineCode(value: string): boolean {
  const segments = value.split('`');
  if (segments.length === 1) return false; // no backticks at all
  // An even segment count means the span never closes.
  if (segments.length % 2 === 0) return true;
  // Interior segments only: the first/last segments are outside any span and
  // are legitimately empty. Adjacent ticks create an EMPTY segment wherever
  // they sit, so the emptiness check must scan every interior position — not
  // just the odd (inside-span) ones.
  for (let i = 1; i < segments.length - 1; i++) {
    const seg = segments[i]!;
    if (seg.length === 0) return true; // adjacent ticks — empty code span
    if (i % 2 === 1 && /^[,;.-]+$/.test(seg.trim())) return true; // span wrapping only separators
  }
  return false;
}

/**
 * 1-based line numbers of table rows carrying a broken inline-code value
 * (see {@link hasBrokenInlineCode}). Header rows are exempt — column labels
 * are prose, never values.
 */
export function findBrokenCodeRows(text: string): number[] {
  const lines = text.split(/\r?\n/);
  const out: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (!isRow(line) || isSeparator(line)) continue;
    if (i + 1 < lines.length && isSeparator(lines[i + 1]!)) continue;
    if (splitRow(line).some(hasBrokenInlineCode)) out.push(i + 1);
  }
  return out;
}
