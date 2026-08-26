/**
 * AUTO-SYNCED from src/contracts/hashing.ts — do not edit by hand.
 * Run: npm run sync:mcp-generated  (also runs inside npm run mcp:build)
 */

import * as crypto from 'node:crypto';

/**
 * Normalizes text content for deterministic hashing:
 * - strips UTF-8 BOM
 * - normalizes line endings (\r\n -> \n)
 * - trims trailing empty lines
 */
export function normalizeContentForHash(content: string): string {
  if (!content) return '';
  return content
    .replace(/^\uFEFF/, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .trim();
}

/**
 * Compute deterministic SHA-256 hash of normalized text content.
 */
export function computeSourceHash(content: string): string {
  const normalized = normalizeContentForHash(content);
  return crypto.createHash('sha256').update(normalized, 'utf8').digest('hex');
}

/**
 * Deterministically stringifies an object by sorting keys recursively.
 */
export function deterministicStringify(obj: unknown): string {
  if (obj === null || typeof obj !== 'object') {
    return JSON.stringify(obj);
  }
  if (Array.isArray(obj)) {
    return `[${obj.map((item) => deterministicStringify(item)).join(',')}]`;
  }
  const keys = Object.keys(obj as Record<string, unknown>).sort();
  const pairs = keys.map(
    (key) =>
      `${JSON.stringify(key)}:${deterministicStringify((obj as Record<string, unknown>)[key])}`,
  );
  return `{${pairs.join(',')}}`;
}

/**
 * Compute deterministic SHA-256 hash of a structured JavaScript object.
 */
export function computeObjectHash(obj: unknown): string {
  const json = deterministicStringify(obj);
  return crypto.createHash('sha256').update(json, 'utf8').digest('hex');
}
