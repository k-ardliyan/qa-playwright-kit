import * as fs from 'node:fs';
import * as path from 'node:path';
import { findRepoRoot } from './version-resolver';

export interface ResolveOutputDirOptions {
  repoRoot?: string;
  runId?: string;
  ensureExists?: boolean;
}

/**
 * Generate a run-scoped directory for MCP output artifacts (traces, videos, pdfs).
 */
export function resolveMcpOutputDir(options: ResolveOutputDirOptions = {}): string {
  const root = options.repoRoot ?? findRepoRoot();
  const runId = options.runId ?? `mcp-${Date.now()}`;
  const outDir = path.join(root, 'artifacts', 'test-results', 'mcp', runId);

  if (options.ensureExists !== false && !fs.existsSync(outDir)) {
    try {
      fs.mkdirSync(outDir, { recursive: true });
    } catch {
      // Non-fatal if folder cannot be immediately created
    }
  }

  return outDir;
}
