/**
 * Pipeline State Manager
 *
 * Persists pipeline execution progress for resume capability.
 * State is stored as plain JSON in `artifacts/reports/pipeline-state.json`
 * (or under QA_REPORT_DIR test override).
 * Completed states are archived to `<reportDir>/archive/pipeline-state-<runId>.json`.
 *
 * @module agents/integration/state
 */

import * as fs from 'fs';
import * as path from 'path';
import { PipelinePhase, ProtocolError } from './types';
import { computeSourceHash } from '@/contracts';

/**
 * Ordered sequence of pipeline phases for resume logic.
 */
const PHASE_SEQUENCE: PipelinePhase[] = ['plan', 'generate', 'execute', 'heal', 'report'];

/**
 * Resolve the report directory at call time.
 * Honors QA_REPORT_DIR (same override contract as src/agents/reporter/report-archive.ts)
 * so tests can isolate state writes into a temp dir instead of polluting the
 * production artifacts/reports/pipeline-state.json.
 */
function reportDir(): string {
  const override = process.env['QA_REPORT_DIR'];
  if (override) return path.resolve(override);
  return path.resolve('artifacts', 'reports');
}

function resolveStateFilePath(): string {
  return path.join(reportDir(), 'pipeline-state.json');
}

function archiveDirPath(): string {
  return path.join(reportDir(), 'archive');
}

/**
 * Persistent state for a pipeline run.
 */
/**
 * Persistent state for a pipeline run.
 */
export interface PipelineState {
  runId: string; // UUID v4
  status: 'running' | 'completed' | 'failed' | 'paused';
  currentPhase: PipelinePhase | null;
  completedPhases: PipelinePhase[];
  artifacts: Record<PipelinePhase, string[]>; // paths to intermediate files
  timestamp: string; // ISO 8601, last update
  startedAt: string; // ISO 8601
  requirementPath: string;
  requirementHash?: string;
  planHash?: string;
  orchestrationMode: 'manual' | 'automatic';
  errors: ProtocolError[];
}

/**
 * Save the pipeline state to `<reportDir>/pipeline-state.json`.
 *
 * Creates the parent directory if it does not exist.
 * Updates the `timestamp` field to the current ISO 8601 string before writing.
 */
export function saveState(state: PipelineState): void {
  const stateFilePath = resolveStateFilePath();
  const dir = path.dirname(stateFilePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  state.timestamp = new Date().toISOString();
  fs.writeFileSync(stateFilePath, JSON.stringify(state, null, 2), 'utf-8');
}

/**
 * Load the pipeline state from `<reportDir>/pipeline-state.json`.
 *
 * Returns `null` if the state file does not exist.
 */
export function loadState(): PipelineState | null {
  const filePath = resolveStateFilePath();
  if (!fs.existsSync(filePath)) {
    return null;
  }
  const content = fs.readFileSync(filePath, 'utf-8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    // State file is corrupt — treat as no valid state
    return null;
  }
  // GAP 3: Guard against partially-written or manually-edited state files.
  // If required fields are absent, resume is impossible — return null rather than crashing.
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !('runId' in parsed) ||
    !('completedPhases' in parsed) ||
    !('artifacts' in parsed) ||
    !('requirementPath' in parsed)
  ) {
    return null;
  }
  return parsed as PipelineState;
}

/**
 * Archive a pipeline state to `<reportDir>/archive/pipeline-state-<runId>.json`.
 *
 * Creates the archive directory if it does not exist.
 */
export function archiveState(state: PipelineState): void {
  const archDir = archiveDirPath();
  if (!fs.existsSync(archDir)) {
    fs.mkdirSync(archDir, { recursive: true });
  }
  const archivePath = path.join(archDir, `pipeline-state-${state.runId}.json`);
  fs.writeFileSync(archivePath, JSON.stringify(state, null, 2), 'utf-8');
}

/**
 * Resume a pipeline run from the last completed phase.
 *
 * Logic:
 * 1. Load state from `<reportDir>/pipeline-state.json`
 * 2. If no state file exists, return an error
 * 3. Validate source requirement staleness (hash check)
 * 4. Validate all artifact paths still exist on disk
 * 5. If artifacts or requirement changed, invalidate affected phases
 * 6. Determine resume point: first phase in sequence not in completedPhases
 * 7. Return the updated state and the phase to resume from
 */
export function resumeState():
  { state: PipelineState; resumePhase: PipelinePhase } | { error: string } {
  const state = loadState();

  if (!state) {
    return { error: 'No resumable pipeline run found.' };
  }

  // 1. Validate requirement staleness
  if (state.requirementPath && fs.existsSync(path.resolve(state.requirementPath))) {
    const reqContent = fs.readFileSync(path.resolve(state.requirementPath), 'utf-8');
    const currentReqHash = computeSourceHash(reqContent);

    if (state.requirementHash && state.requirementHash !== currentReqHash) {
      // Requirement changed! Cascade invalidate all phases
      state.completedPhases = [];
      for (const phase of PHASE_SEQUENCE) {
        state.artifacts[phase] = [];
      }
      state.requirementHash = currentReqHash;
      saveState(state);
      return { state, resumePhase: 'plan' };
    }
  }

  // 2. Validate artifact paths for each completed phase
  // Find the earliest phase with missing artifacts
  let earliestInvalidIndex = -1;

  for (let i = 0; i < PHASE_SEQUENCE.length; i++) {
    const phase = PHASE_SEQUENCE[i];
    if (!state.completedPhases.includes(phase)) {
      continue;
    }

    const phaseArtifacts = state.artifacts[phase] || [];
    const hasMissingArtifact = phaseArtifacts.some(
      (artifactPath) => !fs.existsSync(path.resolve(artifactPath)),
    );

    if (hasMissingArtifact) {
      if (earliestInvalidIndex === -1) {
        earliestInvalidIndex = i;
      }
    }
  }

  // If artifacts are missing, invalidate affected phase and all subsequent phases
  if (earliestInvalidIndex !== -1) {
    const phasesToInvalidate = PHASE_SEQUENCE.slice(earliestInvalidIndex);
    for (const phase of phasesToInvalidate) {
      state.completedPhases = state.completedPhases.filter((p) => p !== phase);
      state.artifacts[phase] = [];
    }
    // Persist the updated state
    saveState(state);
  }

  // Determine resume point: first phase not in completedPhases
  const resumePhase = PHASE_SEQUENCE.find((phase) => !state.completedPhases.includes(phase));

  // If all phases are complete (shouldn't normally happen on resume), default to 'plan'
  const targetPhase: PipelinePhase = resumePhase || 'plan';

  return { state, resumePhase: targetPhase };
}

/**
 * Mark a pipeline run as completed, save the state, and archive it.
 *
 * Sets `status` to `'completed'`, saves the state, then archives it.
 */
export function markCompleted(state: PipelineState): void {
  state.status = 'completed';
  saveState(state);
  archiveState(state);
}
