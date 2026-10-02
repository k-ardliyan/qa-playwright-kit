import type { TestResult } from '@playwright/test/reporter';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { logger } from '../../utils/logger';
import {
  resolveWorkspaceReportDir,
  resolveWorkspaceTestResultsDir,
} from '../../shared/workspace-paths';
import type {
  AttachmentKind,
  CollectedAttachment,
  CollectedTestData,
} from '../custom-dashboard/types';
import { toReportRelativePath } from '../custom-dashboard/shared';

export function resolveReportDir(): string {
  return resolveWorkspaceReportDir();
}

export function reportPaths(): {
  reportDir: string;
  dashboardPath: string;
  summaryPath: string;
  htmlReportDir: string;
  attachmentsDir: string;
  testResultsDir: string;
} {
  const reportDir = resolveReportDir();
  return {
    reportDir,
    dashboardPath: path.join(reportDir, 'custom-dashboard.html'),
    summaryPath: path.join(reportDir, 'test-summary.json'),
    htmlReportDir: path.join(reportDir, 'html'),
    attachmentsDir: path.join(reportDir, 'attachments'),
    testResultsDir: resolveWorkspaceTestResultsDir(),
  };
}

export function reportDir(): string {
  return reportPaths().reportDir;
}
export function dashboardPath(): string {
  return reportPaths().dashboardPath;
}
export function summaryPath(): string {
  return reportPaths().summaryPath;
}
export function htmlReportDir(): string {
  return reportPaths().htmlReportDir;
}
export function attachmentsDir(): string {
  return reportPaths().attachmentsDir;
}

export const KIND_SUBDIR: Record<'screenshot' | 'video' | 'trace', string> = {
  screenshot: 'screenshots',
  video: 'videos',
  trace: 'traces',
};

export function safeFilePrefix(test: CollectedTestData): string {
  return (
    (test.logicalKey || test.testId || test.title).replace(/[^a-zA-Z0-9-]/g, '_').slice(0, 60) ||
    'test'
  );
}

/**
 * Copy screenshot / video / trace into artifacts/reports/attachments/* and rewrite relativePath
 * so standalone custom-dashboard.html can open evidence next to the report.
 */
export function resolveAttachmentSourcePath(relativeOrAbs: string): string | null {
  const normalized = relativeOrAbs.replace(/\\/g, '/');
  const candidates: string[] = [];
  const paths = reportPaths();

  if (path.isAbsolute(relativeOrAbs)) {
    candidates.push(relativeOrAbs);
  } else {
    candidates.push(path.resolve(paths.reportDir, normalized));
    candidates.push(path.resolve(process.cwd(), normalized));
    candidates.push(path.resolve(paths.testResultsDir, path.basename(normalized)));
    // Already-materialized path re-run safety
    if (normalized.startsWith('attachments/')) {
      candidates.push(path.resolve(paths.reportDir, normalized));
    }
  }

  for (const candidate of candidates) {
    try {
      if (candidate && fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        return candidate;
      }
    } catch {
      // ignore stat errors
    }
  }
  return null;
}

export function materializeAttachments(tests: CollectedTestData[]): void {
  try {
    for (const sub of Object.values(KIND_SUBDIR)) {
      const dir = path.join(attachmentsDir(), sub);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    }

    for (const test of tests) {
      const prefix = safeFilePrefix(test);
      for (const attachment of test.attachments) {
        if (
          attachment.kind !== 'screenshot' &&
          attachment.kind !== 'video' &&
          attachment.kind !== 'trace'
        ) {
          continue;
        }
        if (!attachment.relativePath) continue;

        // Skip if already under reports/attachments
        if (attachment.relativePath.replace(/\\/g, '/').startsWith('attachments/')) {
          const already = path.resolve(reportDir(), attachment.relativePath);
          if (fs.existsSync(already)) continue;
        }

        const absPath = resolveAttachmentSourcePath(attachment.relativePath);
        if (!absPath) continue;

        const destName = `${prefix}__${path.basename(absPath)}`;
        const sub = KIND_SUBDIR[attachment.kind];
        const uniqueDest = path.join(attachmentsDir(), sub, destName);
        try {
          fs.copyFileSync(absPath, uniqueDest);
          attachment.relativePath = `attachments/${sub}/${destName}`.replace(/\\/g, '/');
        } catch (copyErr) {
          logger.warn('Failed to copy attachment', {
            kind: attachment.kind,
            from: absPath,
            err: String(copyErr),
          });
        }
      }
    }
  } catch (err) {
    logger.warn('Failed to materialize attachments into reports/attachments/', {
      err: String(err),
    });
  }
}

export function classifyAttachment(name: string, contentType?: string): AttachmentKind {
  const normalizedName = name.toLowerCase();
  const normalizedType = (contentType ?? '').toLowerCase();

  if (normalizedName.includes('trace')) {
    return 'trace';
  }
  if (normalizedName.includes('screenshot') || normalizedType.startsWith('image/')) {
    return 'screenshot';
  }
  if (normalizedName.includes('video') || normalizedType.startsWith('video/')) {
    return 'video';
  }

  return 'other';
}

/** Text-ish captures get an inline head so the report can show them without a download. */
function isTextLike(name: string, contentType?: string): boolean {
  const type = (contentType ?? '').toLowerCase();
  if (type.startsWith('text/')) return true;
  if (type.includes('json') || type.includes('xml') || type.includes('javascript')) return true;
  return /\.(json|log|txt|csv|xml|yaml|yml|md|har)$/i.test(name);
}

/** Cap on an inline preview — big enough to read a capture, small enough to embed. */
const PREVIEW_MAX_CHARS = 20_000;

/** Distinguishes two same-named captures from different tests without a uuid suffix. */
function contentSuffix(body: Buffer): string {
  return createHash('sha1').update(body).digest('hex').slice(0, 8);
}

/** Slice to the cap and report whether anything was left behind. */
function previewFields(raw: string): { preview: string; previewTruncated: boolean } {
  return {
    preview: raw.slice(0, PREVIEW_MAX_CHARS),
    previewTruncated: raw.length > PREVIEW_MAX_CHARS,
  };
}

/**
 * Read only the head of a file. A 5 MB log must never be slurped whole just to
 * show its first lines, so the read is bounded before the bytes are decoded.
 */
function readPreviewHead(absPath: string): { preview: string; previewTruncated: boolean } | null {
  try {
    const size = fs.statSync(absPath).size;
    // 4 bytes per char is the UTF-8 worst case, so this always covers the cap.
    const bytesToRead = Math.min(size, (PREVIEW_MAX_CHARS + 1) * 4);
    const fd = fs.openSync(absPath, 'r');
    let raw: string;
    try {
      const buf = Buffer.alloc(bytesToRead);
      const read = fs.readSync(fd, buf, 0, bytesToRead, 0);
      raw = buf.subarray(0, read).toString('utf8');
    } finally {
      fs.closeSync(fd);
    }
    const fields = previewFields(raw);
    // The file may simply be longer than the bytes we were willing to read.
    return { ...fields, previewTruncated: fields.previewTruncated || size > bytesToRead };
  } catch {
    return null;
  }
}

/**
 * Collect a test's attachments for the report.
 *
 * `outputDir` (when given) receives every attachment that has no file on disk —
 * `testInfo.attach(name, { body })` produces an in-memory buffer only, and the
 * old implementation dropped those silently, losing JSON/network captures.
 * Same-named captures with different content get a content-hash suffix;
 * identical re-attaches reuse the existing file.
 */
export function collectAttachments(result: TestResult, outputDir?: string): CollectedAttachment[] {
  const attachments: CollectedAttachment[] = [];

  for (const attachment of result.attachments) {
    const name = attachment.name;
    const kind = classifyAttachment(name, attachment.contentType);
    const body = (attachment as { body?: Buffer }).body;

    // File-backed: read metadata (and a text head) from disk. The path is
    // recorded even when the file is not on disk YET — Playwright hands us the
    // path at onTestEnd, and materializeAttachments copies it later. Requiring
    // existsSync() here silently dropped every trace/screenshot in that window.
    if (attachment.path) {
      const absPath = attachment.path;
      const onDisk = fs.existsSync(absPath);
      let size: number | undefined;
      if (onDisk) {
        try {
          size = fs.statSync(absPath).size;
        } catch {
          size = undefined;
        }
      }
      const head =
        onDisk && isTextLike(name, attachment.contentType) ? readPreviewHead(absPath) : null;
      attachments.push({
        name,
        contentType: attachment.contentType,
        relativePath: toReportRelativePath(absPath),
        kind,
        ...(size !== undefined ? { size } : {}),
        ...(head ?? {}),
      });
      continue;
    }

    // Body-only: persist it, or skip when there is nowhere to write.
    if (!body || !outputDir) continue;
    const safeName = path.basename(name).replace(/[\\/]/g, '_') || 'attachment';
    let dest = path.join(outputDir, safeName);
    try {
      fs.mkdirSync(outputDir, { recursive: true });
      if (fs.existsSync(dest)) {
        const existing = fs.readFileSync(dest);
        if (!existing.equals(body)) {
          const ext = path.extname(safeName);
          const stem = safeName.slice(0, safeName.length - ext.length);
          dest = path.join(outputDir, `${stem}-${contentSuffix(body)}${ext}`);
        }
      }
      if (!fs.existsSync(dest)) fs.writeFileSync(dest, body);
    } catch {
      continue;
    }

    const head = isTextLike(name, attachment.contentType)
      ? previewFields(body.toString('utf8'))
      : null;
    attachments.push({
      name,
      contentType: attachment.contentType,
      relativePath: toReportRelativePath(dest),
      kind,
      size: body.length,
      ...(head ?? {}),
    });
  }

  return attachments;
}

export function ensureReportDirectory(): void {
  try {
    fs.mkdirSync(reportDir());
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code !== 'EEXIST') {
      throw error;
    }
  }
}
