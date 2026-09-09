/**
 * Stage context & shared helpers — Native Semantic Engine
 *
 * The five stage handlers (stages/{explore,model,challenge,generate,validate}.ts)
 * receive a StageContext instead of reaching into the WorkflowController class.
 * The context closes over controller-owned helpers (state mutation, persistence,
 * error responses, stage-order guards) so each stage module stays a pure
 * function of (context, input) — no circular imports, no `this` gymnastics.
 *
 * @module agents/integration/stages/context
 */

import type { PipelineState } from '../state';
import type {
  WorkflowEnvelope,
  WorkflowStage,
  WorkflowStatus,
  ProtocolError,
  WorkflowLoopTarget,
} from '../types';
import type {
  WorkflowAdapters,
  WorkflowStartInput,
  WorkflowResponse,
} from '../workflow-controller';
import { createWorkflowEnvelope } from '../workflow-transitions';

/**
 * The canonical stage order. Shared by the controller facade, the stage
 * handlers, and the feedback router so ordering can never drift.
 */
export const STAGE_ORDER: WorkflowStage[] = [
  'explore',
  'model',
  'challenge',
  'generate',
  'validate',
];

export type StageResult = WorkflowResponse | 'continue';

/**
 * Everything a stage handler may touch. `state` is the live mutable pipeline
 * state; helpers are bound to the owning controller instance.
 */
export interface StageContext {
  state: PipelineState;
  adapters: WorkflowAdapters;
  repoRoot: string;
  saveState(state: PipelineState): void;
  workflow(): WorkflowEnvelope;
  markPaused(reason: string): void;
  markBlocked(reason: string): void;
  invalidateDownstream(envelope: WorkflowEnvelope, target: WorkflowLoopTarget): WorkflowEnvelope;
  errorResponse(
    runId: string,
    errors: ProtocolError[],
    stage: WorkflowStage | null,
    status: WorkflowStatus,
    nextRequiredAction?: string,
  ): WorkflowResponse;
  /** The stage after the given one in canonical order (null when last). */
  nextStageAfter(stage: WorkflowStage): WorkflowStage | null;
  /** The first prerequisite (in order) that is not passed/skipped yet. */
  firstUnusableStageBefore(stage: WorkflowStage): WorkflowStage | null;
}

/** Pure helper: next stage in canonical order. */
export function nextStageAfter(stage: WorkflowStage): WorkflowStage | null {
  const index = STAGE_ORDER.indexOf(stage);
  return index >= 0 && index < STAGE_ORDER.length - 1 ? STAGE_ORDER[index + 1] : null;
}

/** Pure helper: first stage before `stage` that is not passed/skipped. */
export function firstUnusableStageBefore(
  state: PipelineState,
  stage: WorkflowStage,
): WorkflowStage | null {
  const index = STAGE_ORDER.indexOf(stage);
  if (index <= 0) return null;
  for (let i = 0; i < index; i++) {
    const status = state.workflow?.stages[STAGE_ORDER[i]]?.status;
    if (status !== 'passed' && status !== 'skipped') return STAGE_ORDER[i];
  }
  return null;
}

/** Pure helper: lazily materialize the workflow envelope on a pipeline state. */
export function ensureWorkflow(state: PipelineState): WorkflowEnvelope {
  if (!state.workflow) {
    state.workflow = createWorkflowEnvelope('semantic-v1');
  }
  return state.workflow;
}

/** Shared input shape passed to every stage handler. */
export type StageInput = WorkflowStartInput;
