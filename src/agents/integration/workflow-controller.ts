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
 * @module agents/integration/workflow-controller
 */

import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { computeSourceHash } from '@/contracts';
import {
  WorkflowStage,
  WorkflowStageState,
  WorkflowEnvelope,
  WorkflowStatus,
  ProtocolError,
  PipelinePhase,
  WorkflowLoopTarget,
} from './types';
import { PipelineState, saveState, loadState } from './state';
import { createWorkflowEnvelope, transitionWorkflow, isStageUsable } from './workflow-transitions';
import { evaluateExplorePolicy, EvidenceReference } from './explore-policy';
import { evaluateChallenge, canGenerate, ChallengeGateInput } from './challenge-gate';
import { routeFeedback, FeedbackInput } from './feedback-router';
import type { FeedbackDecision } from './types';
import { ModelHandoffError } from './mcp-adapters';
import { ensurePendingRun } from '../reporter/run-context';

/**
 * Adapter seam: each semantic stage maps to existing engine/agent work.
 * Implementations must return durable references/hashes, never raw browser refs.
 */
export interface WorkflowAdapters {
  /** Live exploration: run snapshot_page / discover_pages, return evidence refs. */
  explore(input: ExploreAdapterInput): Promise<{ evidence: EvidenceReference[] }>;
  /** Compile requirement + plan; returns typed model result. */
  model(input: ModelAdapterInput): Promise<ModelAdapterResult>;
  /** Compile plan + run the plan validator; returns diagnostics. */
  challenge(input: ChallengeAdapterInput): Promise<ChallengeAdapterResult>;
  /** Run the physical generator + validate_generated_tests. */
  generate(input: GenerateAdapterInput): Promise<GenerateAdapterResult>;
  /** Grouped Execute → Heal → Report(Analyze). */
  validate(input: ValidateAdapterInput): Promise<ValidateAdapterResult>;
}

export interface ExploreAdapterInput {
  requirementPath: string;
  role?: string;
  startPage?: string;
}

export interface ModelAdapterInput {
  requirementPath: string;
  roleFilter?: string[];
}

export interface ModelAdapterResult {
  planPath: string;
  planHash: string;
  scenarioCount: number;
  coverageGapCount: number;
  requirementHash: string;
}

export interface ChallengeAdapterInput {
  planPath: string;
  requirementPath: string;
  mode: 'manual' | 'automatic';
}

export interface ChallengeAdapterResult {
  diagnostics: Array<{ code: string; severity: 'error' | 'warning' | 'info' }>;
  assumptions: unknown[];
  coverageGaps: unknown[];
  assertionCount: number;
  /** Direct counts when the validator reports them (preferred over array length). */
  assumptionCount?: number;
  coverageGapCount?: number;
  /** validate_plan result status — the gate fails closed on anything but success/warning. */
  validatorStatus?: string;
}

export interface GenerateAdapterInput {
  requirementPath: string;
  planPath: string;
  roleFilter?: string[];
  /** External Generator output supplied on resume (explicit paths only). */
  generatedFiles?: string[];
  runId?: string;
}

export interface GenerateAdapterResult {
  /** Explicit result mode — never claim `completed` without a real generator. */
  mode: 'completed' | 'awaiting-generator' | 'blocked' | 'failed';
  generatedFiles: string[];
  testCount: number;
  reason?: string;
}

export interface ValidateAdapterInput {
  requirementPath: string;
  generatedFiles: string[];
  /** Explicit run identity so every Validate artifact is current-run scoped. */
  runId?: string;
}

export interface ValidateAdapterResult {
  unresolvedFailures: number;
  substage: 'execute' | 'heal' | 'report-analyze' | 'qa-review';
  /** Report(Analyze) proof; QA review is legal only when this is true. */
  analysisCompleted?: boolean;
  analysisVerified?: boolean;
  analysisVerdict?: 'complete' | 'incomplete' | 'inconsistent' | 'unverifiable' | 'not-applicable';
  /** Current-run execution proof. */
  runId?: string;
  startedAt?: string;
  resultsDir?: string;
  generatedFiles?: string[];
  executionCommand?: string;
  passed?: number;
  failed?: number;
  skipped?: number;
  failureList?: unknown[];
  testSummary?: Record<string, unknown>;
}

/**
 * Input for starting a native semantic run.
 */
export interface WorkflowStartInput {
  requirementPath: string;
  orchestrationMode: 'manual' | 'automatic';
  roleFilter?: string[];
  /** Evidence from a previous run (resume path). */
  evidence?: EvidenceReference[];
  /** Block Explore outright (e.g. missing auth session for a protected route). */
  blockedReason?: string;
  flags?: { newFeature?: boolean; changed?: boolean; highRisk?: boolean };
  /** Resume request — the controller re-validates the persisted run identity. */
  resume?: boolean;
}

/**
 * Structured semantic response (superset of the physical AgentProtocolResponse).
 */
export interface WorkflowResponse {
  status: 'success' | 'error' | 'in-progress';
  runId: string;
  workflowStage: WorkflowStage | null;
  workflowStatus: WorkflowStatus;
  nextRequiredAction?: string;
  phase: string | 'all';
  errors?: ProtocolError[];
  result?: unknown;
}

function errorResponse(
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

/**
 * Controller config.
 */
export interface WorkflowControllerConfig {
  orchestrationMode: 'manual' | 'automatic';
  requirementPath: string;
  runId?: string;
  /** Workspace root for resolving requirement/plan paths. Defaults to cwd. */
  repoRoot?: string;
}

/**
 * Native semantic controller.
 */
export class WorkflowController {
  private state: PipelineState;
  private repoRoot: string;

  constructor(
    config: WorkflowControllerConfig,
    private adapters: WorkflowAdapters,
    initialState?: PipelineState,
  ) {
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

    const explore = await this.stageExplore(input);
    if (explore !== 'continue') return explore;

    const model = await this.stageModel(input);
    if (model !== 'continue') return model;

    const challenge = await this.stageChallenge(input);
    if (challenge !== 'continue') return challenge;

    const generate = await this.stageGenerate(input);
    if (generate !== 'continue') return generate;

    return this.stageValidate(input);
  }

  /**
   * Run a single semantic stage (manual mode) against current state.
   */
  async runStage(stage: WorkflowStage, input: WorkflowStartInput): Promise<WorkflowResponse> {
    switch (stage) {
      case 'explore':
        return this.expectResponse(stage, await this.stageExplore(input));
      case 'model':
        return this.expectResponse(stage, await this.stageModel(input));
      case 'challenge':
        return this.expectResponse(stage, await this.stageChallenge(input));
      case 'generate':
        return this.expectResponse(stage, await this.stageGenerate(input));
      case 'validate':
        return this.stageValidate(input);
    }
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
    const order: WorkflowStage[] = ['explore', 'model', 'challenge', 'generate', 'validate'];
    const index = order.indexOf(stage);
    return index >= 0 && index < order.length - 1 ? order[index + 1] : null;
  }

  private firstUnusableStageBefore(stage: WorkflowStage): WorkflowStage | null {
    const order: WorkflowStage[] = ['explore', 'model', 'challenge', 'generate', 'validate'];
    const index = order.indexOf(stage);
    if (index <= 0) return null;
    for (let i = 0; i < index; i++) {
      const status = this.state.workflow?.stages[order[i]]?.status;
      if (status !== 'passed' && status !== 'skipped') return order[i];
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

  private async stageExplore(input: WorkflowStartInput): Promise<WorkflowResponse | 'continue'> {
    const wf = this.workflow();
    if (isStageUsable(wf.stages.explore)) return 'continue';
    const tx = transitionWorkflow(wf, { type: 'stage:start', stage: 'explore' });
    if (!tx.ok) return 'continue';
    this.state.workflow = tx.envelope;
    saveState(this.state);

    const policy = evaluateExplorePolicy({
      requirementPath: input.requirementPath,
      evidence: input.evidence,
      blockedReason: input.blockedReason,
      flags: input.flags,
    });

    // `required` means live exploration MUST run (evidence missing/stale).
    // Run the Explore adapter (snapshot_page/discover_pages) and re-check the
    // policy against the fresh evidence. Only a hard block (e.g. no session
    // for a protected route) stops the workflow here.
    if (policy.status === 'required') {
      try {
        const live = await this.adapters.explore({
          requirementPath: input.requirementPath,
          role: input.roleFilter?.[0],
        });
        const refreshed = evaluateExplorePolicy({
          requirementPath: input.requirementPath,
          evidence: live.evidence,
          blockedReason: input.blockedReason,
          flags: input.flags,
        });
        if (refreshed.status === 'required' || refreshed.status === 'blocked') {
          const tx2 = transitionWorkflow(this.workflow(), {
            type: 'stage:block',
            stage: 'explore',
            reason: refreshed.reason,
          });
          if (tx2.ok) {
            this.state.workflow = { ...tx2.envelope, explore: refreshed };
          }
          this.markBlocked(refreshed.reason);
          return errorResponse(
            this.state.runId,
            [{ code: 'EXPLORE_REQUIRED', message: refreshed.reason, retryable: true }],
            'explore',
            'blocked',
            'Run snapshot_page/discover_pages for the requirement, then resume.',
          );
        }
        // Fresh evidence satisfied the policy — commit the decision.
        const tx2 = transitionWorkflow(this.workflow(), {
          type: 'stage:pass',
          stage: 'explore',
          reason: refreshed.reason,
        });
        if (!tx2.ok) {
          return errorResponse(
            this.state.runId,
            [{ code: 'EXPLORE_TRANSITION', message: tx2.error, retryable: false }],
            'explore',
            'failed',
          );
        }
        this.state.workflow = { ...tx2.envelope, explore: refreshed };
        saveState(this.state);
        return 'continue';
      } catch (err) {
        const tx2 = transitionWorkflow(this.workflow(), {
          type: 'stage:block',
          stage: 'explore',
          reason: err instanceof Error ? err.message : 'Live exploration failed',
        });
        if (tx2.ok) {
          this.state.workflow = { ...tx2.envelope, explore: policy };
        }
        this.markBlocked(err instanceof Error ? err.message : 'Live exploration failed');
        return errorResponse(
          this.state.runId,
          [
            {
              code: 'EXPLORE_REQUIRED',
              message: err instanceof Error ? err.message : 'Live exploration failed',
              retryable: true,
            },
          ],
          'explore',
          'blocked',
          'Fix the exploration blocker (BASE_URL/session/network), then resume.',
        );
      }
    }

    // satisfied / recommended / skipped: commit decision; recommended still
    // proceeds in automatic mode — recorded as a policy decision.
    const target: 'pass' | 'skip' = policy.status === 'skipped' ? 'skip' : 'pass';
    const tx2 = transitionWorkflow(this.workflow(), {
      type: target === 'skip' ? 'stage:skip' : 'stage:pass',
      stage: 'explore',
      reason: policy.reason,
    });
    if (!tx2.ok) {
      return errorResponse(
        this.state.runId,
        [{ code: 'EXPLORE_TRANSITION', message: tx2.error, retryable: false }],
        'explore',
        'failed',
      );
    }
    // Live exploration only when the policy asks for it.
    if (policy.status === 'recommended') {
      try {
        const live = await this.adapters.explore({
          requirementPath: input.requirementPath,
          role: input.roleFilter?.[0],
        });
        policy.evidencePaths = live.evidence.map((e) => e.path);
      } catch {
        // Exploration failed but evidence policy already passed — record and continue.
      }
    }
    this.state.workflow = { ...tx2.envelope, explore: policy };
    saveState(this.state);
    return 'continue';
  }

  private async stageModel(input: WorkflowStartInput): Promise<WorkflowResponse | 'continue'> {
    const wf = this.workflow();
    const tx = transitionWorkflow(wf, { type: 'stage:start', stage: 'model' });
    if (!tx.ok) return 'continue';
    this.state.workflow = tx.envelope;
    saveState(this.state);

    let result: ModelAdapterResult;
    try {
      result = await this.adapters.model({
        requirementPath: input.requirementPath,
        roleFilter: input.roleFilter,
      });
    } catch (err) {
      const tx2 = transitionWorkflow(this.workflow(), {
        type: 'stage:fail',
        stage: 'model',
        reason: err instanceof Error ? err.message : 'Model adapter failed',
      });
      if (tx2.ok) {
        this.state.workflow = tx2.envelope;
      }

      // Planner handoff: the plan artifact is missing — this is a PAUSED run
      // waiting for external Planner output, never a terminal failure.
      if (err instanceof ModelHandoffError) {
        this.markPaused(err.message);
        const resumeInstruction = `Run the Planner to create ${err.requiredArtifactPath}, then resume: npx tsx tools/scripts/workflow-run.ts ${input.requirementPath} --resume --run-id ${this.state.runId}`;
        return {
          status: 'in-progress',
          runId: this.state.runId,
          workflowStage: 'model',
          workflowStatus: 'blocked',
          nextRequiredAction: resumeInstruction,
          phase: 'model',
          result: {
            handoff: {
              handoffType: err.handoffType,
              requiredArtifactPath: err.requiredArtifactPath,
              resumeInstruction,
            },
          },
        };
      }

      // Model failure waiting on external input (e.g. missing plan = Planner
      // handoff) pauses the run — it must not stay `running` after exit.
      this.markPaused(err instanceof Error ? err.message : 'Model failed');
      return errorResponse(
        this.state.runId,
        [
          {
            code: 'MODEL_FAILED',
            message: err instanceof Error ? err.message : 'Model failed',
            retryable: true,
          },
        ],
        'model',
        'failed',
        'Fix the requirement/plan input and re-run Model.',
      );
    }

    const modelResult = {
      status: 'passed' as const,
      ...result,
      requirementHash: this.state.requirementHash ?? result.requirementHash,
    };
    const tx2 = transitionWorkflow(this.workflow(), {
      type: 'stage:pass',
      stage: 'model',
      reason: `Model passed: ${result.scenarioCount} scenarios, ${result.coverageGapCount} coverage gaps.`,
    });
    if (!tx2.ok) {
      return errorResponse(
        this.state.runId,
        [{ code: 'MODEL_TRANSITION', message: tx2.error, retryable: false }],
        'model',
        'failed',
      );
    }
    this.state.workflow = { ...tx2.envelope, model: modelResult };
    this.state.planHash = result.planHash;
    this.state.completedPhases = [...this.state.completedPhases, 'plan'];
    this.state.currentPhase = 'plan';
    saveState(this.state);
    return 'continue';
  }

  private async stageChallenge(input: WorkflowStartInput): Promise<WorkflowResponse | 'continue'> {
    const wf = this.workflow();
    const prerequisite = this.firstUnusableStageBefore('challenge');
    if (prerequisite) {
      const reason = `Challenge cannot run before '${prerequisite}' passes or is skipped.`;
      const tx = transitionWorkflow(wf, { type: 'stage:block', stage: 'challenge', reason });
      if (tx.ok) this.state.workflow = tx.envelope;
      this.markBlocked(reason);
      return errorResponse(
        this.state.runId,
        [{ code: 'CHALLENGE_BLOCKED', message: reason, retryable: false }],
        'challenge',
        'blocked',
        `Run '${prerequisite}' before Challenge.`,
      );
    }
    const tx = transitionWorkflow(wf, { type: 'stage:start', stage: 'challenge' });
    if (!tx.ok) return 'continue';
    this.state.workflow = tx.envelope;
    saveState(this.state);

    const model = this.state.workflow.model;
    if (!model || model.status !== 'passed') {
      const tx2 = transitionWorkflow(this.workflow(), {
        type: 'stage:block',
        stage: 'challenge',
        reason: 'Model is not passed — Challenge cannot run.',
      });
      if (tx2.ok) {
        this.state.workflow = tx2.envelope;
      }
      this.markBlocked('Model must pass before Challenge.');
      return errorResponse(
        this.state.runId,
        [
          {
            code: 'CHALLENGE_BLOCKED',
            message: 'Model must pass before Challenge.',
            retryable: false,
          },
        ],
        'challenge',
        'blocked',
        'Fix and re-run Model.',
      );
    }

    const explore = this.state.workflow.explore!;
    let adapter: ChallengeAdapterResult;
    try {
      adapter = await this.adapters.challenge({
        planPath: model.planPath,
        requirementPath: input.requirementPath,
        mode: input.orchestrationMode,
      });
    } catch (err) {
      const tx2 = transitionWorkflow(this.workflow(), {
        type: 'stage:fail',
        stage: 'challenge',
        reason: err instanceof Error ? err.message : 'Challenge adapter failed',
      });
      if (tx2.ok) {
        this.state.workflow = tx2.envelope;
        saveState(this.state);
      }
      return errorResponse(
        this.state.runId,
        [
          {
            code: 'CHALLENGE_FAILED',
            message: err instanceof Error ? err.message : 'Challenge failed',
            retryable: true,
          },
        ],
        'challenge',
        'failed',
      );
    }

    const verdict = evaluateChallenge({
      explore,
      model,
      diagnostics: adapter.diagnostics,
      assumptions: adapter.assumptions,
      coverageGaps: adapter.coverageGaps,
      assertionCount: adapter.assertionCount,
      assumptionCount: adapter.assumptionCount,
      coverageGapCount: adapter.coverageGapCount,
      validatorStatus: adapter.validatorStatus,
      mode: input.orchestrationMode,
    });
    const tx2 = transitionWorkflow(this.workflow(), {
      type:
        verdict.result.status === 'passed'
          ? 'stage:pass'
          : verdict.result.status === 'needs-review'
            ? 'stage:needs-review'
            : 'stage:block',
      stage: 'challenge',
      reason: verdict.result.reason ?? '',
    });
    if (!tx2.ok) {
      return errorResponse(
        this.state.runId,
        [{ code: 'CHALLENGE_TRANSITION', message: tx2.error, retryable: false }],
        'challenge',
        'failed',
      );
    }
    this.state.workflow = { ...tx2.envelope, challenge: verdict.result };
    saveState(this.state);

    if (!verdict.allow) {
      const reason = verdict.result.reason ?? 'Challenge did not approve Generate.';
      this.markBlocked(reason);
      return errorResponse(
        this.state.runId,
        [{ code: 'CHALLENGE_BLOCKED', message: reason, retryable: false }],
        'challenge',
        verdict.result.status === 'needs-review' ? 'needs-review' : 'blocked',
        `Fix the test plan (${verdict.result.blockingCodes.join(', ') || 'warnings/assumptions'}) and re-run Challenge.`,
      );
    }
    return 'continue';
  }

  private async stageGenerate(input: WorkflowStartInput): Promise<WorkflowResponse | 'continue'> {
    const wf = this.workflow();
    const explore = wf.explore;
    const model = wf.model;
    const challenge = wf.challenge;

    if (!explore || !model || !challenge) {
      const missing = !explore ? 'Explore' : !model ? 'Model' : 'Challenge';
      const reason = `${missing} has not passed — Generate cannot run before all prerequisites are complete.`;
      const tx = transitionWorkflow(wf, { type: 'stage:block', stage: 'generate', reason });
      if (tx.ok) this.state.workflow = tx.envelope;
      this.markBlocked(reason);
      return errorResponse(
        this.state.runId,
        [{ code: 'GENERATE_BLOCKED', message: reason, retryable: false }],
        'generate',
        'blocked',
        `Run '${missing}' before Generate.`,
      );
    }

    const gate = canGenerate(explore, model, challenge);
    if (!gate.allow) {
      const tx = transitionWorkflow(wf, {
        type: 'stage:block',
        stage: 'generate',
        reason: gate.reason,
      });
      if (tx.ok) {
        this.state.workflow = tx.envelope;
      }
      this.markBlocked(gate.reason);
      return errorResponse(
        this.state.runId,
        [{ code: 'GENERATE_BLOCKED', message: gate.reason, retryable: false }],
        'generate',
        'blocked',
        gate.reason,
      );
    }

    const tx = transitionWorkflow(wf, { type: 'stage:start', stage: 'generate' });
    if (!tx.ok) return 'continue';
    this.state.workflow = tx.envelope;
    saveState(this.state);

    try {
      const result = await this.adapters.generate({
        requirementPath: input.requirementPath,
        planPath: model.planPath,
        roleFilter: input.roleFilter,
        runId: this.state.runId,
        ...(this.state.workflow.generate?.requiredOutputPaths
          ? { generatedFiles: this.state.workflow.generate.requiredOutputPaths }
          : {}),
      });

      // Task 4.2: an awaiting-generator result is a truthful PAUSED handoff —
      // never a Generate pass. `passed` requires mode=completed with files.
      if (result.mode !== 'completed') {
        const tx2 = transitionWorkflow(this.workflow(), {
          type: 'stage:block',
          stage: 'generate',
          reason: result.reason ?? 'Generator handoff pending.',
        });
        if (tx2.ok) {
          this.state.workflow = {
            ...tx2.envelope,
            generate: {
              status: 'blocked',
              reason: result.reason,
              generatedFiles: result.generatedFiles,
              testCount: result.testCount,
              requiredOutputPaths:
                result.generatedFiles.length > 0
                  ? result.generatedFiles
                  : [`tests/${path.basename(input.requirementPath).replace(/\.md$/i, '')}.spec.ts`],
              freshnessVerified: false,
            },
          };
        }
        this.markPaused(result.reason ?? 'Awaiting external generator.');
        const resumeInstruction = `Run the Generator to produce ${'tests/<feature>[-<role>].spec.ts'}, then resume: npx tsx tools/scripts/workflow-run.ts ${input.requirementPath} --resume --run-id ${this.state.runId}`;
        return {
          status: 'in-progress',
          runId: this.state.runId,
          workflowStage: 'generate',
          workflowStatus: 'blocked',
          nextRequiredAction: resumeInstruction,
          phase: 'generate',
          result: {
            handoff: {
              handoffType: 'awaiting-generator',
              resumeInstruction,
              reason: result.reason,
            },
          },
        };
      }

      const tx2 = transitionWorkflow(this.workflow(), {
        type: 'stage:pass',
        stage: 'generate',
        reason: `Generate passed: ${result.generatedFiles.length} files, ${result.testCount} tests.`,
      });
      if (!tx2.ok) {
        return errorResponse(
          this.state.runId,
          [{ code: 'GENERATE_TRANSITION', message: tx2.error, retryable: false }],
          'generate',
          'failed',
        );
      }
      this.state.workflow = {
        ...tx2.envelope,
        generate: { status: 'passed', ...result },
      };
      this.state.completedPhases = [...this.state.completedPhases, 'generate'];
      this.state.currentPhase = 'generate';
      this.state.artifacts.generate = result.generatedFiles;
      saveState(this.state);
      return 'continue';
    } catch (err) {
      const tx2 = transitionWorkflow(this.workflow(), {
        type: 'stage:fail',
        stage: 'generate',
        reason: err instanceof Error ? err.message : 'Generate adapter failed',
      });
      if (tx2.ok) {
        this.state.workflow = tx2.envelope;
      }
      this.markPaused(err instanceof Error ? err.message : 'Generate failed');
      return errorResponse(
        this.state.runId,
        [
          {
            code: 'GENERATE_FAILED',
            message: err instanceof Error ? err.message : 'Generate failed',
            retryable: true,
          },
        ],
        'generate',
        'failed',
        'Fix the generator input and re-run Generate.',
      );
    }
  }

  private async stageValidate(input: WorkflowStartInput): Promise<WorkflowResponse> {
    const wf = this.workflow();

    const firstPrerequisite = this.firstUnusableStageBefore('validate');
    if (firstPrerequisite) {
      const reason = `Validate cannot run before '${firstPrerequisite}' passes or is skipped.`;
      const tx = transitionWorkflow(wf, { type: 'stage:block', stage: 'validate', reason });
      if (tx.ok) this.state.workflow = tx.envelope;
      this.markBlocked(reason);
      return errorResponse(
        this.state.runId,
        [{ code: 'VALIDATE_BLOCKED', message: reason, retryable: false }],
        'validate',
        'blocked',
        `Run '${firstPrerequisite}' before Validate.`,
      );
    }

    // Resume guard: a run already waiting for the QA decision must not
    // re-execute tests (PC-01/PC-02 — no fabricated re-validation).
    if (wf.stages.validate.status === 'qa-decision-required') {
      return {
        status: 'in-progress',
        runId: this.state.runId,
        workflowStage: 'validate',
        workflowStatus: 'qa-decision-required',
        nextRequiredAction:
          'This run already completed Validate. Record the explicit QA decision (archive_report) — do not re-run tests.',
        phase: 'report',
        result: { validate: wf.validate },
      };
    }

    const tx = transitionWorkflow(wf, { type: 'stage:start', stage: 'validate' });
    if (!tx.ok) {
      return errorResponse(
        this.state.runId,
        [{ code: 'VALIDATE_TRANSITION', message: tx.error, retryable: false }],
        'validate',
        'failed',
      );
    }
    this.state.workflow = { ...tx.envelope, currentSubstage: 'execute' };
    saveState(this.state);

    const generated = this.state.workflow.generate?.generatedFiles ?? [];
    if (generated.length === 0) {
      const reason = 'No executable generated files are available for Validate.';
      this.markPaused(reason);
      return {
        status: 'in-progress',
        runId: this.state.runId,
        workflowStage: 'validate',
        workflowStatus: 'blocked',
        nextRequiredAction: `Run the Generator to create tests, then resume with the same runId: npx tsx tools/scripts/workflow-run.ts ${input.requirementPath} --resume --run-id ${this.state.runId}`,
        phase: 'generate',
        result: { handoff: { handoffType: 'awaiting-generator', reason } },
      };
    }
    try {
      const result = await this.adapters.validate({
        requirementPath: input.requirementPath,
        generatedFiles: generated,
        runId: this.state.runId,
      });
      const analysisComplete =
        result.analysisCompleted === true &&
        result.analysisVerified === true &&
        result.analysisVerdict === 'complete';
      if (!analysisComplete) {
        // C3/C4: without verified Report(Analyze), Validate is needs-review,
        // never QA-decision-required and never success.
        const analysisTx = transitionWorkflow(this.workflow(), {
          type: 'stage:needs-review',
          stage: 'validate',
          reason: 'Report(Analyze) evidence is incomplete or unverifiable.',
        });
        if (analysisTx.ok) this.state.workflow = analysisTx.envelope;
        this.state.workflow = {
          ...this.workflow(),
          currentSubstage: 'report-analyze',
          validate: {
            status: 'needs-review',
            substage: 'report-analyze',
            unresolvedFailures: result.unresolvedFailures,
            reason: 'Report(Analyze) evidence is incomplete or unverifiable.',
          },
        };
        let incompleteFeedback: FeedbackDecision | undefined;
        if (result.unresolvedFailures > 0 && Array.isArray(result.failureList)) {
          const firstFailure = result.failureList[0] as Record<string, unknown> | undefined;
          incompleteFeedback = routeFeedback({
            failureSource:
              typeof firstFailure?.failureSource === 'string'
                ? (firstFailure.failureSource as FeedbackInput['failureSource'])
                : 'unknown',
            message: String(firstFailure?.message ?? 'Unresolved failure'),
            evidencePaths: [],
            authRedirect: firstFailure?.authRedirect === true,
          });
          const feedbackTx = transitionWorkflow(this.workflow(), {
            type: 'feedback',
            decision: incompleteFeedback,
          });
          if (feedbackTx.ok)
            this.state.workflow = this.invalidateDownstream(
              feedbackTx.envelope,
              incompleteFeedback.loopTarget,
            );
        }
        this.markPaused('Report(Analyze) proof is incomplete.');
        return {
          status: 'in-progress',
          runId: this.state.runId,
          workflowStage: 'validate',
          workflowStatus: 'needs-review',
          nextRequiredAction: incompleteFeedback
            ? `Route to '${incompleteFeedback.loopTarget}' (${incompleteFeedback.failureSource}): ${incompleteFeedback.reason}`
            : 'Run Reporter Analyze and verify analysis.completed, analysisVerified, analysisVerdict=complete before QA decision.',
          phase: 'report',
          result: {
            validate: this.state.workflow.validate,
            ...(incompleteFeedback ? { feedback: incompleteFeedback } : {}),
          },
        };
      }

      const validateResult = {
        status: result.unresolvedFailures === 0 ? ('passed' as const) : ('needs-review' as const),
        substage: result.substage,
        unresolvedFailures: result.unresolvedFailures,
      };
      if (result.unresolvedFailures === 0) {
        const tx2 = transitionWorkflow(this.workflow(), {
          type: 'stage:qa-decision',
          stage: 'validate',
          reason: 'Validate completed with no unresolved failures.',
          completionProof: {
            analysisCompleted: true,
            analysisVerified: true,
            analysisVerdict: 'complete',
          },
        });
        if (!tx2.ok) {
          return errorResponse(
            this.state.runId,
            [{ code: 'VALIDATE_TRANSITION', message: tx2.error, retryable: false }],
            'validate',
            'failed',
          );
        }
        this.state.workflow = {
          ...tx2.envelope,
          currentSubstage: result.substage,
          validate: validateResult,
        };
      } else {
        const reviewTx = transitionWorkflow(this.workflow(), {
          type: 'stage:needs-review',
          stage: 'validate',
          reason: `Validate finished with ${result.unresolvedFailures} unresolved failure(s).`,
        });
        this.state.workflow = reviewTx.ok
          ? {
              ...reviewTx.envelope,
              currentSubstage: result.substage,
              validate: validateResult,
            }
          : {
              ...this.workflow(),
              currentSubstage: result.substage,
              validate: validateResult,
            };
      }
      this.state.status = 'paused'; // WAITING for an explicit QA decision
      // PC-04: only mark physical phases completed when their substeps REALLY
      // ran. The validate adapter reports which substages executed.
      const completedPhysical: PipelinePhase[] = [];
      if (
        result.substage === 'execute' ||
        result.substage === 'heal' ||
        result.substage === 'report-analyze' ||
        result.substage === 'qa-review'
      ) {
        completedPhysical.push('execute');
      }
      if (
        result.substage === 'heal' ||
        result.substage === 'report-analyze' ||
        result.substage === 'qa-review'
      ) {
        completedPhysical.push('heal');
      }
      if (result.substage === 'report-analyze' || result.substage === 'qa-review') {
        completedPhysical.push('report');
      }
      this.state.completedPhases = [
        ...new Set([...this.state.completedPhases, ...completedPhysical]),
      ];

      // Task 6.1: route unresolved failures to the smallest responsible stage
      // and persist the decision (bounded by loopCounts).
      let feedback: FeedbackDecision | undefined;
      if (result.unresolvedFailures > 0) {
        const firstFailure =
          Array.isArray(result.failureList) && result.failureList.length > 0
            ? (result.failureList[0] as Record<string, unknown>)
            : undefined;
        const failureMessage = String(
          firstFailure?.errorMessage ?? firstFailure?.message ?? 'Unresolved failure',
        );
        const failureSource =
          firstFailure && typeof firstFailure.failureSource === 'string'
            ? (firstFailure.failureSource as FeedbackInput['failureSource'])
            : 'unknown';
        const authRedirect =
          firstFailure && typeof firstFailure.authRedirect === 'boolean'
            ? firstFailure.authRedirect
            : /login required|session expired|redirected to login|kredensial tidak valid/i.test(
                failureMessage,
              );
        const evidencePaths: string[] = [];
        if (typeof firstFailure?.tracePath === 'string' && firstFailure.tracePath) {
          evidencePaths.push(firstFailure.tracePath);
        }
        if (typeof firstFailure?.screenshotPath === 'string' && firstFailure.screenshotPath) {
          evidencePaths.push(firstFailure.screenshotPath);
        }
        feedback = routeFeedback({
          failureSource,
          message: failureMessage,
          evidencePaths,
          authRedirect,
        });
        const currentLoopCount = this.workflow().loopCounts[feedback.loopTarget] ?? 0;
        if (currentLoopCount >= 3) {
          feedback = {
            ...feedback,
            loopTarget: 'blocked',
            reason: `Semantic re-entry limit reached for '${feedback.loopTarget}' (max 3). Human/QA decision required.`,
          };
        }
        const tx3 = transitionWorkflow(this.workflow(), { type: 'feedback', decision: feedback });
        if (tx3.ok) {
          this.state.workflow = this.invalidateDownstream(tx3.envelope, feedback.loopTarget);
        }
      }
      saveState(this.state);

      return {
        status: result.unresolvedFailures === 0 ? 'success' : 'in-progress',
        runId: this.state.runId,
        workflowStage: 'validate',
        workflowStatus: result.unresolvedFailures === 0 ? 'qa-decision-required' : 'needs-review',
        nextRequiredAction:
          result.unresolvedFailures === 0
            ? 'Review the report and record an explicit QA decision (archive_report).'
            : feedback
              ? `Route to '${feedback.loopTarget}' (${feedback.failureSource}): ${feedback.reason}`
              : 'Inspect unresolved failures; classify and route (heal/file-bug/fix-environment).',
        phase: 'report',
        result: {
          validate: this.state.workflow.validate,
          ...(feedback ? { feedback } : {}),
        },
      };
    } catch (err) {
      const tx2 = transitionWorkflow(this.workflow(), {
        type: 'stage:fail',
        stage: 'validate',
        reason: err instanceof Error ? err.message : 'Validate adapter failed',
      });
      if (tx2.ok) {
        this.state.workflow = tx2.envelope;
        saveState(this.state);
      }
      return errorResponse(
        this.state.runId,
        [
          {
            code: 'VALIDATE_FAILED',
            message: err instanceof Error ? err.message : 'Validate failed',
            retryable: true,
          },
        ],
        'validate',
        'failed',
      );
    }
  }

  private invalidateDownstream(
    envelope: WorkflowEnvelope,
    target: WorkflowLoopTarget,
  ): WorkflowEnvelope {
    const order: WorkflowStage[] = ['explore', 'model', 'challenge', 'generate', 'validate'];
    const index = order.indexOf(target as WorkflowStage);
    if (index < 0) return envelope;
    const stages = { ...envelope.stages };
    for (let i = index; i < order.length; i++) {
      stages[order[i]] = {
        status: 'idle',
        reason: `Invalidated by feedback routed to '${target}'.`,
      };
    }
    const next: WorkflowEnvelope = {
      ...envelope,
      stages,
      currentStage: order.includes(target as WorkflowStage) ? (target as WorkflowStage) : null,
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

  private workflow(): WorkflowEnvelope {
    if (!this.state.workflow) {
      this.state.workflow = createWorkflowEnvelope('semantic-v1');
    }
    return this.state.workflow;
  }
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

// Re-export for protocol consumers.
export type { FeedbackInput };
export { routeFeedback };
