/**
 * AUTO-SYNCED from src/contracts/test-plan-contract.ts — do not edit by hand.
 * Run: npm run sync:mcp-generated  (also runs inside npm run mcp:build)
 */

import { type TestPlanSchemaVersion } from './versions';
import { type Diagnostic } from './diagnostics';

export type AssertionProvenance =
  | 'requirement'
  | 'live-verification'
  | 'framework-derived'
  | 'planner-assumption';

export interface PlanAssertion {
  description: string;
  provenance: AssertionProvenance;
}

/**
 * `automated` — runnable now; `manual` — not applicable to automation (CAPTCHA,
 * physical device); `blocked` — a real, evidenced blocker; `not-implemented` —
 * planned but not yet built (page never explored, no catalog evidence). The last
 * one is WORK, not "skipped": the Generator emits `test.fixme`, never a silent
 * `test.skip`.
 */
export type PlanExecutionMode = 'automated' | 'manual' | 'blocked' | 'not-implemented';

/** Evidence path for browser scenarios; legacy plans default to ui-e2e. */
export type ScenarioEvidenceMode = 'ui-e2e' | 'hybrid-ui';

/** CRUD-style operation a planned scenario exercises. */
export type PlanDataOperation = 'create' | 'read' | 'update' | 'delete' | 'transition';

/**
 * Structured data setup for a planned scenario: which registered seed it
 * needs, which entity/operation it targets, and (for hybrid scenarios) that
 * the producer is registered rather than improvised in the spec.
 */
export interface PlanDataSetupV1 {
  /** `seed:<name>` refs, without the prefix. */
  seeds: string[];
  entity?: string;
  operation?: PlanDataOperation;
  /** Registered seed this scenario asserts a relation for. */
  assertsRelation?: string;
  notes?: string;
}

export interface PlanScenarioV1 {
  scenarioId: string;
  testId?: string;
  covers: string[];
  actor?: string;
  authContext?: string;

  /** Catalog page this scenario exercises — must appear in `catalogEvidence`. */
  page?: string;

  executionMode: PlanExecutionMode;
  evidenceMode?: ScenarioEvidenceMode;

  dataSetup: string[];
  /** Typed view of `dataSetup`: seeds, entity/operation, asserted relation. */
  dataSetupTyped?: PlanDataSetupV1;
  actions: string[];
  assertions: PlanAssertion[];

  locatorIntent: string[];
  networkExpectations: string[];
  artifactExpectations: string[];
  cleanup: string[];
  unknowns: string[];
}

export interface CoverageGap {
  scenarioId?: string;
  acceptanceCriterionId?: string;
  reason: string;
}

/** Entity/operation coverage the plan commits to (mirrors the requirement). */
export interface PlanDataTargetV1 {
  entity: string;
  operations: PlanDataOperation[];
  /** Scenario IDs that cover this target. */
  covers?: string[];
}

/**
 * Relation the plan asserts. `confidence: 'assumption'` relations may not be
 * asserted as runnable checks — they stay coverage gaps until confirmed.
 */
export interface PlanRelationV1 {
  name?: string;
  parent: string;
  child: string;
  confidence: 'confirmed' | 'assumption';
  /** Scenario that asserts this relation, when one exists. */
  scenarioId?: string;
  /** Seed that materializes the parent→child pair. */
  seedRef?: string;
}

export interface CatalogEvidence {
  page: string;
  catalogPath?: string;
  catalogHash?: string;
}

export interface TestPlanContractV1 {
  schemaVersion: TestPlanSchemaVersion;

  sourceRequirementPath: string;
  sourceRequirementHash: string;

  planPath?: string;
  planHash?: string;
  seed?: string;
  /** Agent-doctrine version that produced this plan (`doctrine/v1`); absent on
   *  plans compiled before the stamp existed. Compared against DOCTRINE_VERSION
   *  by validate_plan (PLAN_DOCTRINE_STALE) — a stale plan predates the current
   *  generator rules and should be recompiled. */
  doctrine?: string;

  module?: string;
  feature?: string;

  /** Entities/operations the plan commits to cover (mirrors the requirement). */
  dataTargets?: PlanDataTargetV1[];
  /** Relations the plan asserts, each pointing at a declared seed. */
  relations?: PlanRelationV1[];

  catalogEvidence: CatalogEvidence[];
  scenarios: PlanScenarioV1[];
  coverageGaps: CoverageGap[];
  diagnostics: Diagnostic[];
}
