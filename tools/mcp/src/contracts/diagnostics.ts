/**
 * AUTO-SYNCED from src/contracts/diagnostics.ts — do not edit by hand.
 * Run: npm run sync:mcp-generated  (also runs inside npm run mcp:build)
 */

/**
 * Canonical Diagnostic Codes and Structures
 *
 * Diagnostic codes are API contracts. Once published, their meaning
 * must remain stable.
 */

export type DiagnosticSeverity = 'info' | 'warning' | 'error';

export type DiagnosticCode =
  // Requirement diagnostics (REQ_*)
  | 'REQ_MISSING_MODULE'
  | 'REQ_MISSING_FEATURE'
  | 'REQ_INVALID_ID'
  | 'REQ_DUPLICATE_AC_ID'
  | 'REQ_DUPLICATE_SCENARIO_ID'
  | 'REQ_DUPLICATE_TEST_ID'
  | 'REQ_UNKNOWN_AC_REFERENCE'
  | 'REQ_ROLE_NOT_DECLARED'
  | 'REQ_ACCESS_MATRIX_CONFLICT'
  | 'REQ_CAPABILITY_CONTRACT_INCOMPLETE'
  | 'REQ_MALFORMED'
  | 'REQ_EMPTY_SCENARIOS'
  | 'REQ_NO_OBSERVABLE_RESULT'
  | 'REQ_LEGACY_AC_BULLET'
  | 'REQ_LEGACY_ROLE_PROSE'
  | 'REQ_LEGACY_POM_METADATA'

  // Test plan diagnostics (PLAN_*)
  | 'PLAN_SCENARIO_MISSING'
  | 'PLAN_AC_UNCOVERED'
  | 'PLAN_UNKNOWN_AC'
  | 'PLAN_ROLE_DRIFT'
  | 'PLAN_AUTH_DRIFT'
  | 'PLAN_EXPECTATION_DRIFT'
  | 'PLAN_UNREVIEWED_ASSUMPTION'
  | 'PLAN_UNKNOWN_PROVENANCE'
  | 'PLAN_STALE_REQUIREMENT'
  | 'PLAN_STALE'
  | 'PLAN_EPHEMERAL_REF'
  | 'PLAN_EPHEMERAL_REF_DETECTED'
  | 'PLAN_INVALID_EXECUTION_MODE'

  // Staleness, State & Traceability diagnostics
  | 'SPEC_STALE'
  | 'TEST_STALE'
  | 'PIPELINE_STATE_STALE'
  | 'GENERATED_TEST_MODIFIED'
  | 'CATALOG_DRIFT'
  | 'TRACEABILITY_STALE'
  | 'TRACE_HEURISTIC_LINK_USED'

  // Workspace & Environment diagnostics
  | 'WORKSPACE_PATH_DRIFT'
  | 'CONTRACT_VERSION_UNSUPPORTED'
  | 'TOOL_DEPRECATED'
  | 'INVALID_INPUT'
  | 'CONTRACT_VIOLATION'
  | 'NOT_FOUND'
  | 'ENVIRONMENT_ERROR'
  | 'TOOL_INTERNAL';

export interface DiagnosticLocation {
  line?: number;
  column?: number;
}

export interface Diagnostic {
  code: DiagnosticCode | string;
  severity: DiagnosticSeverity;
  message: string;
  path?: string;
  requirementId?: string;
  scenarioId?: string;
  testId?: string;
  location?: DiagnosticLocation;
  suggestion?: string;
}

export function createDiagnostic(
  code: DiagnosticCode | string,
  severity: DiagnosticSeverity,
  message: string,
  extra?: Partial<Omit<Diagnostic, 'code' | 'severity' | 'message'>>,
): Diagnostic {
  return {
    code,
    severity,
    message,
    ...extra,
  };
}
