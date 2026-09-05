/**
 * Standalone Node assert harness (not a Playwright test).
 * file-content-core (demo fixtures only — not product schema).
 * Run: npx tsx src/support/pw/__tests__/file-content-core.test.ts
 */
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { resolveUploadFixturePath } from '../files';
import {
  assertDownloadedEnvelope,
  assertExcelHeaders,
  assertPdfContains,
  assertPdfMatches,
  assertStringsContain,
  detectFileKind,
  detectMagic,
  extractPdfText,
  fixturePath,
  readExcelSummary,
} from '../file-content-core';

function test(name: string, fn: () => void | Promise<void>): void {
  const run = async () => {
    try {
      await fn();
      process.stdout.write(`  ✓ ${name}\n`);
    } catch (err) {
      process.stdout.write(`  ✗ ${name}\n`);
      throw err;
    }
  };
  const g = globalThis as unknown as { __fileCoreTests?: Array<() => Promise<void>> };
  g.__fileCoreTests ??= [];
  g.__fileCoreTests.push(run);
}

process.stdout.write('\nfile-content-core tests\n');

test('fixturePath resolves sample pdf', () => {
  const p = fixturePath('pdf', 'sample-text.pdf');
  assert.ok(fs.existsSync(p), `missing ${p}`);
});

test('resolve upload fixture rejects absolute and traversal paths', () => {
  assert.throws(() => resolveUploadFixturePath(path.resolve('secret.txt')), /must be relative/);
  assert.throws(() => resolveUploadFixturePath('../secret.txt'), /stay inside/);
});

test('detectMagic pdf', () => {
  const buf = fs.readFileSync(fixturePath('pdf', 'sample-text.pdf'));
  assert.equal(detectMagic(buf), 'pdf');
});

test('detectMagic png', () => {
  const buf = fs.readFileSync(fixturePath('images', 'sample.png'));
  assert.equal(detectMagic(buf), 'png');
});

test('detectFileKind xlsx via extension+zip', () => {
  const p = fixturePath('excel', 'sample-headers.xlsx');
  assert.equal(detectFileKind(p), 'xlsx');
});

test('extractPdfText contains demo tokens only', async () => {
  const text = await extractPdfText(fixturePath('pdf', 'sample-text.pdf'));
  assert.match(text, /QA-KIT-SAMPLE-PDF/);
  assert.match(text, /TOKEN-ALPHA/);
});

test('assertPdfContains demo tokens', async () => {
  await assertPdfContains(fixturePath('pdf', 'sample-text.pdf'), [
    'QA-KIT-SAMPLE-PDF',
    'TOKEN-ALPHA',
  ]);
});

test('assertPdfMatches accepts RegExp from scenario', async () => {
  await assertPdfMatches(fixturePath('pdf', 'sample-text.pdf'), [
    'QA-KIT-SAMPLE-PDF',
    /TOKEN-ALPHA/,
  ]);
});

test('assertStringsContain reports missing', () => {
  assert.throws(() => assertStringsContain('hello', ['hello', 'missing-token']), /missing-token/);
});

test('readExcelSummary demo headers', async () => {
  const summary = await readExcelSummary(fixturePath('excel', 'sample-headers.xlsx'));
  assert.deepEqual(summary.headers, ['ColA', 'ColB', 'ColC']);
  assert.ok(summary.sheetNames.length >= 1);
});

test('assertExcelHeaders demo', async () => {
  await assertExcelHeaders(fixturePath('excel', 'sample-headers.xlsx'), ['ColA', 'ColB']);
});

test('assertDownloadedEnvelope minBytes', () => {
  assertDownloadedEnvelope(fixturePath('pdf', 'sample-text.pdf'), {
    kind: 'pdf',
    ext: '.pdf',
    minBytes: 10,
  });
});

test('invalid empty fails minBytes', () => {
  assert.throws(
    () =>
      assertDownloadedEnvelope(fixturePath('invalid', 'empty.bin'), {
        minBytes: 1,
      }),
    /minBytes/,
  );
});

test('dropFixture helper is exported and callable on locator mockup', async () => {
  let droppedFiles: string[] = [];
  const fakeLocator = {
    drop: async ({ files }: { files: string[] }) => {
      droppedFiles = files;
    },
  };
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { dropFixture } = require('../files') as {
    dropFixture: (locator: unknown, relPath: string) => Promise<void>;
  };
  await dropFixture(fakeLocator, 'pdf/sample-text.pdf');
  assert.equal(droppedFiles.length, 1);
  assert.match(droppedFiles[0], /sample-text\.pdf$/);
});

(async () => {
  const g = globalThis as unknown as { __fileCoreTests?: Array<() => Promise<void>> };
  const tests = g.__fileCoreTests ?? [];
  for (const t of tests) {
    await t();
  }
  process.stdout.write('file-content-core: all passed\n');
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
