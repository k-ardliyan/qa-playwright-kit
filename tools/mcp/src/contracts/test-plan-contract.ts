/**
 * AUTO-SYNCED from src/contracts/test-plan-contract.ts — do not edit by hand.
 * Run: npm run sync:mcp-generated  (also runs inside npm run mcp:build)
 */

import { type TestPlanSchemaVersion } from './versions';
import { type Diagnostic } from './diagnostics';

export type AssertionProvenance =
  'requirement' | 'live-verification' | 'framework-derived' | 'planner-assumption';

export interface PlanAssertion {
  description: string;
  provenance: AssertionProvenance;
}

export type PlanExecutionMode = 'automated' | 'manual' | 'blocked';

export interface PlanScenarioV1 {
  scenarioId: string;
  testId?: string;
  covers: string[];
  actor?: string;
  authContext?: string;

  executionMode: PlanExecutionMode;

  dataSetup: string[];
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

  module?: string;
  feature?: string;

  catalogEvidence: CatalogEvidence[];
  scenarios: PlanScenarioV1[];
  coverageGaps: CoverageGap[];
  diagnostics: Diagnostic[];
}
