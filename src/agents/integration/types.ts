/**
 * Shared Type Definitions — Agent AI Integration Layer
 *
 * Core types used across all integration layer modules:
 * protocol, state, hooks, orchestrator, manifest, and config generation.
 *
 * @module agents/integration/types
 */

/**
 * Pipeline execution phases in sequential order.
 */
export type PipelinePhase = 'plan' | 'generate' | 'execute' | 'heal' | 'report';

/**
 * Structured error returned by the protocol or pipeline phases.
 */
export interface ProtocolError {
  code: string;
  message: string;
  phase?: PipelinePhase;
  retryable: boolean;
}

/**
 * Result of a single pipeline phase execution.
 */
export interface PhaseResult {
  phase: PipelinePhase;
  status: 'success' | 'error';
  output?: unknown;
  artifacts?: string[];
  error?: ProtocolError;
}

/**
 * Descriptor for a supported orchestration mode.
 */
export interface OrchestrationModeDescriptor {
  mode: 'manual' | 'automatic';
  description: string;
}

/**
 * Semantic workflow stages in the evidence-driven QA lifecycle.
 */
export type WorkflowStage = 'explore' | 'model' | 'challenge' | 'generate' | 'validate';

/**
 * Ordered sequence of semantic workflow stages.
 */
export const WORKFLOW_STAGES: readonly WorkflowStage[] = [
  'explore',
  'model',
  'challenge',
  'generate',
  'validate',
] as const;

/**
 * Descriptor for a semantic workflow stage.
 */
export interface WorkflowStageDescriptor {
  stage: WorkflowStage;
  subCategory: string;
  activities: string[];
  statusLabel: string;
  physicalPhases: PipelinePhase[];
  notes?: string;
}

/**
 * Target destination for bounded feedback loops (LEARN → REFINE → RE-EXPLORE).
 */
export type WorkflowLoopTarget =
  | 'explore'
  | 'model'
  | 'challenge'
  | 'generate'
  | 'file-bug'
  | 'fix-environment'
  | 'blocked';

/**
 * Static definitions for all semantic workflow stages.
 */
export const WORKFLOW_STAGE_DEFINITIONS: Record<WorkflowStage, WorkflowStageDescriptor> = {
  explore: {
    stage: 'explore',
    subCategory: 'PLAYWRIGHT MCP',
    activities: [
      'Navigate',
      'Interact',
      'Inspect UI state',
      'Observe behaviour',
      'Collect evidence',
    ],
    statusLabel: 'THE APP ANSWERS',
    physicalPhases: [],
    notes: 'Observe what the application actually does and collect durable evidence.',
  },
  model: {
    stage: 'model',
    subCategory: 'UNDERSTAND THE FLOW',
    activities: [
      'User journey',
      'Expected behaviour',
      'State transitions',
      'Inputs / outputs',
      'Dependencies',
    ],
    statusLabel: 'SHARED MODEL',
    physicalPhases: ['plan'],
    notes:
      'Build a shared representation of journey, states, inputs, outputs, dependencies, and intent.',
  },
  challenge: {
    stage: 'challenge',
    subCategory: 'THINK LIKE QA',
    activities: [
      'What can fail?',
      "What's assumed?",
      'What deserves an assertion?',
      'Which edge cases matter?',
    ],
    statusLabel: 'THE GATE',
    physicalPhases: ['plan'],
    notes: 'Attack assumptions and decide what deserves assertions before automation.',
  },
  generate: {
    stage: 'generate',
    subCategory: 'PLAYWRIGHT AUTOMATION',
    activities: ['Test structure', 'Locators', 'Actions', 'Assertions', 'Reusable setup'],
    statusLabel: 'FOURTH, NOT FIRST',
    physicalPhases: ['generate'],
    notes: 'Produce maintainable Playwright automation from an approved model.',
  },
  validate: {
    stage: 'validate',
    subCategory: 'RUN • INSPECT • CORRECT',
    activities: [
      'Execute',
      'Analyse failures',
      'Expected vs actual',
      'Fix weak assumptions',
      'Refine',
    ],
    statusLabel: 'EARNED TRUST',
    physicalPhases: ['execute', 'heal', 'report'],
    notes:
      'Run, inspect, correct, classify, report, and obtain QA decision (substeps: Execute, Heal, Report(Analyze), QA Review).',
  },
};

/**
 * Pure lookup helper for a semantic workflow stage descriptor.
 */
export function getWorkflowStage(
  stage: WorkflowStage | string,
): WorkflowStageDescriptor | undefined {
  if (typeof stage === 'string' && stage in WORKFLOW_STAGE_DEFINITIONS) {
    return WORKFLOW_STAGE_DEFINITIONS[stage as WorkflowStage];
  }
  return undefined;
}

/**
 * Canonical status vocabulary for a semantic workflow stage.
 *
 * `idle` — not started; `required`/`recommended` — Explore policy outcomes;
 * `running` — stage in progress; `passed` — exit criteria proven;
 * `skipped` — explicitly skipped with a recorded reason;
 * `needs-review` — warnings/assumptions require a human decision;
 * `failed` — stage errored; `blocked` — a gate or precondition stopped the flow;
 * `qa-decision-required` — Validate finished, QA must decide.
 */
export type WorkflowStatus =
  | 'idle'
  | 'required'
  | 'recommended'
  | 'running'
  | 'passed'
  | 'skipped'
  | 'needs-review'
  | 'failed'
  | 'blocked'
  | 'qa-decision-required';

/**
 * Runtime state of a single semantic workflow stage.
 */
export interface WorkflowStageState {
  status: WorkflowStatus;
  /** Human-readable reason for the current status (skip reason, block reason, …). */
  reason?: string;
  /** ISO 8601 timestamp of the last transition. */
  updatedAt?: string;
}

/**
 * Explore policy decision: whether live UI evidence is needed before Model.
 */
export interface ExploreDecision {
  status: 'required' | 'recommended' | 'satisfied' | 'skipped' | 'blocked';
  reason: string;
  /** Durable evidence references (selector catalog / page-map paths). */
  evidencePaths: string[];
  /** Content hashes per evidence path, for freshness checks. */
  evidenceHashes: Record<string, string>;
  /** Role the evidence was captured with, when role-aware. */
  role?: string;
  /** ISO 8601 timestamp of the decision. */
  checkedAt: string;
}

/**
 * Model stage result: the compiled requirement/plan intent.
 */
export interface ModelResult {
  status: 'passed' | 'failed';
  planPath: string;
  planHash: string;
  requirementHash: string;
  scenarioCount: number;
  coverageGapCount: number;
  reason?: string;
}

/**
 * Challenge gate result: the verdict over the compiled plan.
 */
export interface ChallengeResult {
  status: 'passed' | 'blocked' | 'needs-review';
  planHash: string;
  /** Diagnostic codes that block Generate (severity error). */
  blockingCodes: string[];
  /** Diagnostic codes that only warn. */
  warningCodes: string[];
  assumptionCount: number;
  coverageGapCount: number;
  assertionCount: number;
  checkedAt: string;
  reason?: string;
  /** validate_plan result status that produced this verdict. */
  validatorStatus?: string;
  /** Orchestration mode the policy ran under. */
  policyMode?: 'manual' | 'automatic';
  /** True when the gate allowed a warning/gap under automatic policy. */
  policyAccepted?: boolean;
}

/**
 * Generate stage result: structural validation of generated specs.
 */
export interface GenerateResult {
  status: 'passed' | 'failed' | 'blocked';
  generatedFiles: string[];
  testCount: number;
  reason?: string;
  /** Baseline hashes captured before external Generator handoff. */
  baselineFiles?: Record<string, string>;
  /** Freshness proof on resume (created/changed files only). */
  freshnessVerified?: boolean;
  requiredOutputPaths?: string[];
}

/**
 * Validate stage result: grouped Execute → Heal → Report(Analyze) → QA Review.
 */
export interface ValidateResult {
  status: 'passed' | 'failed' | 'needs-review';
  substage: 'execute' | 'heal' | 'report-analyze' | 'qa-review';
  unresolvedFailures: number;
  reason?: string;
}

/**
 * Bounded feedback routing decision: where a failure re-enters the workflow.
 */
export interface FeedbackDecision {
  /** Smallest stage that can fix the finding. */
  loopTarget: WorkflowLoopTarget;
  /** Machine-readable failure classification, preserved alongside loopTarget. */
  failureSource: 'app' | 'test' | 'requirement' | 'env' | 'ai_generation' | 'unknown';
  reason: string;
  /** Evidence that drove the routing (trace/screenshot/console paths). */
  evidencePaths: string[];
}

/**
 * Additive semantic workflow envelope persisted inside PipelineState.
 */
export interface WorkflowEnvelope {
  schemaVersion: 'qa.workflow/v1';
  mode: 'semantic-v1' | 'physical-compat';
  currentStage: WorkflowStage | null;
  currentSubstage?: 'execute' | 'heal' | 'report-analyze' | 'qa-review';
  stages: Record<WorkflowStage, WorkflowStageState>;
  explore?: ExploreDecision;
  model?: ModelResult;
  challenge?: ChallengeResult;
  generate?: GenerateResult;
  validate?: ValidateResult;
  lastFeedback?: FeedbackDecision;
  loopCounts: Partial<Record<WorkflowLoopTarget, number>>;
}

/**
 * Derive semantic workflow stage from a physical pipeline phase.
 */
export function workflowStageForPhase(phase: PipelinePhase): WorkflowStage {
  switch (phase) {
    case 'plan':
      return 'model';
    case 'generate':
      return 'generate';
    case 'execute':
    case 'heal':
    case 'report':
      return 'validate';
  }
}
