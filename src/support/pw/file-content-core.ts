/**
 * Pure file helpers (no Playwright) — magic bytes, fixture paths, PDF/Excel extract.
 *
 * Content matching is **scenario-driven**: callers pass needles/headers from the
 * requirement. This module does not patent business fields.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

export type FileKind = 'pdf' | 'xlsx' | 'zip' | 'png' | 'jpg' | 'gif' | 'csv' | 'txt' | 'unknown';

const REPO_MARKERS = ['config/qa-kit.workspace.json', 'tools/mcp'];
const MAX_HOPS = 12;

/** Resolve repository root. */
export function findRepoRoot(start: string = process.cwd()): string {
  let dir = path.resolve(start);
  for (let i = 0; i < MAX_HOPS; i += 1) {
    if (REPO_MARKERS.some((marker) => fs.existsSync(path.join(dir, ...marker.split('/'))))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return path.resolve(start);
}

/** Absolute path under `tests/data/`. */
export function fixturePath(...parts: string[]): string {
  const root = findRepoRoot();
  return path.join(root, 'tests', 'data', ...parts);
}

/** Detect common file kinds from magic bytes (envelope layer). */
export function detectMagic(buffer: Buffer): FileKind {
  if (buffer.length >= 5 && buffer.subarray(0, 5).toString('ascii') === '%PDF-') {
    return 'pdf';
  }
  if (
    buffer.length >= 4 &&
    buffer[0] === 0x50 &&
    buffer[1] === 0x4b &&
    buffer[2] === 0x03 &&
    buffer[3] === 0x04
  ) {
    // ZIP container — xlsx is zip; distinguish by extension when path available; default zip
    return 'zip';
  }
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  ) {
    return 'png';
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'jpg';
  }
  if (buffer.length >= 6 && buffer.subarray(0, 6).toString('ascii') === 'GIF87a') {
    return 'gif';
  }
  if (buffer.length >= 6 && buffer.subarray(0, 6).toString('ascii') === 'GIF89a') {
    return 'gif';
  }
  return 'unknown';
}

/**
 * Prefer extension when magic is zip (xlsx) or ambiguous.
 */
export function detectFileKind(filePath: string, buffer?: Buffer): FileKind {
  const buf = buffer ?? fs.readFileSync(filePath);
  const magic = detectMagic(buf);
  const ext = path.extname(filePath).toLowerCase();
  if (magic === 'zip' && (ext === '.xlsx' || ext === '.xlsm')) {
    return 'xlsx';
  }
  if (magic === 'pdf') return 'pdf';
  if (magic !== 'unknown') return magic;
  if (ext === '.pdf') return 'pdf';
  if (ext === '.xlsx' || ext === '.xlsm') return 'xlsx';
  if (ext === '.csv') return 'csv';
  if (ext === '.txt') return 'txt';
  if (ext === '.png') return 'png';
  if (ext === '.jpg' || ext === '.jpeg') return 'jpg';
  if (ext === '.gif') return 'gif';
  if (ext === '.zip') return 'zip';
  return 'unknown';
}

export interface InspectFileResult {
  filePath: string;
  filename: string;
  size: number;
  kind: FileKind;
  magic: FileKind;
}

export function inspectFileLocal(filePath: string): InspectFileResult {
  const absolute = path.resolve(filePath);
  const buf = fs.readFileSync(absolute);
  const magic = detectMagic(buf);
  const kind = detectFileKind(absolute, buf);
  return {
    filePath: absolute,
    filename: path.basename(absolute),
    size: buf.length,
    kind,
    magic,
  };
}

/** Extract plain text from a PDF. Returns raw text for scenario-owned matching. */
export async function extractPdfText(filePath: string, maxChars?: number): Promise<string> {
  const absolute = path.resolve(filePath);
  const data = new Uint8Array(fs.readFileSync(absolute));
  // pdf-parse v2 class API
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { PDFParse } = require('pdf-parse') as {
    PDFParse: new (opts: { data: Uint8Array }) => {
      getText: () => Promise<{ text?: string }>;
      destroy?: () => Promise<void>;
    };
  };
  const parser = new PDFParse({ data });
  try {
    const result = await parser.getText();
    let text = typeof result?.text === 'string' ? result.text : '';
    if (typeof maxChars === 'number' && maxChars >= 0 && text.length > maxChars) {
      text = text.slice(0, maxChars);
    }
    return text;
  } finally {
    if (typeof parser.destroy === 'function') {
      await parser.destroy();
    }
  }
}

export interface ExcelSummary {
  sheetNames: string[];
  headers: string[];
  sampleRows: string[][];
}

/** Read sheet names, header row, and sample data rows (scenario defines expected headers). */
export async function readExcelSummary(
  filePath: string,
  options?: { sheet?: string | number; maxRows?: number },
): Promise<ExcelSummary> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ExcelJS = require('exceljs') as typeof import('exceljs');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(path.resolve(filePath));
  const sheetNames = workbook.worksheets.map((ws) => ws.name);
  let worksheet = workbook.worksheets[0];
  if (options?.sheet !== undefined) {
    if (typeof options.sheet === 'number') {
      worksheet = workbook.worksheets[options.sheet] ?? worksheet;
    } else {
      worksheet = workbook.getWorksheet(options.sheet) ?? worksheet;
    }
  }
  if (!worksheet) {
    return { sheetNames, headers: [], sampleRows: [] };
  }

  const maxRows = options?.maxRows ?? 20;
  const rows: string[][] = [];
  worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rows.length >= maxRows + 1) return; // header + samples
    const values = Array.isArray(row.values) ? row.values.slice(1) : [];
    rows.push(values.map((v) => (v == null ? '' : String(v))));
    void rowNumber;
  });

  const headers = rows[0] ?? [];
  const sampleRows = rows.slice(1);
  return { sheetNames, headers, sampleRows };
}

/**
 * Assert every needle appears in haystack. Needles are **caller-defined**
 * (from the scenario) — never a fixed product schema.
 */
export function assertStringsContain(haystack: string, needles: string[]): void {
  const missing = needles.filter((n) => n.length > 0 && !haystack.includes(n));
  if (missing.length > 0) {
    throw new Error(
      `Expected text to contain scenario tokens (missing: ${JSON.stringify(missing)}). ` +
        `Haystack length=${haystack.length}.`,
    );
  }
}

/** Scenario-owned patterns: string substring or RegExp. */
export function assertTextMatches(haystack: string, patterns: Array<string | RegExp>): void {
  const missing: string[] = [];
  for (const p of patterns) {
    if (typeof p === 'string') {
      if (p.length > 0 && !haystack.includes(p)) missing.push(p);
    } else if (!p.test(haystack)) {
      missing.push(String(p));
    }
  }
  if (missing.length > 0) {
    throw new Error(
      `Expected text to match scenario patterns (failed: ${JSON.stringify(missing)}). ` +
        `Haystack length=${haystack.length}.`,
    );
  }
}

export async function assertPdfContains(filePath: string, needles: string[]): Promise<void> {
  const text = await extractPdfText(filePath);
  assertStringsContain(text, needles);
}

/** Like assertPdfContains but allows RegExp patterns from the scenario. */
export async function assertPdfMatches(
  filePath: string,
  patterns: Array<string | RegExp>,
): Promise<void> {
  const text = await extractPdfText(filePath);
  assertTextMatches(text, patterns);
}

export async function assertExcelHeaders(
  filePath: string,
  headers: string[],
  sheet?: string | number,
): Promise<void> {
  const summary = await readExcelSummary(filePath, { sheet });
  const missing = headers.filter((h) => !summary.headers.includes(h));
  if (missing.length > 0) {
    throw new Error(
      `Expected Excel headers to include scenario labels (missing: ${JSON.stringify(missing)}). ` +
        `Actual headers: ${JSON.stringify(summary.headers)}.`,
    );
  }
}

export function assertFileMagic(filePath: string, expected: FileKind | FileKind[]): void {
  const kind = detectFileKind(filePath);
  const list = Array.isArray(expected) ? expected : [expected];
  if (!list.includes(kind)) {
    throw new Error(`Expected file kind ${JSON.stringify(list)}, got '${kind}' for ${filePath}`);
  }
}

export function assertDownloadedEnvelope(
  filePath: string,
  expect: { kind?: FileKind; ext?: RegExp | string; minBytes?: number },
): void {
  const absolute = path.resolve(filePath);
  if (!fs.existsSync(absolute)) {
    throw new Error(`Downloaded file not found: ${absolute}`);
  }
  const stat = fs.statSync(absolute);
  const minBytes = expect.minBytes ?? 1;
  if (stat.size < minBytes) {
    throw new Error(`File size ${stat.size} < minBytes ${minBytes}: ${absolute}`);
  }
  if (expect.ext !== undefined) {
    const name = path.basename(absolute);
    const ok = typeof expect.ext === 'string' ? name.endsWith(expect.ext) : expect.ext.test(name);
    if (!ok) {
      throw new Error(`Filename '${name}' does not match ext ${String(expect.ext)}`);
    }
  }
  if (expect.kind !== undefined) {
    assertFileMagic(absolute, expect.kind);
  }
}
