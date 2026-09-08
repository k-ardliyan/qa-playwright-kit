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
import {
  PipelinePhase,
  ProtocolError,
  WORKFLOW_STAGES,
  WorkflowEnvelope,
  WorkflowStage,
  WorkflowStatus,
} from './types';
import { computeSourceHash } from '@/contracts';
import { resolveWorkspaceReportDir } from '../../shared/workspace-paths';

/**
 * Ordered sequence of pipeline phases for resume logic.
 */
const PHASE_SEQUENCE: PipelinePhase[] = ['plan', 'generate', 'execute', 'heal', 'report'];
const PIPELINE_STATUSES = ['running', 'completed', 'failed', 'paused', 'blocked'] as const;
const WORKFLOW_STATUSES: WorkflowStatus[] = [
  'idle',
  'required',
  'recommended',
  'running',
  'passed',
  'skipped',
  'needs-review',
  'failed',
  'blocked',
  'qa-decision-required',
];
const WORKFLOW_SUBSTAGES = ['execute', 'heal', 'report-analyze', 'qa-review'] as const;
const WORKFLOW_LOOP_TARGETS = [
  'explore',
  'model',
  'challenge',
  'generate',
  'file-bug',
  'fix-environment',
  'blocked',
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isIsoTimestamp(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
    !Number.isNaN(Date.parse(value))
  );
}

/** State IDs are path segments, not arbitrary filenames or paths. */
function isSafeRunId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 128 &&
    /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(value)
  );
}

function isPathAbsolute(value: string): boolean {
  return path.isAbsolute(value) || path.win32.isAbsolute(value);
}

function isContainedPath(root: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return (
    relative === '' ||
    (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
  );
}

function hasParentTraversal(value: string): boolean {
  return value
    .replace(/\\/g, '/')
    .split('/')
    .some((segment) => segment === '..');
}

/**
 * Artifact paths are read during resume. Relative paths remain compatible with
 * old physical state; absolute paths are accepted only inside the workspace or
 * the configured report directory (the existing physical runner writes both).
 */
function isSafeArtifactPath(value: unknown): value is string {
  if (typeof value !== 'string' || value.trim() === '' || value.includes('\0')) return false;
  const normalized = value.replace(/\\/g, '/');
  return !hasParentTraversal(normalized);
}

function isSafeRequirementPath(value: unknown): value is string {
  if (typeof value !== 'string' || value.trim() === '' || value.includes('\0')) return false;
  const normalized = value.replace(/\\/g, '/');
  return !isPathAbsolute(value) && !hasParentTraversal(normalized);
}

function isProtocolError(value: unknown): value is ProtocolError {
  if (!isRecord(value)) return false;
  return (
    typeof value.code === 'string' &&
    value.code.length > 0 &&
    typeof value.message === 'string' &&
    value.message.length > 0 &&
    typeof value.retryable === 'boolean' &&
    (value.phase === undefined || PHASE_SEQUENCE.includes(value.phase as PipelinePhase))
  );
}

function isWorkflowStage(value: unknown): value is WorkflowStage {
  return typeof value === 'string' && (WORKFLOW_STAGES as readonly string[]).includes(value);
}

function isWorkflowEnvelope(value: unknown): value is WorkflowEnvelope {
  if (!isRecord(value)) return false;
  if (
    value.schemaVersion !== 'qa.workflow/v1' ||
    (value.mode !== 'semantic-v1' && value.mode !== 'physical-compat') ||
    (value.currentStage !== null && !isWorkflowStage(value.currentStage))
  ) {
    return false;
  }
  if (
    value.currentSubstage !== undefined &&
    !(WORKFLOW_SUBSTAGES as readonly string[]).includes(value.currentSubstage as string)
  ) {
    return false;
  }

  const stages = value.stages;
  if (!isRecord(stages)) return false;
  const stageKeys = Object.keys(stages).sort();
  const expectedStageKeys = [...WORKFLOW_STAGES].sort();
  if (JSON.stringify(stageKeys) !== JSON.stringify(expectedStageKeys)) return false;
  for (const stage of WORKFLOW_STAGES) {
    const stageState = stages[stage];
    if (!isRecord(stageState) || !WORKFLOW_STATUSES.includes(stageState.status as WorkflowStatus)) {
      return false;
    }
    if (stageState.reason !== undefined && typeof stageState.reason !== 'string') return false;
    if (stageState.updatedAt !== undefined && !isIsoTimestamp(stageState.updatedAt)) return false;
  }

  if (!isRecord(value.loopCounts)) return false;
  for (const [target, count] of Object.entries(value.loopCounts)) {
    if (
      !(WORKFLOW_LOOP_TARGETS as readonly string[]).includes(target) ||
      typeof count !== 'number' ||
      !Number.isInteger(count) ||
      count < 0
    ) {
      return false;
    }
  }
  return true;
}

function isPipelineState(value: unknown): value is PipelineState {
  if (!isRecord(value)) return false;
  if (
    !isSafeRunId(value.runId) ||
    !PIPELINE_STATUSES.includes(value.status as (typeof PIPELINE_STATUSES)[number]) ||
    (value.currentPhase !== null &&
      !PHASE_SEQUENCE.includes(value.currentPhase as PipelinePhase)) ||
    !isIsoTimestamp(value.timestamp) ||
    !isIsoTimestamp(value.startedAt) ||
    !isSafeRequirementPath(value.requirementPath) ||
    (value.orchestrationMode !== 'manual' && value.orchestrationMode !== 'automatic') ||
    !Array.isArray(value.errors) ||
    !value.errors.every(isProtocolError)
  ) {
    return false;
  }
  if (value.requirementHash !== undefined && typeof value.requirementHash !== 'string')
    return false;
  if (value.planHash !== undefined && typeof value.planHash !== 'string') return false;

  if (!Array.isArray(value.completedPhases)) return false;
  const completedPhases = value.completedPhases as unknown[];
  if (
    completedPhases.some((phase) => !PHASE_SEQUENCE.includes(phase as PipelinePhase)) ||
    new Set(completedPhases).size !== completedPhases.length ||
    completedPhases.some((phase, index) => phase !== PHASE_SEQUENCE[index])
  ) {
    return false;
  }

  if (!isRecord(value.artifacts)) return false;
  const artifactKeys = Object.keys(value.artifacts).sort();
  if (JSON.stringify(artifactKeys) !== JSON.stringify([...PHASE_SEQUENCE].sort())) return false;
  for (const phase of PHASE_SEQUENCE) {
    const artifacts = value.artifacts[phase];
    if (!Array.isArray(artifacts) || !artifacts.every(isSafeArtifactPath)) return false;
  }

  return value.workflow === undefined || isWorkflowEnvelope(value.workflow);
}

function resolveSafeRequirementPath(requirementPath: string): string | null {
  if (!isSafeRequirementPath(requirementPath)) return null;
  const resolved = path.resolve(requirementPath);
  if (!isContainedPath(process.cwd(), resolved)) return null;
  if (fs.existsSync(resolved)) {
    try {
      if (!isContainedPath(process.cwd(), fs.realpathSync(resolved))) return null;
    } catch {
      return null;
    }
  }
  return resolved;
}

function resolveSafeArtifactPathForResume(artifactPath: string): string | null {
  if (!isSafeArtifactPath(artifactPath)) return null;
  const resolved = path.resolve(artifactPath);
  if (!isPathAbsolute(artifactPath)) return resolved;
  if (!fs.existsSync(resolved)) return resolved;
  try {
    return fs.statSync(resolved).isFile() ? fs.realpathSync(resolved) : null;
  } catch {
    return null;
  }
}

/**
 * Resolve the report directory at call time.
 * Honors QA_REPORT_DIR (same override contract as src/agents/reporter/report-archive.ts)
 * so tests can isolate state writes into a temp dir instead of polluting the
 * production artifacts/reports/pipeline-state.json.
 */
function reportDir(): string {
  return resolveWorkspaceReportDir();
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
export interface PipelineState {
  runId: string; // UUID v4
  status: 'running' | 'completed' | 'failed' | 'paused' | 'blocked';
  currentPhase: PipelinePhase | null;
  completedPhases: PipelinePhase[];
  artifacts: Record<PipelinePhase, string[]>; // paths to intermediate files
  timestamp: string; // ISO 8601, last update
  startedAt: string; // ISO 8601
  requirementPath: string;
  requirementHash?: string;
  planHash?: string;
  /** Output of the most recently completed phase, used to resume context. */
  lastOutput?: unknown;
  orchestrationMode: 'manual' | 'automatic';
  errors: ProtocolError[];
  /**
   * Additive semantic workflow envelope (qa.workflow/v1). Absent in old
   * physical-compat states — never infer Challenge passed from plan completion.
   */
  workflow?: WorkflowEnvelope;
}

/**
 * Save the pipeline state to `<reportDir>/pipeline-state.json`.
 *
 * Creates the parent directory if it does not exist.
 * Updates the `timestamp` field to the current ISO 8601 string before writing.
 * Writes atomically (temp file + rename) so a crash mid-write cannot corrupt
 * the state resume depends on.
 */
export function saveState(state: PipelineState): void {
  const stateFilePath = resolveStateFilePath();
  const dir = path.dirname(stateFilePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  state.timestamp = new Date().toISOString();
  const tmpPath = `${stateFilePath}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(state, null, 2), 'utf-8');
  fs.renameSync(tmpPath, stateFilePath);
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
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    // State file is corrupt — treat as no valid state
    return null;
  }
  return isPipelineState(parsed) ? parsed : null;
}

/**
 * Archive a pipeline state to `<reportDir>/archive/pipeline-state-<runId>.json`.
 *
 * Creates the archive directory if it does not exist.
 */
export function archiveState(state: PipelineState): void {
  if (!isPipelineState(state) || !isSafeRunId(state.runId)) {
    throw new Error('Refusing to archive malformed pipeline state.');
  }
  const archDir = archiveDirPath();
  if (!fs.existsSync(archDir)) {
    fs.mkdirSync(archDir, { recursive: true });
  }
  const archivePath = path.resolve(archDir, `pipeline-state-${state.runId}.json`);
  if (!isContainedPath(archDir, archivePath)) {
    throw new Error('Refusing to write outside the archive directory.');
  }
  if (fs.existsSync(archivePath)) {
    throw new Error(`Archive for run ${state.runId} already exists. Will not overwrite.`);
  }
  const tmpPath = `${archivePath}.tmp-${process.pid}-${Date.now()}`;
  try {
    fs.writeFileSync(tmpPath, JSON.stringify(state, null, 2), { encoding: 'utf-8', flag: 'wx' });
    fs.renameSync(tmpPath, archivePath);
  } catch (error) {
    try {
      fs.rmSync(tmpPath, { force: true });
    } catch {
      // Best effort cleanup.
    }
    throw error;
  }
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
export function resumeState(
  expectedRunId?: string,
):
  | { state: PipelineState; resumePhase: PipelinePhase }
  | { error: string; code?: 'NO_RESUMABLE_RUN' | 'RUN_ID_MISMATCH' } {
  const state = loadState();

  if (!state) {
    return { error: 'No resumable pipeline run found.', code: 'NO_RESUMABLE_RUN' };
  }

  if (expectedRunId !== undefined && expectedRunId !== state.runId) {
    return {
      error: `Requested runId '${expectedRunId}' does not match the resumable run '${state.runId}'.`,
      code: 'RUN_ID_MISMATCH',
    };
  }

  // 1. Validate requirement staleness. A hashed requirement is mandatory for
  // resume: silently continuing when the source disappeared is unsafe.
  const requirementFile = resolveSafeRequirementPath(state.requirementPath);
  if (!requirementFile) {
    return {
      error: 'Persisted requirementPath is unsafe or outside the workspace.',
      code: 'NO_RESUMABLE_RUN',
    };
  }
  if (state.requirementHash) {
    if (!fs.existsSync(requirementFile)) {
      return {
        error: 'The persisted requirement is missing; refusing to resume a hashed run.',
        code: 'NO_RESUMABLE_RUN',
      };
    }
    const reqContent = fs.readFileSync(requirementFile, 'utf-8');
    const currentReqHash = computeSourceHash(reqContent);

    if (state.requirementHash !== currentReqHash) {
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
    const hasMissingArtifact = phaseArtifacts.some((artifactPath) => {
      const resolved = resolveSafeArtifactPathForResume(artifactPath);
      return resolved === null || !fs.existsSync(resolved);
    });

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
