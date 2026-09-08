import type { TestResult } from '@playwright/test/reporter';
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

export function collectAttachments(result: TestResult): CollectedAttachment[] {
  const attachments: CollectedAttachment[] = [];

  for (const attachment of result.attachments) {
    if (!attachment.path) {
      continue;
    }

    attachments.push({
      name: attachment.name,
      contentType: attachment.contentType,
      relativePath: toReportRelativePath(attachment.path),
      kind: classifyAttachment(attachment.name, attachment.contentType),
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
