/**
 * Unified Analyze-phase archive gate — MCP twin of
 * `src/agents/reporter/analysis-gate.ts` (the MCP server builds separately
 * and must not import from src/). Same verdicts, exact evidence semantics,
 * run binding, and Reporter proof requirement.
 *
 * @module tools/mcp/src/utils/analysis-gate
 */

export type McpAnalysisVerdict =
  | 'complete'
  | 'incomplete'
  | 'inconsistent'
  | 'unverifiable'
  | 'not-applicable';

export type McpAnalysisGateCode =
  | 'ANALYSIS_INCOMPLETE'
  | 'ANALYSIS_UNVERIFIABLE'
  | 'ANALYSIS_EVIDENCE_MISMATCH';

export interface McpAnalysisDeclaration {
  completed?: unknown;
  runInsightsRecorded?: unknown;
  passedScenariosReviewed?: unknown;
  reviewedPassedScenarioIds?: unknown;
}

export interface McpAnalysisEvidence {
  sidecarAvailable?: boolean;
  sidecarRunId?: string;
  expectedRunId?: string;
  runInsightsCount?: number;
  agentRunInsightsCount?: number;
  reporterRunInsightsCount?: number;
  passedCount?: number;
  passedScenarioIds?: string[];
}

export interface McpAnalysisGateResult {
  allowed: boolean;
  verdict: McpAnalysisVerdict;
  analysisVerified: boolean;
  code?: McpAnalysisGateCode;
  issues: string[];
}

/** Alias used by archive metadata consumers — one canonical status payload. */
export interface McpAnalysisVerdictPayload {
  analysisVerdict: McpAnalysisVerdict;
  analysisVerified: boolean;
  analysisIssues: string[];
}

/** A summary is pipeline-backed when either requirement identity is present. */
export function mcpIsPipelineContext(summary: Record<string, unknown>): boolean {
  return Boolean(
    (typeof summary['requirementPath'] === 'string' && summary['requirementPath'].trim()) ||
      (typeof summary['requirementId'] === 'string' && summary['requirementId'].trim()),
  );
}

/** Run insights authored by any agent source. */
export function mcpCountAgentRunInsights(notes: {
  runInsights?: Array<{ source?: string }>;
}): number {
  return (notes.runInsights ?? []).filter((e) => (e.source ?? 'analyzer') !== 'analyzer').length;
}

/** Run insights authored by the Reporter Analyze sub-phase. */
export function mcpCountReporterRunInsights(notes: {
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

export function mcpEvaluateAnalysisGate(options: {
  qaDecision: string;
  pipelineContext: boolean;
  declaration?: McpAnalysisDeclaration;
  evidence: McpAnalysisEvidence;
}): McpAnalysisGateResult {
  const { qaDecision, pipelineContext, declaration, evidence } = options;
  const issues: string[] = [];
  const isApprove = qaDecision === 'APPROVE';

  if (!pipelineContext && !declaration) {
    return { allowed: true, verdict: 'not-applicable', analysisVerified: false, issues };
  }

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
  const verdict: McpAnalysisVerdict = complete ? 'complete' : 'inconsistent';
  return {
    allowed: !isApprove || complete,
    verdict,
    analysisVerified: complete,
    ...(complete ? {} : { code: 'ANALYSIS_EVIDENCE_MISMATCH' as const }),
    issues,
  };
}
