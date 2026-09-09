/**
 * Workflow Controller — Native Semantic Engine
 *
 * The runtime owner of the five-stage workflow
 * (Explore → Model → Challenge → Generate → Validate).
 *
 * Physical phases (plan/generate/execute/heal/report) remain the execution
 * engine; this controller owns stage transitions, the Explore policy, the
 * Challenge gate, and persistence of the semantic envelope — so "FOURTH,
 * NOT FIRST" is enforced at runtime, not by prompt compliance.
 *
 * The five stage handlers live in `./stages/*` (pure functions over a
 * StageContext); this facade owns state, persistence, and the shared helpers
 * those handlers are closed over. Type contracts live in
 * `./workflow-controller-types` and are re-exported here for consumers.
 *
 * @module agents/integration/workflow-controller
 */

import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { computeSourceHash } from '@/contracts';
import type {
  WorkflowEnvelope,
  WorkflowStage,
  WorkflowLoopTarget,
  ProtocolError,
  WorkflowStatus,
} from './types';
import type { PipelineState } from './state';
import { saveState, loadState } from './state';
import { createWorkflowEnvelope } from './workflow-transitions';
import { ensurePendingRun } from '../reporter/run-context';
import {
  STAGE_ORDER,
  runExploreStage,
  runModelStage,
  runChallengeStage,
  runGenerateStage,
  runValidateStage,
  type StageContext,
} from './stages';
import type {
  WorkflowAdapters,
  WorkflowStartInput,
  WorkflowResponse,
  WorkflowControllerConfig,
} from './workflow-controller-types';

// Public type contracts — re-exported for protocol consumers.
export type {
  WorkflowAdapters,
  ExploreAdapterInput,
  ModelAdapterInput,
  ModelAdapterResult,
  ChallengeAdapterInput,
  ChallengeAdapterResult,
  GenerateAdapterInput,
  GenerateAdapterResult,
  ValidateAdapterInput,
  ValidateAdapterResult,
  WorkflowStartInput,
  WorkflowResponse,
  WorkflowControllerConfig,
} from './workflow-controller-types';
export type { FeedbackDecision } from './types';
export { routeFeedback, type FeedbackInput } from './feedback-router';

/**
 * Native semantic controller — thin facade over the per-stage handlers.
 */
export class WorkflowController {
  private state: PipelineState;
  private repoRoot: string;
  private adapters: WorkflowAdapters;

  constructor(
    config: WorkflowControllerConfig,
    adapters: WorkflowAdapters,
    initialState?: PipelineState,
  ) {
    this.adapters = adapters;
    const repoRoot = config.repoRoot ?? process.cwd();
    this.repoRoot = repoRoot;
    const runId = config.runId || initialState?.runId || randomUUID();
    const now = new Date().toISOString();
    this.state = initialState
      ? {
          ...initialState,
          // A resumed run is never marked `running` until a stage actually
          // starts executing (PC-06: a paused/blocked run must not look active).
          status: initialState.status === 'running' ? 'running' : initialState.status,
          timestamp: now,
        }
      : {
          runId,
          status: 'running',
          currentPhase: null,
          completedPhases: [],
          artifacts: { plan: [], generate: [], execute: [], heal: [], report: [] },
          timestamp: now,
          startedAt: now,
          requirementPath: config.requirementPath,
          requirementHash: stampRequirementHash(config.requirementPath, repoRoot),
          orchestrationMode: config.orchestrationMode,
          errors: [],
          workflow: createWorkflowEnvelope('semantic-v1'),
        };
  }

  getState(): PipelineState {
    return this.state;
  }

  /**
   * Run the whole semantic workflow.
   */
  async run(input: WorkflowStartInput): Promise<WorkflowResponse> {
    // Resume: re-validate persisted identity before touching any stage.
    if (input.resume) {
      const resumeError = this.assertResumable(input);
      if (resumeError) return resumeError;
    }

    try {
      ensurePendingRun();
    } catch {
      // Non-blocking — pre-run notes fall back to latest-run attribution.
    }

    const explore = await runExploreStage(this.stageContext(), input);
    if (explore !== 'continue') return explore;

    const model = await runModelStage(this.stageContext(), input);
    if (model !== 'continue') return model;

    const challenge = await runChallengeStage(this.stageContext(), input);
    if (challenge !== 'continue') return challenge;

    const generate = await runGenerateStage(this.stageContext(), input);
    if (generate !== 'continue') return generate;

    return runValidateStage(this.stageContext(), input);
  }

  /**
   * Run a single semantic stage (manual mode) against current state.
   */
  async runStage(stage: WorkflowStage, input: WorkflowStartInput): Promise<WorkflowResponse> {
    const ctx = this.stageContext();
    switch (stage) {
      case 'explore':
        return this.expectResponse(stage, await runExploreStage(ctx, input));
      case 'model':
        return this.expectResponse(stage, await runModelStage(ctx, input));
      case 'challenge':
        return this.expectResponse(stage, await runChallengeStage(ctx, input));
      case 'generate':
        return this.expectResponse(stage, await runGenerateStage(ctx, input));
      case 'validate':
        return runValidateStage(ctx, input);
    }
  }

  /** Build the stage context closed over this controller's state + helpers. */
  private stageContext(): StageContext {
    return {
      state: this.state,
      adapters: this.adapters,
      repoRoot: this.repoRoot,
      saveState: (s) => saveState(s),
      workflow: () => {
        if (!this.state.workflow) {
          this.state.workflow = createWorkflowEnvelope('semantic-v1');
        }
        return this.state.workflow;
      },
      markPaused: (reason) => this.markPaused(reason),
      markBlocked: (reason) => this.markBlocked(reason),
      invalidateDownstream: (envelope, target) => this.invalidateDownstream(envelope, target),
      errorResponse,
      nextStageAfter: (stage) => {
        const index = STAGE_ORDER.indexOf(stage);
        return index >= 0 && index < STAGE_ORDER.length - 1 ? STAGE_ORDER[index + 1] : null;
      },
      firstUnusableStageBefore: (stage) => {
        const index = STAGE_ORDER.indexOf(stage);
        if (index <= 0) return null;
        for (let i = 0; i < index; i++) {
          const status = this.state.workflow?.stages[STAGE_ORDER[i]]?.status;
          if (status !== 'passed' && status !== 'skipped') return STAGE_ORDER[i];
        }
        return null;
      },
    };
  }

  /**
   * Narrow a stage-run result to a WorkflowResponse.
   *
   * 'continue' has two meanings: the stage just completed successfully, or it
   * was already satisfied with nothing to run. Both are honest success/none —
   * report them per the resulting stage status instead of throwing.
   */
  private expectResponse(
    stage: WorkflowStage,
    result: WorkflowResponse | 'continue',
  ): WorkflowResponse {
    if (result === 'continue') {
      const status = this.state.workflow?.stages[stage]?.status;
      const completed = status === 'passed' || status === 'skipped';
      const next = this.nextStageAfter(stage);
      const blockedBy = this.firstUnusableStageBefore(stage);
      return {
        status: completed ? 'success' : 'in-progress',
        runId: this.state.runId,
        workflowStage: stage,
        workflowStatus: completed ? status : 'blocked',
        phase: stage,
        nextRequiredAction: completed
          ? next
            ? `Stage '${stage}' is ${status}. Next: ${next}.`
            : `Stage '${stage}' is ${status}.`
          : blockedBy
            ? `Stage '${stage}' cannot start: '${blockedBy}' is not passed/skipped yet. Run '${blockedBy}' first.`
            : `Stage '${stage}' has nothing to run — start with 'explore'.`,
        result: { workflowStage: this.state.workflow },
      };
    }
    return result;
  }

  /** PC-06: a persisted run must never stay `running` once the process returns. */
  private markPaused(reason: string): void {
    this.state.status = 'paused';
    this.state.errors.push({ code: 'WORKFLOW_PAUSED', message: reason, retryable: true });
    saveState(this.state);
  }

  private markBlocked(reason: string): void {
    this.state.status = 'blocked';
    this.state.errors.push({ code: 'WORKFLOW_BLOCKED', message: reason, retryable: false });
    saveState(this.state);
  }

  private nextStageAfter(stage: WorkflowStage): WorkflowStage | null {
    const index = STAGE_ORDER.indexOf(stage);
    return index >= 0 && index < STAGE_ORDER.length - 1 ? STAGE_ORDER[index + 1] : null;
  }

  private firstUnusableStageBefore(stage: WorkflowStage): WorkflowStage | null {
    const index = STAGE_ORDER.indexOf(stage);
    if (index <= 0) return null;
    for (let i = 0; i < index; i++) {
      const status = this.state.workflow?.stages[STAGE_ORDER[i]]?.status;
      if (status !== 'passed' && status !== 'skipped') return STAGE_ORDER[i];
    }
    return null;
  }

  /** PC-01: resume must re-validate run identity and requirement freshness. */
  private assertResumable(input: WorkflowStartInput): WorkflowResponse | null {
    if (!this.state.workflow || this.state.workflow.schemaVersion !== 'qa.workflow/v1') {
      return errorResponse(
        this.state.runId,
        [
          {
            code: 'RESUME_NOT_SEMANTIC',
            message:
              'Persisted state is not a native semantic run (qa.workflow/v1). Start a fresh semantic run instead.',
            retryable: false,
          },
        ],
        'explore',
        'blocked',
        'Start a fresh run with `workflow_run --requirement <path>`.',
      );
    }
    if (this.state.requirementHash) {
      const reqAbs = path.isAbsolute(this.state.requirementPath)
        ? this.state.requirementPath
        : path.join(this.repoRoot, this.state.requirementPath);
      if (fs.existsSync(reqAbs)) {
        const current = computeSourceHash(fs.readFileSync(reqAbs, 'utf-8'));
        if (current !== this.state.requirementHash) {
          return errorResponse(
            this.state.runId,
            [
              {
                code: 'RESUME_STALE_REQUIREMENT',
                message:
                  'Requirement changed since this run started. Resume is unsafe — start a fresh run.',
                retryable: false,
              },
            ],
            null,
            'blocked',
            'Start a fresh run for the updated requirement.',
          );
        }
      }
    }
    return null;
  }

  private invalidateDownstream(
    envelope: WorkflowEnvelope,
    target: WorkflowLoopTarget,
  ): WorkflowEnvelope {
    const index = STAGE_ORDER.indexOf(target as WorkflowStage);
    if (index < 0) return envelope;
    const stages = { ...envelope.stages };
    for (let i = index; i < STAGE_ORDER.length; i++) {
      stages[STAGE_ORDER[i]] = {
        status: 'idle',
        reason: `Invalidated by feedback routed to '${target}'.`,
      };
    }
    const next: WorkflowEnvelope = {
      ...envelope,
      stages,
      currentStage: STAGE_ORDER.includes(target as WorkflowStage)
        ? (target as WorkflowStage)
        : null,
      currentSubstage: undefined,
    };
    if (index <= 0) {
      delete next.explore;
    }
    if (index <= 1) {
      delete next.model;
    }
    if (index <= 2) {
      delete next.challenge;
    }
    if (index <= 3) {
      delete next.generate;
    }
    if (index <= 4) {
      delete next.validate;
    }
    return next;
  }
}

/** Error response builder shared by the facade and the stage modules. */
export function errorResponse(
  runId: string,
  errors: ProtocolError[],
  stage: WorkflowStage | null,
  status: WorkflowStatus,
  nextRequiredAction?: string,
): WorkflowResponse {
  return {
    status: 'error',
    runId,
    workflowStage: stage,
    workflowStatus: status,
    phase: stage ?? 'all',
    errors,
    ...(nextRequiredAction ? { nextRequiredAction } : {}),
  };
}

/** Stamp the source requirement hash at run start (same contract as Orchestrator). */
function stampRequirementHash(
  requirementPath: string | undefined,
  repoRoot: string,
): string | undefined {
  if (!requirementPath) return undefined;
  const reqAbs = path.isAbsolute(requirementPath)
    ? requirementPath
    : path.join(repoRoot, requirementPath);
  if (!fs.existsSync(reqAbs)) return undefined;
  try {
    return computeSourceHash(fs.readFileSync(reqAbs, 'utf-8'));
  } catch {
    return undefined;
  }
}
