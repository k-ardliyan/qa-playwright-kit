/**
 * Unified Analyze-phase archive gate.
 *
 * This is the single policy used by every archive path:
 *   - MCP `archive_report`
 *   - `saveLatestRun()` (dashboard Save + CLI archive:save)
 *
 * `analysis` is an agent declaration; sidecar counts/run identity are
 * independent evidence. A pipeline report is APPROVE-eligible only when both
 * agree exactly, the sidecar is bound to the same run, and the Reporter
 * Analyze insight is present.
 *
 * Plain, non-pipeline runs are deliberately `not-applicable` so legacy
 * Playwright-only reports remain archivable without inventing an Analyze claim.
 *
 * @module src/agents/reporter/analysis-gate
 */

export const ANALYSIS_VERDICTS = [
  'complete',
  'incomplete',
  'inconsistent',
  'unverifiable',
  'not-applicable',
] as const;
export type AnalysisVerdict = (typeof ANALYSIS_VERDICTS)[number];

export function isAnalysisVerdict(value: unknown): value is AnalysisVerdict {
  return typeof value === 'string' && (ANALYSIS_VERDICTS as readonly string[]).includes(value);
}

export type AnalysisGateCode =
  | 'ANALYSIS_INCOMPLETE'
  | 'ANALYSIS_UNVERIFIABLE'
  | 'ANALYSIS_EVIDENCE_MISMATCH';

/** `analysis` block declared by the Reporter in the pipeline report JSON. */
export interface AnalysisDeclaration {
  completed?: unknown;
  /** Exact total number of persisted run-level insights for this run. */
  runInsightsRecorded?: unknown;
  /** Number of passed scenarios reviewed by Analyze. */
  passedScenariosReviewed?: unknown;
  /** Optional independent list of reviewed passed scenario ids. */
  reviewedPassedScenarioIds?: unknown;
}

/** Independent evidence the framework can collect at archive time. */
export interface AnalysisEvidence {
  /** True when the latest sidecar was readable and present. */
  sidecarAvailable?: boolean;
  /** Sidecar run identity; must match expectedRunId for strict pipeline archive. */
  sidecarRunId?: string;
  /** Canonical run id the archive is about. */
  expectedRunId?: string;
  /** Total run insights in the sidecar (any source). */
  runInsightsCount?: number;
  /** Run insights authored by agent sources (not deterministic `analyzer`). */
  agentRunInsightsCount?: number;
  /** Run insights authored specifically by the Reporter Analyze sub-phase. */
  reporterRunInsightsCount?: number;
  /** Passed test count from the summary. */
  passedCount?: number;
  /** Passed scenario ids from the summary, when available. */
  passedScenarioIds?: string[];
}

export interface AnalysisGateResult {
  allowed: boolean;
  verdict: AnalysisVerdict;
  /** True only for a complete, evidence-verified pipeline analysis. */
  analysisVerified: boolean;
  code?: AnalysisGateCode;
  issues: string[];
}

export interface EvaluateAnalysisGateOptions {
  qaDecision: string;
  /** True when the run carries a requirement (pipeline context). */
  pipelineContext: boolean;
  /** `analysis` block from the pipeline report JSON, when available. */
  declaration?: AnalysisDeclaration;
  evidence: AnalysisEvidence;
}

/** A summary is pipeline-backed when either requirement identity is present. */
export function isPipelineContext(summary: Record<string, unknown>): boolean {
  return Boolean(
    (typeof summary['requirementPath'] === 'string' && summary['requirementPath'].trim()) ||
      (typeof summary['requirementId'] === 'string' && summary['requirementId'].trim()),
  );
}

/** Run insights authored by an agent source. */
export function countAgentRunInsights(notes: { runInsights?: Array<{ source?: string }> }): number {
  return (notes.runInsights ?? []).filter((e) => (e.source ?? 'analyzer') !== 'analyzer').length;
}

/** Run insights authored by the Reporter Analyze sub-phase. */
export function countReporterRunInsights(notes: {
  runInsights?: Array<{ source?: string }>;
}): number {
  return (notes.runInsights ?? []).filter((e) => e.source === 'reporter').length;
}

function invalidCount(value: unknown): boolean {
  return (
    value !== undefined && (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
  );
}

function declaredNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function validReviewedIds(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.every((id) => typeof id === 'string' && id.trim().length > 0) &&
    new Set(value).size === value.length
  );
}

export function evaluateAnalysisGate(options: EvaluateAnalysisGateOptions): AnalysisGateResult {
  const { qaDecision, pipelineContext, declaration, evidence } = options;
  const issues: string[] = [];
  const isApprove = qaDecision === 'APPROVE';

  // Plain runs carry no Analyze contract.
  if (!pipelineContext && !declaration) {
    return { allowed: true, verdict: 'not-applicable', analysisVerified: false, issues };
  }

  // A pipeline run must expose the Reporter declaration. Sidecar telemetry is
  // evidence, not a substitute: Generator/Healer notes alone cannot claim the
  // Reporter's Analyze sub-phase completed.
  if (!declaration || typeof declaration !== 'object') {
    return {
      allowed: !isApprove,
      verdict: 'unverifiable',
      analysisVerified: false,
      code: 'ANALYSIS_UNVERIFIABLE',
      issues: ['analysis block missing from pipeline report'],
    };
  }

  if (declaration.completed !== true && declaration.completed !== false) {
    issues.push('analysis.completed must be a boolean');
  } else if (declaration.completed !== true) {
    return {
      allowed: !isApprove,
      verdict: 'incomplete',
      analysisVerified: false,
      code: 'ANALYSIS_INCOMPLETE',
      issues: ['analysis.completed !== true'],
    };
  }

  if (invalidCount(declaration.runInsightsRecorded)) {
    issues.push('analysis.runInsightsRecorded must be a non-negative integer');
  }
  if (invalidCount(declaration.passedScenariosReviewed)) {
    issues.push('analysis.passedScenariosReviewed must be a non-negative integer');
  }
  if (
    declaration.reviewedPassedScenarioIds !== undefined &&
    !validReviewedIds(declaration.reviewedPassedScenarioIds)
  ) {
    issues.push('analysis.reviewedPassedScenarioIds must be a unique string array');
  }

  const declaredRunInsights = declaredNumber(declaration.runInsightsRecorded);
  const declaredPassedReviewed = declaredNumber(declaration.passedScenariosReviewed);

  if (!evidence.sidecarAvailable) {
    issues.push('sidecar evidence unavailable — run insight count could not be verified');
  }
  if (evidence.expectedRunId && evidence.sidecarRunId !== evidence.expectedRunId) {
    issues.push(
      evidence.sidecarRunId
        ? `sidecar runId (${evidence.sidecarRunId}) does not match expected runId (${evidence.expectedRunId})`
        : 'sidecar runId missing — evidence cannot be bound to this archive run',
    );
  }

  // Exact count semantics: declared total must equal persisted total. This
  // catches both over-claim and under-claim.
  if (declaredRunInsights === undefined) {
    issues.push('analysis.runInsightsRecorded missing from analysis block');
  } else if (
    evidence.runInsightsCount === undefined ||
    declaredRunInsights !== evidence.runInsightsCount
  ) {
    issues.push(
      evidence.runInsightsCount === undefined
        ? 'sidecar runInsights count unavailable'
        : `runInsightsRecorded (${declaredRunInsights}) does not match sidecar runInsights count (${evidence.runInsightsCount})`,
    );
  }

  // The Reporter's own Analyze call is the runtime proof. A Generator/Healer
  // note cannot satisfy this requirement.
  if ((evidence.reporterRunInsightsCount ?? 0) < 1) {
    issues.push('no Reporter Analyze run insight exists in the sidecar');
  }

  if (declaredPassedReviewed === undefined) {
    issues.push('analysis.passedScenariosReviewed missing from analysis block');
  } else if (evidence.passedCount !== undefined && declaredPassedReviewed > evidence.passedCount) {
    issues.push(
      `passedScenariosReviewed (${declaredPassedReviewed}) exceeds passed tests (${evidence.passedCount})`,
    );
  }

  if (validReviewedIds(declaration.reviewedPassedScenarioIds)) {
    const passedIds = new Set(evidence.passedScenarioIds ?? []);
    const unknown = declaration.reviewedPassedScenarioIds.filter((id) => !passedIds.has(id));
    if (unknown.length > 0) {
      issues.push(
        `reviewedPassedScenarioIds contains non-passed/unknown ids: ${unknown.join(', ')}`,
      );
    }
    if (
      declaredPassedReviewed !== undefined &&
      declaration.reviewedPassedScenarioIds.length !== declaredPassedReviewed
    ) {
      issues.push(
        `reviewedPassedScenarioIds count (${declaration.reviewedPassedScenarioIds.length}) does not match passedScenariosReviewed (${declaredPassedReviewed})`,
      );
    }
  }

  const complete = issues.length === 0;
  const verdict: AnalysisVerdict = complete ? 'complete' : 'inconsistent';
  const code: AnalysisGateCode | undefined = complete ? undefined : 'ANALYSIS_EVIDENCE_MISMATCH';

  return {
    allowed: !isApprove || complete,
    verdict,
    analysisVerified: complete,
    ...(code ? { code } : {}),
    issues,
  };
}
