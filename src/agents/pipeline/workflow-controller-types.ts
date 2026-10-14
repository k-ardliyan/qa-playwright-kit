/**
 * Workflow Controller — public type contracts
 *
 * The adapter seam and response/input contracts of the native semantic engine.
 * Kept separate from the WorkflowController facade so consumers can import the
 * types without pulling the class, and the facade stays a thin runtime shell.
 * The controller re-exports every type here — importing from
 * './workflow-controller' remains the supported path.
 *
 * @module agents/pipeline/workflow-controller-types
 */

import type { EvidenceReference } from './explore-policy';
import type {
  FeedbackDecision,
  ProtocolError,
  ValidateResult,
  WorkflowEnvelope,
  WorkflowStage,
  WorkflowStatus,
} from './types';

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
  force?: boolean;
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
  /**
   * Re-entry pass (feedback loop). When present, the runner narrows execution
   * to these titles via `--grep` — the failed subset only, never the full suite.
   */
  failedOnly?: { titles: string[] };
}

export interface ValidateAdapterResult {
  unresolvedFailures: number;
  substage: 'execute' | 'needs-heal' | 'heal' | 'report-analyze' | 'qa-review';
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
 * Why a run paused for external work. Each value names the artifact the
 * external actor must produce before the run can resume:
 * - `planner-required`     → the Planner must write `specs/<feature>-test-plan.md`
 * - `awaiting-generator`   → the Generator (AI or human) must write `tests/*.spec.ts`
 * - `adapter-failed`       → the Model adapter itself could not run (not a handoff
 *                            the caller can fill; surfaced so the shape stays closed)
 */
export type HandoffType = 'planner-required' | 'awaiting-generator' | 'adapter-failed';

/**
 * Machine-readable pause contract. `nextRequiredAction` is the human sentence;
 * this object is the same information in a shape an automated delegator can
 * parse without regexing prose.
 */
export interface WorkflowHandoff {
  handoffType: HandoffType;
  /** Path the external actor must write before resuming. */
  requiredArtifactPath?: string;
  /** Exact copy-paste resume command for this run. */
  resumeCommand?: string;
  /** Human-readable instruction (mirrors `nextRequiredAction`). */
  resumeInstruction?: string;
  reason?: string;
}

/**
 * Payload of a `WorkflowResponse.result`. Every producer sets at most one key,
 * so consumers narrow on the key they need instead of casting `unknown`.
 */
export interface WorkflowResult {
  /** Present on a paused run that is waiting for external work. */
  handoff?: WorkflowHandoff;
  /** Persisted workflow envelope after a single-stage `runStage` call. */
  workflowStage?: WorkflowEnvelope;
  /** Validate stage outcome (counts, substage, analysis proof). */
  validate?: ValidateResult;
  /** Bounded feedback routing decision, when a Validate pass routed a failure. */
  feedback?: FeedbackDecision;
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
  result?: WorkflowResult;
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
  /**
   * Optional checkpoint hook, fired after each stage completes successfully
   * ('continue' in run(), passed/skipped status in runStage()). The production
   * driver uses it to commit QA-zone outputs when the run is started with
   * `--auto-commit` / `QA_PIPELINE_AUTO_COMMIT=1`; the controller itself stays
   * persistence-only — no git, no I/O side effects live here.
   */
  onStageCompleted?: (stage: WorkflowStage) => void | Promise<void>;
}
