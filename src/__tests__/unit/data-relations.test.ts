import { test, expect } from '@playwright/test';
import { compileRequirementFromText } from '../../../tools/mcp/src/tools/compile-requirement';
import { validateTestPlan } from '../../../tools/mcp/src/tools/validate-plan';
import {
  TEST_PLAN_SCHEMA_V1,
  REQUIREMENT_SCHEMA_V1,
  type TestPlanContractV1,
  type RequirementContractV1,
} from '@/contracts';
import type { SeedRegistryFile } from '../../../tools/mcp/src/utils/seed-registry';

const REQUIREMENT_WITH_RELATIONS = `# REQ-ORDER-001: Customer Orders

## Metadata

| Field | Nilai |
| --- | --- |
| Tags | #ui |
| Auth state | authenticated |
| Module | sales |
| Feature | orders |

## Data Targets

| Entity | Operations | Covers |
| --- | --- | --- |
| customer | create | SC-01 |
| order | create, delete | SC-02 |

## Relationships

| Parent | Child | Name | Cardinality | On Delete | Confidence | Evidence |
| --- | --- | --- | --- | --- | --- | --- |
| customer | order | customer-orders | one-to-many | restrict | confirmed | requirement |

## Acceptance Criteria

| ID | Kriteria |
| --- | --- |
| AC-01 | Customer can be created |
| AC-02 | Order can be created and deleted |

## Skenario Uji

### SC-01: Buat Customer (@success)

| Field | Nilai |
| --- | --- |
| Test ID | \`TC-ORDER-001\` |
| Covers | \`AC-01\` |
| Data Operation | \`create\` |
| Data Entity | \`customer\` |
| Langkah | 1. Buka halaman customer |
| Hasil yang Diharapkan | Customer tampil di daftar |

### SC-02: Buat Order untuk Customer (@success)

| Field | Nilai |
| --- | --- |
| Test ID | \`TC-ORDER-002\` |
| Covers | \`AC-02\` |
| Data Operation | \`create\` |
| Data Entity | \`order\` |
| Seed Refs | \`seed:customer.active\` |
| Asserts Relations | customer-orders |
| Langkah | 1. Buat order untuk customer |
| Hasil yang Diharapkan | Order tampil milik customer tersebut |
`;

test.describe('requirement data model (CRUD + relations)', () => {
  test('parses data targets, relations, and per-scenario operation', () => {
    const result = compileRequirementFromText(REQUIREMENT_WITH_RELATIONS, 'requirements/orders.md');
    expect(result.status).toBe('success');
    const data = result.data!;

    expect(data.dataTargets).toEqual([
      { entity: 'customer', operations: ['create'], covers: ['SC-01'] },
      { entity: 'order', operations: ['create', 'delete'], covers: ['SC-02'] },
    ]);
    expect(data.relations?.[0]).toMatchObject({
      parent: 'customer',
      child: 'order',
      name: 'customer-orders',
      onDelete: 'restrict',
      confidence: 'confirmed',
    });

    const sc02 = data.scenarios.find((s) => s.id === 'SC-02')!;
    expect(sc02.dataOperation).toBe('create');
    expect(sc02.dataEntity).toBe('order');
    expect(sc02.seedRefs).toContain('customer.active');
    expect(sc02.assertsRelations).toContain('customer-orders');
  });

  test('rejects a scenario exercising an undeclared operation on a declared entity', () => {
    const text = REQUIREMENT_WITH_RELATIONS.replace(
      '| Data Operation | `create` |\n| Data Entity | `order` |',
      '| Data Operation | `update` |\n| Data Entity | `order` |',
    );
    const result = compileRequirementFromText(text, 'requirements/orders.md');
    const codes = result.diagnostics.map((d) => d.code);
    expect(codes).toContain('REQ_DATA_OPERATION_UNDECLARED');
    expect(result.status).toBe('error');
  });

  test('rejects a scenario asserting an undeclared relation', () => {
    const text = REQUIREMENT_WITH_RELATIONS.replace('customer-orders', 'order-invoices');
    const result = compileRequirementFromText(text, 'requirements/orders.md');
    const codes = result.diagnostics.map((d) => d.code);
    expect(codes).toContain('REQ_UNKNOWN_RELATION');
  });

  test('warns when a relation is only an assumption', () => {
    const text = REQUIREMENT_WITH_RELATIONS.replace('| confirmed |', '| assumption |');
    const result = compileRequirementFromText(text, 'requirements/orders.md');
    const warning = result.diagnostics.find((d) => d.code === 'REQ_RELATION_UNCONFIRMED');
    expect(warning?.severity).toBe('warning');
  });

  test('still compiles legacy requirements without data targets or relations', () => {
    const legacy = `# REQ-LEGACY-001: Plain

## Metadata

| Field | Nilai |
| --- | --- |
| Tags | #ui |
| Auth state | unauthenticated |
| Module | demo |
| Feature | plain |

## Acceptance Criteria

| ID | Kriteria |
| --- | --- |
| AC-01 | Page loads |

## Skenario Uji

### SC-01: Buka halaman (@success)

| Field | Nilai |
| --- | --- |
| Test ID | \`TC-LEGACY-001\` |
| Covers | \`AC-01\` |
| Langkah | 1. Buka halaman |
| Hasil yang Diharapkan | Halaman tampil |
`;
    const result = compileRequirementFromText(legacy, 'requirements/legacy.md');
    expect(result.status).toBe('success');
    expect(result.data?.dataTargets).toBeUndefined();
    expect(result.data?.relations).toBeUndefined();
  });
});

test.describe('plan data-coverage and relation gates', () => {
  const requirement: RequirementContractV1 = {
    schemaVersion: REQUIREMENT_SCHEMA_V1,
    requirementId: 'REQ-ORDER-001',
    title: 'Customer Orders',
    sourceHash: 'hash-orders',
    tags: [],
    auth: { state: 'authenticated', defaultRole: 'user' },
    roles: ['user'],
    accessMatrix: [],
    acceptanceCriteria: [
      { id: 'AC-01', description: 'Customer can be created' },
      { id: 'AC-02', description: 'Order can be created and deleted' },
    ],
    scenarios: [],
    dataTargets: [{ entity: 'order', operations: ['create', 'delete'] }],
  };

  const basePlan = (overrides: Partial<TestPlanContractV1> = {}): TestPlanContractV1 => ({
    schemaVersion: TEST_PLAN_SCHEMA_V1,
    sourceRequirementPath: 'requirements/orders.md',
    sourceRequirementHash: 'hash-orders',
    ...(overrides.dataTargets
      ? {}
      : { dataTargets: [{ entity: 'order', operations: ['create', 'delete'] as const }] }),
    catalogEvidence: [{ page: 'order-list' }],
    scenarios: [
      {
        scenarioId: 'SC-01',
        covers: ['AC-01'],
        page: 'order-list',
        executionMode: 'automated',
        dataSetup: ['seed:order.draft'],
        dataSetupTyped: { seeds: ['order.draft'], entity: 'order', operation: 'create' },
        actions: ['Create order in UI'],
        assertions: [{ description: 'Order visible', provenance: 'requirement' }],
        locatorIntent: ['getByRole("button", { name: "Buat" })'],
        networkExpectations: [],
        artifactExpectations: [],
        cleanup: ['residual data acceptable'],
        unknowns: [],
      },
    ],
    coverageGaps: [],
    diagnostics: [],
    ...overrides,
  });

  const registry: SeedRegistryFile = {
    schemaVersion: 1,
    seeds: [
      {
        name: 'order.draft',
        entity: 'order',
        create: { endpoint: '/api/orders', cleanupEndpoint: '/api/orders/{id}' },
      },
    ],
  };

  test('warns for a declared operation with no automated scenario and no gap', () => {
    const result = validateTestPlan(basePlan(), requirement, { seedRegistry: registry });
    const uncovered = result.diagnostics.find((d) => d.code === 'PLAN_DATA_OPERATION_UNCOVERED');
    expect(uncovered?.severity).toBe('warning');
    expect(uncovered?.message).toContain('delete');
    expect(result.data?.dataCoverageGapsCount).toBe(1);
  });

  test('passes when every declared operation is planned', () => {
    const plan = basePlan({
      scenarios: [
        ...basePlan().scenarios,
        {
          scenarioId: 'SC-02',
          covers: ['AC-02'],
          page: 'order-list',
          executionMode: 'automated',
          dataSetup: ['seed:order.draft'],
          dataSetupTyped: { seeds: ['order.draft'], entity: 'order', operation: 'delete' },
          actions: ['Delete order in UI'],
          assertions: [{ description: 'Order gone', provenance: 'requirement' }],
          locatorIntent: ['getByRole("button", { name: "Hapus" })'],
          networkExpectations: [],
          artifactExpectations: [],
          cleanup: ['residual data acceptable'],
          unknowns: [],
        },
      ],
    });
    const result = validateTestPlan(plan, requirement, { seedRegistry: registry });
    expect(result.diagnostics.some((d) => d.code === 'PLAN_DATA_OPERATION_UNCOVERED')).toBe(false);
  });

  test('blocks an assumption relation that is planned as runnable', () => {
    const plan = basePlan({
      relations: [
        {
          parent: 'customer',
          child: 'order',
          confidence: 'assumption',
          scenarioId: 'SC-01',
        },
      ],
    });
    const result = validateTestPlan(plan, requirement, { seedRegistry: registry });
    const violation = result.diagnostics.find((d) => d.code === 'PLAN_RELATION_UNCONFIRMED');
    expect(violation?.severity).toBe('error');
    expect(result.status).toBe('error');
  });

  test('blocks a confirmed relation whose seed producer is unregistered', () => {
    const plan = basePlan({
      relations: [
        {
          parent: 'customer',
          child: 'order',
          confidence: 'confirmed',
          scenarioId: 'SC-01',
          seedRef: 'customer.active',
        },
      ],
    });
    const result = validateTestPlan(plan, requirement, { seedRegistry: registry });
    const violation = result.diagnostics.find((d) => d.code === 'PLAN_RELATION_SEED_UNPROVISIONED');
    expect(violation?.severity).toBe('error');
    expect(result.data?.relationUnprovisionedCount).toBe(1);
  });

  test('warns when a registered seed has no executable producer', () => {
    const proseOnly: SeedRegistryFile = {
      schemaVersion: 1,
      seeds: [{ name: 'order.draft', producer: 'POST /api/orders by hand' }],
    };
    const plan = basePlan();
    plan.scenarios[0] = { ...plan.scenarios[0], evidenceMode: 'hybrid-ui' } as never;
    const result = validateTestPlan(plan, requirement, { seedRegistry: proseOnly });
    const warning = result.diagnostics.find((d) => d.code === 'PLAN_SEED_NOT_EXECUTABLE');
    expect(warning?.severity).toBe('warning');
  });
});
