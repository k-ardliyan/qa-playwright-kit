import * as fs from 'node:fs';
import * as path from 'node:path';
import { WorkspacePathRegistry, workspace } from '../workspace-paths';

export interface ResolveOutputDirOptions {
  repoRoot?: string;
  registry?: WorkspacePathRegistry;
  runId?: string;
  ensureExists?: boolean;
}

/**
 * Generate a run-scoped directory for MCP output artifacts (traces, videos, pdfs).
 */
export function resolveMcpOutputDir(options: ResolveOutputDirOptions = {}): string {
  const registry =
    options.registry ??
    (options.repoRoot ? new WorkspacePathRegistry(options.repoRoot) : workspace);
  const runId = options.runId ?? `mcp-${Date.now()}`;
  const outDir = path.join(registry.testResultsDir, 'mcp', runId);

  if (options.ensureExists !== false && !fs.existsSync(outDir)) {
    try {
      fs.mkdirSync(outDir, { recursive: true });
    } catch {
      // Non-fatal if folder cannot be immediately created
    }
  }

  return outDir;
}
