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

/** CRUD-style operation a scenario or data target exercises. */
export type DataOperation = 'create' | 'read' | 'update' | 'delete' | 'transition';

/**
 * Provenance of a declared relation. `confirmed` means the rule is stated by
 * the requirement or documented domain contract; `assumption` means it was
 * inferred (for example from a UI label) and may NOT back a runnable
 * assertion until a human or the requirement confirms it.
 */
export type RelationConfidence = 'confirmed' | 'assumption';

/**
 * A declared relation between two entities. Foreign keys and cascade rules are
 * domain truths — never inferred from UI labels alone.
 */
export interface RequirementRelationV1 {
  /** Parent entity whose record must exist first (e.g. `customer`). */
  parent: string;
  /** Child entity that depends on the parent (e.g. `order`). */
  child: string;
  /** Stable relation name (`customer-orders`). */
  name?: string;
  cardinality?: 'one-to-one' | 'one-to-many' | 'many-to-many';
  /** Constraint the app enforces, e.g. `restrict` (parent cannot be deleted). */
  onDelete?: 'cascade' | 'restrict' | 'set-null' | 'none';
  confidence: RelationConfidence;
  /** Where the rule comes from: `requirement`, `domain-doc`, `api-contract`. */
  evidence?: string;
  notes?: string;
}

/** Declared data target: an entity plus the operations the tests must cover. */
export interface RequirementDataTargetV1 {
  entity: string;
  operations: DataOperation[];
  /** Scenario IDs that exercise this target. */
  covers?: string[];
  notes?: string;
}

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
  /** CRUD operation this scenario exercises, when the scenario targets data. */
  dataOperation?: DataOperation;
  /** Entity the operation targets (e.g. `invoice`). */
  dataEntity?: string;
  /** Seed refs this scenario depends on, without the `seed:` prefix. */
  seedRefs?: string[];
  /** Relations this scenario asserts (must reference a declared relation name/child). */
  assertsRelations?: string[];
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

  /**
   * Declared entity/operation coverage and entity relations. Optional: legacy
   * requirements carry neither and stay valid. When present they are the
   * source of truth for CRUD coverage and relational assertions.
   */
  dataTargets?: RequirementDataTargetV1[];
  relations?: RequirementRelationV1[];

  acceptanceCriteria: AcceptanceCriterion[];
  scenarios: RequirementScenarioV1[];

  diagnostics?: Diagnostic[];
}
