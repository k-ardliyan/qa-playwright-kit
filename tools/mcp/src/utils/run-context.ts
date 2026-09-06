/**
 * Pending pipeline run identity — MCP twin of
 * `src/agents/reporter/run-context.ts` (the MCP server builds separately and
 * must not import from src/). Notes recorded BEFORE the reporter runs
 * (Generator/Plan) are stamped with this identity so the reporter adopts
 * them instead of resetting them as stale.
 *
 * CONSTRAINT (explicit): one workspace supports ONE active pipeline run at a
 * time — the marker is global per report dir, so run pipelines sequentially.
 *
 * @module tools/mcp/src/utils/run-context
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { mcpWorkspace } from './workspace-paths';

export interface McpPendingRun {
  runId: string;
  ranAt: string;
  createdAt: string;
}

/** Abandoned pipelines must not hijack note attribution indefinitely. */
export const MCP_PENDING_RUN_TTL_MS = 24 * 60 * 60 * 1000;

function pendingRunPath(): string {
  return path.join(mcpWorkspace.reportsDir, '.pending-run.json');
}

function canonicalRunIdFromTimestamp(timestamp: string): string | null {
  const d = new Date(timestamp);
  if (Number.isNaN(d.getTime())) return null;
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  return `run-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}-${pad(d.getMilliseconds(), 3)}`;
}

/** Read the pending run marker; null when missing, corrupt, or past TTL. */
export function readPendingRun(): McpPendingRun | null {
  try {
    const raw = JSON.parse(fs.readFileSync(pendingRunPath(), 'utf-8')) as Record<string, unknown>;
    if (
      typeof raw['runId'] !== 'string' ||
      typeof raw['ranAt'] !== 'string' ||
      typeof raw['createdAt'] !== 'string'
    ) {
      return null;
    }
    if (Date.now() - Date.parse(raw['createdAt'] as string) > MCP_PENDING_RUN_TTL_MS) {
      clearPendingRun();
      return null;
    }
    return raw as unknown as McpPendingRun;
  } catch {
    return null;
  }
}

/** Create the marker when absent/stale; reuse a fresh one within one pipeline. */
export function ensurePendingRun(): McpPendingRun {
  const existing = readPendingRun();
  if (existing) return existing;

  const ranAt = new Date().toISOString();
  const marker: McpPendingRun = {
    runId: canonicalRunIdFromTimestamp(ranAt) ?? `run-pending-${Date.now()}`,
    ranAt,
    createdAt: ranAt,
  };
  const markerPath = pendingRunPath();
  fs.mkdirSync(path.dirname(markerPath), { recursive: true });
  fs.writeFileSync(markerPath, JSON.stringify(marker, null, 2), 'utf-8');
  return marker;
}

/** Remove the marker — called by the reporter after adopting the identity. */
export function clearPendingRun(): void {
  try {
    if (fs.existsSync(pendingRunPath())) fs.rmSync(pendingRunPath());
  } catch {
    // Non-blocking
  }
}

/**
 * Identity a NEW note should be stamped with: pending pipeline run when
 * active, else the latest summary's canonical id, else null.
 */
export function resolveCurrentRunIdentity(): {
  runId: string;
  source: 'pending' | 'latest';
} | null {
  const pending = readPendingRun();
  if (pending) return { runId: pending.runId, source: 'pending' };

  try {
    const summaryPath = path.join(mcpWorkspace.reportsDir, 'test-summary.json');
    const raw = JSON.parse(fs.readFileSync(summaryPath, 'utf-8')) as Record<string, unknown>;
    if (typeof raw['timestamp'] === 'string') {
      const runId = canonicalRunIdFromTimestamp(raw['timestamp'] as string);
      if (runId) return { runId, source: 'latest' };
    }
  } catch {
    // No summary — nothing to attach to
  }
  return null;
}
