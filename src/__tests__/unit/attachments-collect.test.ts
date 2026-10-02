import { test, expect } from '@playwright/test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { collectAttachments, classifyAttachment } from '../../support/reporter/attachments';
import type { TestResult } from '@playwright/test/reporter';

/**
 * Attachment collection — the reporter used to drop every attachment that had
 * only an in-memory `body` and no `path` (what `testInfo.attach(name, {body})`
 * produces), losing JSON/text captures silently. These pin the new behavior.
 */

function resultWith(
  attachments: Array<{ name: string; contentType: string; path?: string; body?: Buffer }>,
): TestResult {
  return { attachments } as unknown as TestResult;
}

test.describe('collectAttachments', () => {
  test('keeps a file-backed attachment and records its size', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'att-'));
    const file = path.join(dir, 'shot.png');
    fs.writeFileSync(file, Buffer.from([0x89, 0x50, 0x4e, 0x47]));

    const out = collectAttachments(
      resultWith([{ name: 'screenshot', contentType: 'image/png', path: file }]),
      dir,
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.kind).toBe('screenshot');
    expect(out[0]!.size).toBe(4);
    // Binary carries no text preview.
    expect(out[0]!.preview).toBeUndefined();
  });

  test('persists a body-only attachment to disk instead of dropping it', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'att-'));
    const body = Buffer.from(JSON.stringify({ hitCount: 2, hits: [] }));

    const out = collectAttachments(
      resultWith([{ name: 'capture.json', contentType: 'application/json', body }]),
      dir,
    );
    expect(out, 'body-only attachment was dropped').toHaveLength(1);
    expect(out[0]!.size).toBe(body.length);
    // The body was written into the output dir under the attachment's name.
    const written = path.join(dir, 'capture.json');
    expect(fs.existsSync(written)).toBe(true);
    expect(fs.readFileSync(written).toString()).toContain('hitCount');
  });

  test('bakes a text preview for text-ish attachments only', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'att-'));
    const json = collectAttachments(
      resultWith([
        { name: 'net.json', contentType: 'application/json', body: Buffer.from('{"a":1}') },
      ]),
      dir,
    );
    expect(json[0]!.preview).toBe('{"a":1}');
    expect(json[0]!.previewTruncated).toBe(false);

    const png = collectAttachments(
      resultWith([{ name: 'x.png', contentType: 'image/png', body: Buffer.from([1, 2, 3]) }]),
      dir,
    );
    expect(png[0]!.preview).toBeUndefined();
  });

  test('truncates a large text preview and flags it', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'att-'));
    const big = 'x'.repeat(30_000);
    const out = collectAttachments(
      resultWith([{ name: 'big.log', contentType: 'text/plain', body: Buffer.from(big) }]),
      dir,
    );
    expect(out[0]!.preview!.length).toBe(20_000);
    expect(out[0]!.previewTruncated).toBe(true);
  });

  test('a body-only attachment with no output dir is skipped, not crashed on', () => {
    const out = collectAttachments(
      resultWith([{ name: 'x.json', contentType: 'application/json', body: Buffer.from('{}') }]),
      undefined,
    );
    expect(out).toHaveLength(0);
  });

  test('two tests attaching the same basename do not clobber each other', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'att-'));
    const a = collectAttachments(
      resultWith([
        { name: 'network.json', contentType: 'application/json', body: Buffer.from('{"t":"A"}') },
      ]),
      dir,
    );
    const b = collectAttachments(
      resultWith([
        { name: 'network.json', contentType: 'application/json', body: Buffer.from('{"t":"B"}') },
      ]),
      dir,
    );
    // Different content, same name: the second must not overwrite the first.
    expect(a[0]!.relativePath).not.toBe(b[0]!.relativePath);
    const aFile = path.join(dir, 'network.json');
    const bFile = path.resolve(dir, b[0]!.relativePath.replace(/\\/g, '/').split('/').pop()!);
    expect(fs.readFileSync(aFile).toString()).toBe('{"t":"A"}');
    expect(fs.readFileSync(bFile).toString()).toBe('{"t":"B"}');
  });

  test('an identical re-attach reuses the same file instead of duplicating it', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'att-'));
    const body = Buffer.from('{"same":true}');
    const first = collectAttachments(
      resultWith([{ name: 'same.json', contentType: 'application/json', body }]),
      dir,
    );
    const second = collectAttachments(
      resultWith([{ name: 'same.json', contentType: 'application/json', body }]),
      dir,
    );
    expect(second[0]!.relativePath).toBe(first[0]!.relativePath);
    expect(fs.readdirSync(dir).filter((f) => f.startsWith('same'))).toHaveLength(1);
  });

  test('a large file-backed text attachment is previewed from its head only', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'att-'));
    const big = path.join(dir, 'huge.log');
    // 5 MB — far larger than the cap; the reporter must not read it whole.
    fs.writeFileSync(big, 'y'.repeat(5_000_000));

    const out = collectAttachments(
      resultWith([{ name: 'huge.log', contentType: 'text/plain', path: big }]),
      dir,
    );
    expect(out[0]!.size).toBe(5_000_000);
    expect(out[0]!.preview!.length).toBe(20_000);
    expect(out[0]!.previewTruncated).toBe(true);
  });
});

test.describe('classifyAttachment', () => {
  test('routes by name and content type', () => {
    expect(classifyAttachment('trace.zip')).toBe('trace');
    expect(classifyAttachment('screenshot', 'image/png')).toBe('screenshot');
    expect(classifyAttachment('video', 'video/webm')).toBe('video');
    expect(classifyAttachment('network.json', 'application/json')).toBe('other');
  });
});
