import { type TraceabilitySchemaVersion } from './versions';
import { type Diagnostic } from './diagnostics';

export type ExecutionStatus =
  | 'passed'
  | 'failed'
  | 'timedOut'
  | 'skipped'
  | 'interrupted'
  | 'not-generated'
  | 'not-executed'
  | 'manual'
  | 'blocked';

export type FailureRootCause = 'app' | 'test' | 'requirement' | 'env' | 'ai_generation' | 'unknown';

export interface CoverageStateBreakdown {
  design: 'planned' | 'unplanned';
  automation:
    'automated' | 'manual' | 'mixed' | 'unautomated' | 'generated' | 'not-generated' | 'blocked';
  execution: 'executed' | 'not-executed' | 'passed' | 'failed' | 'skipped' | 'timed-out';
  verification:
    | 'unverified'
    | 'verified-pass'
    | 'verified-fail'
    | 'manual-verification-required'
    | 'passed'
    | 'failed'
    | 'healed';
}

export interface TraceabilityEvidence {
  tracePath?: string;
  screenshotPath?: string;
  videoPath?: string;
  errorContextPath?: string;
  reportPath?: string;
}

export interface TraceabilityScenarioNode {
  scenarioId: string;
  testId?: string;
  title: string;
  coversAcIds: string[];
  role?: string;
  authContext?: string;
  specFile?: string;
  executionStatus: ExecutionStatus;
  coverageState?: CoverageStateBreakdown;
  linkageType?: 'exact-test-id' | 'exact-scenario-id' | 'requirement-id' | 'heuristic-fallback';
  heuristicDiagnostic?: { reason: string; confidence: number };
  failureSource?: FailureRootCause;
  errorMessage?: string;
  evidence?: TraceabilityEvidence;
  lastRunAt?: string;
}

export interface TraceabilityAcNode {
  acId: string;
  description: string;
  coveredByScenarioIds: string[];
  status: 'covered' | 'uncovered' | 'partially-covered';
}

export interface TraceabilityContractV1 {
  schemaVersion: TraceabilitySchemaVersion;
  requirementId: string;
  requirementTitle: string;
  requirementPath: string;
  requirementHash: string;
  module?: string;
  feature?: string;

  acceptanceCriteria: TraceabilityAcNode[];
  scenarios: TraceabilityScenarioNode[];

  metrics: {
    totalAcs: number;
    coveredAcs: number;
    uncoveredAcs: number;
    totalScenarios: number;
    passingScenarios: number;
    failingScenarios: number;
    /** Scenarios that failed initially but were successfully healed in the same pipeline run. */
    healedScenarios: number;
    skippedScenarios: number;
    manualScenarios: number;
    blockedScenarios: number;
  };

  coverageState?: CoverageStateBreakdown;
  diagnostics?: Diagnostic[];
  generatedAt: string;
}
