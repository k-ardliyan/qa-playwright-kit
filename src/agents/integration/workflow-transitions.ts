/**
 * Semantic Workflow Transition Reducer — Agent AI Integration Layer
 *
 * Pure state machine over the five-stage workflow
 * (Explore → Model → Challenge → Generate → Validate).
 *
 * The reducer is the single authority for legal stage transitions. It makes
 * the "FOURTH, NOT FIRST" invariant machine-enforced instead of prompt-enforced:
 * Generate cannot be entered unless Explore is usable, Model passed, and
 * Challenge allowed. No agent prompt can replace this check.
 *
 * @module agents/integration/workflow-transitions
 */

import {
  WorkflowStage,
  WorkflowStageState,
  WorkflowEnvelope,
  WorkflowStatus,
  WORKFLOW_STAGES,
} from './types';

/**
 * Event that drives a workflow transition.
 */
export type WorkflowEvent =
  | { type: 'stage:start'; stage: WorkflowStage }
  | { type: 'stage:pass'; stage: WorkflowStage; reason?: string }
  | { type: 'stage:fail'; stage: WorkflowStage; reason: string }
  | { type: 'stage:block'; stage: WorkflowStage; reason: string }
  | { type: 'stage:skip'; stage: WorkflowStage; reason: string }
  | { type: 'stage:needs-review'; stage: WorkflowStage; reason: string }
  | {
      type: 'stage:qa-decision';
      stage: WorkflowStage;
      reason?: string;
      completionProof?: {
        analysisCompleted: true;
        analysisVerified: true;
        analysisVerdict: 'complete';
      };
    }
  | { type: 'feedback'; decision: import('./types').FeedbackDecision };

/**
 * Result of a transition attempt.
 */
export type TransitionResult =
  | { ok: true; envelope: WorkflowEnvelope }
  | { ok: false; error: string };

/**
 * Create a fresh workflow envelope for a new semantic run.
 */
export function createWorkflowEnvelope(mode: 'semantic-v1' | 'physical-compat'): WorkflowEnvelope {
  const stages = {} as Record<WorkflowStage, WorkflowStageState>;
  for (const stage of WORKFLOW_STAGES) {
    stages[stage] = { status: 'idle' };
  }
  return {
    schemaVersion: 'qa.workflow/v1',
    mode,
    currentStage: null,
    stages,
    loopCounts: {},
  };
}

/**
 * Legal next-stage map. Validate is terminal; feedback re-entry is handled
 * by the feedback router, not by this map.
 */
const NEXT_STAGE: Partial<Record<WorkflowStage, WorkflowStage>> = {
  explore: 'model',
  model: 'challenge',
  challenge: 'generate',
  generate: 'validate',
};

/**
 * Stage index for ordering checks.
 */
const STAGE_INDEX: Record<WorkflowStage, number> = {
  explore: 0,
  model: 1,
  challenge: 2,
  generate: 3,
  validate: 4,
};

/**
 * Apply a workflow event to an envelope.
 *
 * Rules:
 * - A stage can only start when every earlier stage is `passed` (or `skipped`
 *   with a recorded reason — an explicit safe skip).
 * - `stage:pass` requires the stage to be `running` (or `required`/`recommended`
 *   for Explore, which passes straight from a policy decision).
 * - `stage:qa-decision` is only legal on the terminal Validate stage.
 * - `feedback` records the decision and loop count; it never fabricates a pass.
 *
 * @param envelope - Current workflow envelope (immutable — a new one is returned).
 * @param event - The transition event.
 */
export function transitionWorkflow(
  envelope: WorkflowEnvelope,
  event: WorkflowEvent,
): TransitionResult {
  switch (event.type) {
    case 'stage:start': {
      const stage = event.stage;
      const current = envelope.stages[stage].status;
      if (current === 'running') {
        return { ok: false, error: `Stage '${stage}' is already running.` };
      }
      if (current === 'passed' || current === 'skipped' || current === 'qa-decision-required') {
        return {
          ok: false,
          error: `Stage '${stage}' already ${current} — it cannot start again.`,
        };
      }
      const blockedBy = earlierStageNotUsable(envelope, stage);
      if (blockedBy) {
        return {
          ok: false,
          error: `Cannot start '${stage}': earlier stage '${blockedBy}' is not passed/skipped.`,
        };
      }
      return {
        ok: true,
        envelope: withStage(envelope, stage, { status: 'running' }, { currentStage: stage }),
      };
    }

    case 'stage:pass': {
      const stage = event.stage;
      const current = envelope.stages[stage].status;
      if (current !== 'running' && current !== 'required' && current !== 'recommended') {
        return {
          ok: false,
          error: `Cannot pass '${stage}' from status '${current}' (must be running/required/recommended).`,
        };
      }
      const next = NEXT_STAGE[stage];
      return {
        ok: true,
        envelope: withStage(
          envelope,
          stage,
          { status: 'passed', reason: event.reason },
          { currentStage: next ?? null },
        ),
      };
    }

    case 'stage:fail': {
      const stage = event.stage;
      return {
        ok: true,
        envelope: withStage(envelope, stage, { status: 'failed', reason: event.reason }),
      };
    }

    case 'stage:block': {
      const stage = event.stage;
      return {
        ok: true,
        envelope: withStage(envelope, stage, { status: 'blocked', reason: event.reason }),
      };
    }

    case 'stage:skip': {
      const stage = event.stage;
      if (stage !== 'explore') {
        return { ok: false, error: `Only 'explore' can be skipped explicitly, not '${stage}'.` };
      }
      return {
        ok: true,
        envelope: withStage(envelope, stage, { status: 'skipped', reason: event.reason }),
      };
    }

    case 'stage:needs-review': {
      const stage = event.stage;
      return {
        ok: true,
        envelope: withStage(envelope, stage, { status: 'needs-review', reason: event.reason }),
      };
    }

    case 'stage:qa-decision': {
      const stage = event.stage;
      if (stage !== 'validate') {
        return { ok: false, error: `QA decision is only legal on 'validate', not '${stage}'.` };
      }
      const current = envelope.stages[stage].status;
      if (current === 'qa-decision-required') {
        return { ok: false, error: `Stage '${stage}' already requires a QA decision.` };
      }
      if (current === 'idle' || current === 'failed' || current === 'blocked') {
        return {
          ok: false,
          error: `Cannot request a QA decision for '${stage}' from status '${current}'. Validate must complete before QA review.`,
        };
      }
      const proof = event.completionProof;
      if (
        !proof ||
        proof.analysisCompleted !== true ||
        proof.analysisVerified !== true ||
        proof.analysisVerdict !== 'complete'
      ) {
        return {
          ok: false,
          error: 'QA decision requires verified Report(Analyze) completion proof.',
        };
      }
      return {
        ok: true,
        envelope: withStage(envelope, stage, {
          status: 'qa-decision-required',
          reason: event.reason,
        }),
      };
    }

    case 'feedback': {
      const target = event.decision.loopTarget;
      const loopCounts = { ...envelope.loopCounts };
      loopCounts[target] = (loopCounts[target] ?? 0) + 1;
      return {
        ok: true,
        envelope: {
          ...envelope,
          lastFeedback: event.decision,
          loopCounts,
        },
      };
    }
  }
}

/**
 * True when a stage is usable as an upstream precondition.
 */
export function isStageUsable(state: WorkflowStageState): boolean {
  return state.status === 'passed' || state.status === 'skipped';
}

/**
 * Find the earliest stage before `stage` that is not usable.
 */
function earlierStageNotUsable(
  envelope: WorkflowEnvelope,
  stage: WorkflowStage,
): WorkflowStage | null {
  const index = STAGE_INDEX[stage];
  for (let i = 0; i < index; i++) {
    const earlier = WORKFLOW_STAGES[i];
    if (!isStageUsable(envelope.stages[earlier])) {
      return earlier;
    }
  }
  return null;
}

/**
 * Return a copy of the envelope with one stage state (and optionally the
 * current stage) updated.
 */
function withStage(
  envelope: WorkflowEnvelope,
  stage: WorkflowStage,
  state: WorkflowStageState,
  extra?: Partial<Pick<WorkflowEnvelope, 'currentStage' | 'currentSubstage'>>,
): WorkflowEnvelope {
  return {
    ...envelope,
    ...extra,
    stages: {
      ...envelope.stages,
      [stage]: { ...state, updatedAt: new Date().toISOString() },
    },
  };
}
