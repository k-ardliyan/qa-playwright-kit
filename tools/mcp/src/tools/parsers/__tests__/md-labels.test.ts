/// <reference types="node" />
import assert from 'node:assert/strict';
import { readLabel, readLabelFromSection, splitCellItems, splitRow } from '../md-labels';

// SHAPE 1 — legacy bullet
const bullet = [
  '## Metadata',
  '',
  '- **Module:** finance',
  '- **Feature:** approve-invoice',
  '- **Tags:** #smoke #ui',
].join('\n');

// SHAPE 2 — table row
const table = [
  '## Metadata',
  '',
  '| Field | Nilai |',
  '| --- | --- |',
  '| Module | finance |',
  '| Feature | approve-invoice |',
  '| Tags | `#smoke #ui` |',
].join('\n');

// SHAPE 1b — label heading + bullets underneath
const headingBullets = ['**Langkah:**', '', '1. Buka halaman', '2. Klik tombol'].join('\n');

// SHAPE 2b — table row with <br>
const tableCell = '| Langkah | 1. Buka halaman<br>2. Klik tombol |';

// ── readLabel: both shapes, same answer ──────────────────────────────────────
assert.equal(readLabel(bullet, 'Module'), 'finance');
assert.equal(readLabel(table, 'Module'), 'finance');
assert.equal(readLabel(bullet, 'Feature'), 'approve-invoice');
assert.equal(readLabel(table, 'Feature'), 'approve-invoice');
// backtick-wrapped values must be unwrapped
assert.equal(readLabel(table, 'Tags'), '#smoke #ui');
assert.equal(readLabel(bullet, 'Tags'), '#smoke #ui');
// missing label
assert.equal(readLabel(bullet, 'Risk level'), null);
// case-insensitive
assert.equal(readLabel(table, 'module'), 'finance');
// multi-name lookup (legacy + English alias)
assert.equal(readLabel(bullet, 'Prioritas', 'Priority'), null);
assert.equal(readLabel('- **Prioritas:** high', 'Prioritas', 'Priority'), 'high');

// ── readLabelFromSection: bullet list under a bold label ─────────────────────
assert.deepEqual(readLabelFromSection(headingBullets, ['Langkah', 'Steps']), [
  'Buka halaman',
  'Klik tombol',
]);
// table form of the same field
assert.deepEqual(readLabelFromSection(tableCell, ['Langkah', 'Steps']), [
  'Buka halaman',
  'Klik tombol',
]);
// absent label
assert.deepEqual(readLabelFromSection(bullet, ['Langkah']), []);

// ── splitCellItems ───────────────────────────────────────────────────────────
assert.deepEqual(splitCellItems('1. Buka halaman<br>2. Klik tombol'), [
  'Buka halaman',
  'Klik tombol',
]);
assert.deepEqual(splitCellItems('- A<br>- B<br>- C'), ['A', 'B', 'C']);
// escaped pipe must survive
assert.deepEqual(splitCellItems('a \\| b'), ['a | b']);
// "none" means empty
assert.deepEqual(splitCellItems('none'), []);

// ── splitRow ─────────────────────────────────────────────────────────────────
assert.deepEqual(splitRow('| a | b | c |'), ['a', 'b', 'c']);
assert.deepEqual(splitRow('| Modul \\| X | v |'), ['Modul | X', 'v']);

// ── table header must not be mistaken for a label/value row ──────────────────
const twoTables = [
  '| Test ID | Covers |',
  '| --- | --- |',
  '| `TC-1` | `AC-01` |',
  '',
  '| Role | Access | Expectation |',
  '| --- | --- | --- |',
  '| finance | allow | boleh |',
].join('\n');
// Header row `| Test ID | Covers |` must NOT be read as label "Test ID" → "Covers".
assert.equal(readLabel(twoTables, 'Test ID'), null);
assert.equal(
  readLabel(twoTables, 'Role'),
  null,
  'Role lives in a 3-col table, not a 2-col label/value row',
);
// A real 2-col label/value table still reads.
assert.equal(
  readLabel('| Field | Nilai |\n| --- | --- |\n| Test ID | `TC-9` |', 'Test ID'),
  'TC-9',
);
// …and the 3-col table's own reader is unaffected (Access Matrix stays its own parser).

console.log('md-labels: ok');
