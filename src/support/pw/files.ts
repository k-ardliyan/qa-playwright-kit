/**
 * Playwright file download/upload helpers + content asserts.
 *
 * Upload is fixture-first (tests/data/). Content needles/headers come from
 * the scenario — never a patented business field list.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Locator, Page } from '@playwright/test';
import {
  assertDownloadedEnvelope as assertEnvelopeCore,
  assertExcelHeaders as assertExcelHeadersCore,
  assertFileMagic as assertFileMagicCore,
  assertPdfContains as assertPdfContainsCore,
  assertPdfMatches as assertPdfMatchesCore,
  detectFileKind,
  findRepoRoot,
  fixturePath,
  type FileKind,
} from './file-content-core';

export {
  assertStringsContain,
  assertTextMatches,
  detectMagic,
  detectFileKind,
  extractPdfText,
  fixturePath,
  findRepoRoot,
  inspectFileLocal,
  readExcelSummary,
  type ExcelSummary,
  type FileKind,
  type InspectFileResult,
} from './file-content-core';

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

/**
 * Resolve a fixture path for upload.
 * Accepts: absolute path, `tests/data/...`, or relative under tests/data (e.g. `pdf/sample.pdf`).
 */
export function resolveUploadFixturePath(relativeOrAbsolute: string): string {
  const raw = relativeOrAbsolute.trim();
  if (!raw) {
    throw new Error('Upload fixture path must be a non-empty string');
  }
  if (path.isAbsolute(raw)) {
    return raw;
  }
  const normalized = raw.replace(/\\/g, '/');
  if (normalized === 'tests/data' || normalized.startsWith('tests/data/')) {
    return path.join(findRepoRoot(), ...normalized.split('/').filter(Boolean));
  }
  return fixturePath(...normalized.split('/').filter(Boolean));
}

/**
 * Wait for a download triggered by `trigger`, save under test-results/downloads.
 * Uses path.basename on suggestedFilename to avoid path traversal in suggested names.
 */
export async function downloadAndSave(
  page: Page,
  trigger: () => Promise<void>,
  options?: { dir?: string },
): Promise<{ path: string; suggestedFilename: string; size: number }> {
  const downloadPromise = page.waitForEvent('download');
  await trigger();
  const download = await downloadPromise;
  const suggestedFilename = path.basename(download.suggestedFilename() || 'download.bin');
  const dir = options?.dir ?? path.join(findRepoRoot(), 'artifacts', 'test-results', 'downloads');
  ensureDir(dir);
  const target = path.join(dir, suggestedFilename);
  await download.saveAs(target);
  const size = fs.statSync(target).size;
  return { path: target, suggestedFilename, size };
}

/** Upload a file from `tests/data/` (or absolute path). */
export async function uploadFixture(locator: Locator, relativeFixturePath: string): Promise<void> {
  const absolute = resolveUploadFixturePath(relativeFixturePath);
  if (!fs.existsSync(absolute)) {
    throw new Error(`Upload fixture not found: ${absolute}`);
  }
  await locator.setInputFiles(absolute);
}

/**
 * Click a control that opens the browser file chooser, then set fixture file(s).
 * Prefer this when the real `<input type=file>` is hidden behind a button.
 */
export async function uploadViaChooser(
  page: Page,
  openChooser: () => Promise<void>,
  relativeFixturePath: string | string[],
): Promise<void> {
  const paths = (
    Array.isArray(relativeFixturePath) ? relativeFixturePath : [relativeFixturePath]
  ).map((p) => resolveUploadFixturePath(p));
  for (const p of paths) {
    if (!fs.existsSync(p)) {
      throw new Error(`Upload fixture not found: ${p}`);
    }
  }
  const chooserPromise = page.waitForEvent('filechooser');
  await openChooser();
  const chooser = await chooserPromise;
  await chooser.setFiles(paths);
}

export async function assertDownloadedEnvelope(
  filePath: string,
  expect: { kind?: FileKind; ext?: RegExp | string; minBytes?: number },
): Promise<void> {
  assertEnvelopeCore(filePath, expect);
}

/** Scenario-owned needles — pass tokens from requirement Expected Result only. */
export async function assertPdfContains(filePath: string, needles: string[]): Promise<void> {
  await assertPdfContainsCore(filePath, needles);
}

/** Scenario-owned string or RegExp patterns. */
export async function assertPdfMatches(
  filePath: string,
  patterns: Array<string | RegExp>,
): Promise<void> {
  await assertPdfMatchesCore(filePath, patterns);
}

/** Scenario-owned header labels. */
export async function assertExcelHeaders(
  filePath: string,
  headers: string[],
  sheet?: string | number,
): Promise<void> {
  await assertExcelHeadersCore(filePath, headers, sheet);
}

export function assertFileMagic(filePath: string, expected: FileKind | FileKind[]): void {
  assertFileMagicCore(filePath, expected);
}

export function getFileKind(filePath: string): FileKind {
  return detectFileKind(filePath);
}
