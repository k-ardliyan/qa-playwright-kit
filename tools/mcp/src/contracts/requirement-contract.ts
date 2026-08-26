/**
 * AUTO-SYNCED from src/contracts/requirement-contract.ts — do not edit by hand.
 * Run: npm run sync:mcp-generated  (also runs inside npm run mcp:build)
 */

import { type RequirementSchemaVersion } from './versions';
import { type Diagnostic } from './diagnostics';

export type InputDataSource = 'literal' | 'credential' | 'fixture' | 'seed' | 'generated';

export interface RequirementInputData {
  key: string;
  source: InputDataSource;
  value?: string;
  ref?: string;
}

export type ScenarioType = 'success' | 'failure' | 'access-restriction' | 'manual' | 'general';

export interface ScenarioAutomation {
  automatable: boolean;
  reason?: string;
}

export interface RequirementScenarioV1 {
  id: string;
  testId?: string;
  title: string;
  type: ScenarioType;
  priority?: 'low' | 'medium' | 'high' | 'critical';
  actor?: string;
  authContext?: string;
  capabilities: string[];
  affectedLayers: string[];
  covers: string[];
  preconditions: string[];
  inputData: RequirementInputData[];
  steps: string[];
  expectations: string[];
  automation: ScenarioAutomation;
}

export interface AccessMatrixEntry {
  role: string;
  access: 'allow' | 'deny' | 'conditional';
  expectation: string;
}

export interface AcceptanceCriterion {
  id: string;
  description: string;
}

export interface RequirementAuthScope {
  state?: 'authenticated' | 'unauthenticated';
  defaultRole?: string;
}

export interface RequirementContractV1 {
  schemaVersion: RequirementSchemaVersion;
  requirementId: string;
  title: string;
  sourcePath?: string;
  sourceHash: string;

  module?: string;
  feature?: string;
  priority?: 'low' | 'medium' | 'high' | 'critical';
  risk?: string[];
  tags: string[];

  auth: RequirementAuthScope;
  roles: string[];
  accessMatrix: AccessMatrixEntry[];

  startPage?: string;
  environmentScope?: string[];
  dataScope?: string[];

  acceptanceCriteria: AcceptanceCriterion[];
  scenarios: RequirementScenarioV1[];

  diagnostics?: Diagnostic[];
}
