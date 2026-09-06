/**
 * Pending pipeline run identity.
 *
 * Notes written BEFORE the reporter runs (Plan/Generate phase insights) must
 * attach to the UPCOMING run, whose canonical id does not exist yet — the
 * latest summary on disk still belongs to the previous run. This module owns
 * a short-lived marker, `<reportDir>/.pending-run.json`, created when a
 * pipeline run starts and adopted (then cleared) by the reporter's onEnd:
 *
 *   pipeline start  → ensurePendingRun()  → sidecar notes stamped with it
 *   reporter onEnd  → adopt as canonicalRunId → clearPendingRun()
 *
 * A marker older than PENDING_RUN_TTL_MS is stale and ignored, so an
 * abandoned pipeline cannot hijack note attribution forever.
 *
 * CONSTRAINT (explicit): one workspace supports ONE active pipeline run at a
 * time — the marker is global per report dir, so two concurrent pipelines
 * would share (and mix) note attribution. Run pipelines sequentially.
 *
 * @module src/agents/reporter/run-context
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { generateRunId } from './report-archive';
import { resolveWorkspaceReportDir } from '../../shared/workspace-paths';

export interface PendingRun {
  /** Canonical archive-format id the reporter will adopt. */
  runId: string;
  /** ISO timestamp the pending id was derived from (= pipeline start). */
  ranAt: string;
  createdAt: string;
}

/** Abandoned pipelines must not hijack note attribution indefinitely. */
export const PENDING_RUN_TTL_MS = 24 * 60 * 60 * 1000;

function pendingRunPath(): string {
  return path.join(resolveWorkspaceReportDir(), '.pending-run.json');
}

/** Read the pending run marker; null when missing, corrupt, or past TTL. */
export function readPendingRun(): PendingRun | null {
  const markerPath = pendingRunPath();
  try {
    const raw = JSON.parse(fs.readFileSync(markerPath, 'utf-8')) as Record<string, unknown>;
    if (
      typeof raw['runId'] !== 'string' ||
      typeof raw['ranAt'] !== 'string' ||
      typeof raw['createdAt'] !== 'string'
    ) {
      return null;
    }
    if (Date.now() - Date.parse(raw['createdAt'] as string) > PENDING_RUN_TTL_MS) {
      clearPendingRun();
      return null;
    }
    return raw as unknown as PendingRun;
  } catch {
    return null;
  }
}

/**
 * Create the pending run marker when absent or stale; reuse a fresh one so
 * every phase of the same pipeline writes notes under the same identity.
 */
export function ensurePendingRun(): PendingRun {
  const existing = readPendingRun();
  if (existing) return existing;

  const ranAt = new Date().toISOString();
  const marker: PendingRun = {
    runId: generateRunId(ranAt),
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
    const markerPath = pendingRunPath();
    if (fs.existsSync(markerPath)) fs.rmSync(markerPath);
  } catch {
    // Non-blocking
  }
}

/**
 * Identity a NEW note should be stamped with right now: the pending pipeline
 * run when one is active, otherwise the latest summary's canonical id (notes
 * for the latest completed run), otherwise null (nothing to attach to).
 */
export function resolveCurrentRunIdentity(): {
  runId: string;
  source: 'pending' | 'latest';
} | null {
  const pending = readPendingRun();
  if (pending) return { runId: pending.runId, source: 'pending' };

  try {
    const summaryPath = path.join(resolveWorkspaceReportDir(), 'test-summary.json');
    const raw = JSON.parse(fs.readFileSync(summaryPath, 'utf-8')) as Record<string, unknown>;
    if (typeof raw['timestamp'] === 'string') {
      const d = new Date(raw['timestamp'] as string);
      if (!Number.isNaN(d.getTime())) {
        return { runId: generateRunId(d.toISOString()), source: 'latest' };
      }
    }
  } catch {
    // No summary — nothing to attach to
  }
  return null;
}
