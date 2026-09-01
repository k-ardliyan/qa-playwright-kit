import { createHash } from 'crypto';

export interface ErrorFingerprint {
  /** 12-char unique hash representing the normalized error signature */
  fingerprintId: string;
  /** Normalized representative error message */
  normalizedMessage: string;
  /** Top cleaned stack trace frame */
  primaryFrame?: string;
}

/**
 * Normalizes error messages and stack traces to group identical root-cause errors
 * by stripping variable tokens (UUIDs, timestamps, hex addresses, line/col numbers, local file paths).
 */
export function generateErrorFingerprint(errorMessage: string, stack?: string): ErrorFingerprint {
  const rawMsg = errorMessage || '';

  // 1. Sanitize dynamic and environment-specific patterns from error message
  const normalizedMessage = rawMsg
    .replace(/0x[a-fA-F0-9]+/g, '<HEX>')
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<UUID>')
    .replace(/\b\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?\b/g, '<TIMESTAMP>')
    .replace(/\b(?:https?|ftp):\/\/[^\s"'<>]+/g, '<URL>')
    .replace(
      /(?:[A-Za-z]:[\\/]|(?:\/[a-zA-Z0-9._-]+)+)[\\/]([a-zA-Z0-9._-]+\.(?:ts|js|tsx|jsx))/g,
      '<PATH>/$1',
    )
    .replace(/:\d+:\d+/g, ':<LINE>:<COL>')
    .replace(/waiting for locator\([^)]+\)/g, 'waiting for locator(<LOCATOR>)')
    .replace(/\s+/g, ' ')
    .trim();

  // 2. Extract first 2 relevant application stack frames (ignoring node_modules / node internals)
  const cleanedFrames = (stack || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(
      (line) => line.startsWith('at ') && !line.includes('node_modules') && !line.includes('node:'),
    )
    .slice(0, 2)
    .map((line) =>
      line
        .replace(/:\d+:\d+/g, ':<LINE>:<COL>')
        .replace(/(?:[A-Za-z]:[\\/]|(?:\/[a-zA-Z0-9._-]+)+)[\\/]/g, '<PATH>/'),
    );

  const primaryFrame = cleanedFrames[0] || undefined;
  const hashPayload = `${normalizedMessage} | ${cleanedFrames.join(' | ')}`;

  const hash = createHash('sha256').update(hashPayload).digest('hex').substring(0, 12);
  const fingerprintId = `ERR-${hash}`;

  return {
    fingerprintId,
    normalizedMessage,
    primaryFrame,
  };
}

/**
 * Groups test failure items by their normalized error fingerprint.
 */
export function clusterFailuresByFingerprint<T extends { errorMessage?: string; stack?: string }>(
  items: T[],
): Map<string, { fingerprint: ErrorFingerprint; items: T[] }> {
  const clusters = new Map<string, { fingerprint: ErrorFingerprint; items: T[] }>();

  for (const item of items) {
    if (!item.errorMessage) continue;
    const fp = generateErrorFingerprint(item.errorMessage, item.stack);
    const existing = clusters.get(fp.fingerprintId);
    if (existing) {
      existing.items.push(item);
    } else {
      clusters.set(fp.fingerprintId, { fingerprint: fp, items: [item] });
    }
  }

  return clusters;
}
