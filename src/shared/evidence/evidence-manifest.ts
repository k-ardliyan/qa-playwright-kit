import * as fs from 'node:fs';
import * as path from 'node:path';
import type { EvidenceManifest } from './types';
import { redactSensitiveData } from '../utils/redaction';
import { workspace } from '../workspace-paths';

/** Sanitize an identifier for safe use inside a single path segment. */
export function sanitizePathSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '_');
}

/**
 * Write a sanitized EvidenceManifest to disk.
 */
export function writeEvidenceManifest(manifest: EvidenceManifest, customDir?: string): string {
  const runId = sanitizePathSegment(manifest.runId || 'unknown-run');
  const dir = customDir ?? path.join(workspace.testResultsDir, 'mcp', runId);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const rawTestId = manifest.testId || 'unknown-test';
  const safeTestId = sanitizePathSegment(rawTestId);
  const attempt = manifest.attempt ?? 1;
  const filePath = path.join(dir, `evidence-${safeTestId}-att${attempt}.json`);

  // Ensure all data in manifest is redacted before writing to disk
  const sanitizedManifest = redactSensitiveData(manifest);

  fs.writeFileSync(filePath, JSON.stringify(sanitizedManifest, null, 2), 'utf-8');
  return filePath;
}

/**
 * Read and parse an EvidenceManifest from disk.
 */
export function readEvidenceManifest(filePath: string): EvidenceManifest | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw) as EvidenceManifest;
    if (parsed && parsed.version === '1.0' && parsed.runId && parsed.testId) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}
