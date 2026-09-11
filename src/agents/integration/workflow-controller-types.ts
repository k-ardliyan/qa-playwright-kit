/**
 * Workflow Controller — public type contracts
 *
 * The adapter seam and response/input contracts of the native semantic engine.
 * Kept separate from the WorkflowController facade so consumers can import the
 * types without pulling the class, and the facade stays a thin runtime shell.
 * The controller re-exports every type here — importing from
 * './workflow-controller' remains the supported path.
 *
 * @module agents/integration/workflow-controller-types
 */

import type { EvidenceReference } from './explore-policy';
import type { ProtocolError, WorkflowStage, WorkflowStatus } from './types';

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
