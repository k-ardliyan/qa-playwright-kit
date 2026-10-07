import { test, expect } from '@playwright/test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { validateTestPlan, validatePlan } from '../../../tools/mcp/src/tools/validate-plan';
import {
  TEST_PLAN_SCHEMA_V1,
  REQUIREMENT_SCHEMA_V1,
  type TestPlanContractV1,
  type RequirementContractV1,
} from '@/contracts';

test.describe('validate_plan Test Plan Contract Gate (Phase 4)', () => {
  const sampleRequirement: RequirementContractV1 = {
    schemaVersion: REQUIREMENT_SCHEMA_V1,
    requirementId: 'REQ-AUTH-001',
    title: 'User Authentication',
    sourceHash: 'hash-req-123',
    tags: ['auth'],
    auth: { state: 'authenticated', defaultRole: 'finance' },
    roles: ['finance'],
    accessMatrix: [{ role: 'finance', access: 'allow', expectation: 'can approve' }],
    acceptanceCriteria: [
      { id: 'AC-01', description: 'Can login' },
      { id: 'AC-02', description: 'Can logout' },
    ],
    scenarios: [
      {
        id: 'SC-01',
        title: 'Login Success',
        type: 'success',
        actor: 'finance',
        authContext: '.auth/local/finance.json',
        capabilities: [],
        affectedLayers: ['FE'],
        covers: ['AC-01'],
        preconditions: [],
        inputData: [],
        steps: ['Enter creds', 'Click login'],
        expectations: ['Redirect to dashboard'],
        automation: { automatable: true },
      },
      {
        id: 'SC-02',
        title: 'Logout Success',
        type: 'success',
        actor: 'finance',
        authContext: '.auth/local/finance.json',
        capabilities: [],
        affectedLayers: ['FE'],
        covers: ['AC-02'],
        preconditions: [],
        inputData: [],
        steps: ['Click logout'],
        expectations: ['Redirect to login'],
        automation: { automatable: true },
      },
    ],
  };

  test('validates conforming test plan successfully', () => {
    const validPlan: TestPlanContractV1 = {
      schemaVersion: TEST_PLAN_SCHEMA_V1,
      sourceRequirementPath: 'requirements/auth/login.md',
      sourceRequirementHash: 'hash-req-123',
      catalogEvidence: [{ page: 'login-form' }],
      scenarios: [
        {
          scenarioId: 'SC-01',
          covers: ['AC-01'],
          actor: 'finance',
          authContext: '.auth/local/finance.json',
          page: 'login-form',
          executionMode: 'automated',
          dataSetup: [],
          actions: ['Fill login form', 'Submit'],
          assertions: [{ description: 'Dashboard is visible', provenance: 'requirement' }],
          locatorIntent: ['getByRole("button", { name: "Login" })'],
          networkExpectations: [],
          artifactExpectations: [],
          cleanup: [],
          unknowns: [],
        },
        {
          scenarioId: 'SC-02',
          covers: ['AC-02'],
          actor: 'finance',
          authContext: '.auth/local/finance.json',
          page: 'login-form',
          executionMode: 'automated',
          dataSetup: [],
          actions: ['Click logout button'],
          assertions: [{ description: 'Login form is visible', provenance: 'requirement' }],
          locatorIntent: ['getByRole("button", { name: "Logout" })'],
          networkExpectations: [],
          artifactExpectations: [],
          cleanup: [],
          unknowns: [],
        },
      ],
      coverageGaps: [],
      diagnostics: [],
    };

    const result = validateTestPlan(validPlan, sampleRequirement);
    expect(result.status).toBe('success');
    expect(result.data?.valid).toBe(true);
    expect(result.data?.coveredAcs).toBe(2);
  });

  test('flags automated scenarios whose page has no catalog evidence', () => {
    const plan: TestPlanContractV1 = {
      schemaVersion: TEST_PLAN_SCHEMA_V1,
      sourceRequirementPath: 'requirements/auth/login.md',
      sourceRequirementHash: 'hash-req-123',
      catalogEvidence: [{ page: 'login-form' }],
      scenarios: [
        {
          scenarioId: 'SC-01',
          covers: ['AC-01'],
          page: 'login-form',
          executionMode: 'automated',
          dataSetup: [],
          actions: [],
          assertions: [{ description: 'x', provenance: 'requirement' }],
          locatorIntent: [],
          networkExpectations: [],
          artifactExpectations: [],
          cleanup: [],
          unknowns: [],
        },
        {
          scenarioId: 'SC-02',
          covers: ['AC-02'],
          page: 'never-captured',
          executionMode: 'automated',
          dataSetup: [],
          actions: [],
          assertions: [{ description: 'x', provenance: 'requirement' }],
          locatorIntent: [],
          networkExpectations: [],
          artifactExpectations: [],
          cleanup: [],
          unknowns: [],
        },
      ],
      coverageGaps: [],
      diagnostics: [],
    };

    const result = validateTestPlan(plan, sampleRequirement);
    // Soft gate: the plan still validates (warning, not error) so old plans keep working...
    expect(result.data?.valid).toBe(true);
    expect(result.status).toBe('warning');
    const codes = (result.diagnostics ?? []).map((d) => d.code);
    expect(codes).toContain('PLAN_EVIDENCE_MISSING');
    // ...and the gap is counted, so QA sees the real backlog.
    expect(result.data?.evidenceGapsCount).toBe(1);
    expect(result.data?.coverageGapsCount).toBe(1);
  });

  test('flags an automated scenario that names no page at all', () => {
    const plan: TestPlanContractV1 = {
      schemaVersion: TEST_PLAN_SCHEMA_V1,
      sourceRequirementPath: 'requirements/auth/login.md',
      sourceRequirementHash: 'hash-req-123',
      catalogEvidence: [],
      scenarios: [
        {
          scenarioId: 'SC-01',
          covers: ['AC-01'],
          executionMode: 'automated',
          dataSetup: [],
          actions: [],
          assertions: [{ description: 'x', provenance: 'requirement' }],
          locatorIntent: [],
          networkExpectations: [],
          artifactExpectations: [],
          cleanup: [],
          unknowns: [],
        },
        {
          scenarioId: 'SC-02',
          covers: ['AC-02'],
          executionMode: 'automated',
          dataSetup: [],
          actions: [],
          assertions: [{ description: 'x', provenance: 'requirement' }],
          locatorIntent: [],
          networkExpectations: [],
          artifactExpectations: [],
          cleanup: [],
          unknowns: [],
        },
      ],
      coverageGaps: [],
      diagnostics: [],
    };

    const result = validateTestPlan(plan, sampleRequirement);
    const codes = (result.diagnostics ?? []).map((d) => d.code);
    expect(codes.filter((c) => c === 'PLAN_EVIDENCE_MISSING').length).toBe(2);
  });

  test('does not demand evidence for manual or not-implemented scenarios', () => {
    const plan: TestPlanContractV1 = {
      schemaVersion: TEST_PLAN_SCHEMA_V1,
      sourceRequirementPath: 'requirements/auth/login.md',
      sourceRequirementHash: 'hash-req-123',
      catalogEvidence: [],
      scenarios: [
        {
          scenarioId: 'SC-01',
          covers: ['AC-01'],
          executionMode: 'manual',
          dataSetup: [],
          actions: [],
          assertions: [],
          locatorIntent: [],
          networkExpectations: [],
          artifactExpectations: [],
          cleanup: [],
          unknowns: [],
        },
        {
          scenarioId: 'SC-02',
          covers: ['AC-02'],
          executionMode: 'not-implemented',
          dataSetup: [],
          actions: [],
          assertions: [],
          locatorIntent: [],
          networkExpectations: [],
          artifactExpectations: [],
          cleanup: [],
          unknowns: [],
        },
      ],
      coverageGaps: [{ scenarioId: 'SC-02', reason: 'page not explored' }],
      diagnostics: [],
    };

    const result = validateTestPlan(plan, sampleRequirement);
    const codes = (result.diagnostics ?? []).map((d) => d.code);
    expect(codes).not.toContain('PLAN_EVIDENCE_MISSING');
    expect(result.status).toBe('success');
  });

  test('names the available pages so a wrong Page value is correctable', () => {
    const plan: TestPlanContractV1 = {
      schemaVersion: TEST_PLAN_SCHEMA_V1,
      sourceRequirementPath: 'requirements/auth/login.md',
      sourceRequirementHash: 'hash-req-123',
      catalogEvidence: [{ page: 'login-form' }, { page: 'invoice-list' }],
      scenarios: [
        {
          scenarioId: 'SC-01',
          covers: ['AC-01'],
          page: 'auth/login-form', // wrong shape: feature dir included
          executionMode: 'automated',
          dataSetup: [],
          actions: [],
          assertions: [{ description: 'x', provenance: 'requirement' }],
          locatorIntent: [],
          networkExpectations: [],
          artifactExpectations: [],
          cleanup: [],
          unknowns: [],
        },
        {
          scenarioId: 'SC-02',
          covers: ['AC-02'],
          page: 'login-form',
          executionMode: 'automated',
          dataSetup: [],
          actions: [],
          assertions: [{ description: 'x', provenance: 'requirement' }],
          locatorIntent: [],
          networkExpectations: [],
          artifactExpectations: [],
          cleanup: [],
          unknowns: [],
        },
      ],
      coverageGaps: [],
      diagnostics: [],
    };

    const result = validateTestPlan(plan, sampleRequirement);
    const msg = (result.diagnostics ?? []).find((d) => d.code === 'PLAN_EVIDENCE_MISSING')?.message;
    expect(msg).toBeTruthy();
    // The actionable hint lists the pages that DO exist.
    expect(msg).toContain('Available pages: invoice-list, login-form.');
    // The correctly-named scenario is not flagged.
    expect(
      (result.diagnostics ?? []).filter((d) => d.code === 'PLAN_EVIDENCE_MISSING'),
    ).toHaveLength(1);
  });

  test('counts a recorded gap that also lost its evidence exactly once', () => {
    const plan: TestPlanContractV1 = {
      schemaVersion: TEST_PLAN_SCHEMA_V1,
      sourceRequirementPath: 'requirements/auth/login.md',
      sourceRequirementHash: 'hash-req-123',
      catalogEvidence: [{ page: 'login-form' }],
      scenarios: [
        {
          scenarioId: 'SC-01',
          covers: ['AC-01'],
          page: 'never-captured',
          executionMode: 'automated',
          dataSetup: [],
          actions: [],
          assertions: [{ description: 'x', provenance: 'requirement' }],
          locatorIntent: [],
          networkExpectations: [],
          artifactExpectations: [],
          cleanup: [],
          unknowns: [],
        },
        {
          scenarioId: 'SC-02',
          covers: ['AC-02'],
          page: 'login-form',
          executionMode: 'automated',
          dataSetup: [],
          actions: [],
          assertions: [{ description: 'x', provenance: 'requirement' }],
          locatorIntent: [],
          networkExpectations: [],
          artifactExpectations: [],
          cleanup: [],
          unknowns: [],
        },
      ],
      // SC-01 is BOTH recorded as a gap AND missing evidence — one gap, not two.
      coverageGaps: [{ scenarioId: 'SC-01', reason: 'page not explored' }],
      diagnostics: [],
    };

    const result = validateTestPlan(plan, sampleRequirement);
    expect(result.data?.coverageGapsCount).toBe(1);
    expect(result.data?.evidenceGapsCount).toBe(1);
  });

  test('flags a not-implemented scenario with no recorded reason', () => {
    const plan: TestPlanContractV1 = {
      schemaVersion: TEST_PLAN_SCHEMA_V1,
      sourceRequirementPath: 'requirements/auth/login.md',
      sourceRequirementHash: 'hash-req-123',
      catalogEvidence: [],
      scenarios: [
        {
          scenarioId: 'SC-01',
          covers: ['AC-01'],
          executionMode: 'not-implemented',
          dataSetup: [],
          actions: [],
          assertions: [],
          locatorIntent: [],
          networkExpectations: [],
          artifactExpectations: [],
          cleanup: [],
          unknowns: [],
        },
        {
          scenarioId: 'SC-02',
          covers: ['AC-02'],
          executionMode: 'automated',
          page: 'login-form',
          dataSetup: [],
          actions: [],
          assertions: [{ description: 'x', provenance: 'requirement' }],
          locatorIntent: [],
          networkExpectations: [],
          artifactExpectations: [],
          cleanup: [],
          unknowns: [],
        },
      ],
      coverageGaps: [],
      diagnostics: [],
    };

    const result = validateTestPlan(plan, sampleRequirement);
    const codes = (result.diagnostics ?? []).map((d) => d.code);
    expect(codes).toContain('PLAN_NOT_IMPLEMENTED_NO_GAP');
  });

  test('detects missing scenario and uncovered AC', () => {
    const incompletePlan: TestPlanContractV1 = {
      schemaVersion: TEST_PLAN_SCHEMA_V1,
      sourceRequirementPath: 'requirements/auth/login.md',
      sourceRequirementHash: 'hash-req-123',
      catalogEvidence: [],
      scenarios: [
        {
          scenarioId: 'SC-01',
          covers: ['AC-01'],
          actor: 'finance',
          executionMode: 'automated',
          dataSetup: [],
          actions: ['Fill login form'],
          assertions: [{ description: 'Dashboard is visible', provenance: 'requirement' }],
          locatorIntent: [],
          networkExpectations: [],
          artifactExpectations: [],
          cleanup: [],
          unknowns: [],
        },
      ],
      coverageGaps: [],
      diagnostics: [],
    };

    const result = validateTestPlan(incompletePlan, sampleRequirement);
    expect(result.status).toBe('error');
    const codes = result.diagnostics.map((d) => d.code);
    expect(codes).toContain('PLAN_SCENARIO_MISSING');
    expect(codes).toContain('PLAN_AC_UNCOVERED');
  });

  test('detects role drift and auth drift', () => {
    const driftingPlan: TestPlanContractV1 = {
      schemaVersion: TEST_PLAN_SCHEMA_V1,
      sourceRequirementPath: 'requirements/auth/login.md',
      sourceRequirementHash: 'hash-req-123',
      catalogEvidence: [],
      scenarios: [
        {
          scenarioId: 'SC-01',
          covers: ['AC-01', 'AC-02'],
          actor: 'super-admin', // DRIFT! Expected finance
          authContext: 'unauthenticated', // DRIFT! Expected .auth/local/finance.json
          executionMode: 'automated',
          dataSetup: [],
          actions: ['Login'],
          assertions: [{ description: 'Dashboard is visible', provenance: 'requirement' }],
          locatorIntent: [],
          networkExpectations: [],
          artifactExpectations: [],
          cleanup: [],
          unknowns: [],
        },
        {
          scenarioId: 'SC-02',
          covers: ['AC-02'],
          actor: 'finance',
          authContext: '.auth/local/finance.json',
          executionMode: 'automated',
          dataSetup: [],
          actions: ['Logout'],
          assertions: [{ description: 'Logout done', provenance: 'requirement' }],
          locatorIntent: [],
          networkExpectations: [],
          artifactExpectations: [],
          cleanup: [],
          unknowns: [],
        },
      ],
      coverageGaps: [],
      diagnostics: [],
    };

    const result = validateTestPlan(driftingPlan, sampleRequirement);
    expect(result.status).toBe('error');
    const codes = result.diagnostics.map((d) => d.code);
    expect(codes).toContain('PLAN_ROLE_DRIFT');
    expect(codes).toContain('PLAN_AUTH_DRIFT');
  });

  test('detects ephemeral browser references in locator intent and actions', () => {
    const ephemeralPlan: TestPlanContractV1 = {
      schemaVersion: TEST_PLAN_SCHEMA_V1,
      sourceRequirementPath: 'requirements/auth/login.md',
      sourceRequirementHash: 'hash-req-123',
      catalogEvidence: [],
      scenarios: [
        {
          scenarioId: 'SC-01',
          covers: ['AC-01'],
          actor: 'finance',
          authContext: '.auth/local/finance.json',
          executionMode: 'automated',
          dataSetup: [],
          actions: ['Click button ref:e124'], // Ephemeral ref!
          assertions: [{ description: 'Dashboard is visible', provenance: 'requirement' }],
          locatorIntent: ['tw-4921 button'], // Ephemeral trace handle!
          networkExpectations: [],
          artifactExpectations: [],
          cleanup: [],
          unknowns: [],
        },
        {
          scenarioId: 'SC-02',
          covers: ['AC-02'],
          actor: 'finance',
          authContext: '.auth/local/finance.json',
          executionMode: 'automated',
          dataSetup: [],
          actions: ['Logout'],
          assertions: [{ description: 'Logout done', provenance: 'requirement' }],
          locatorIntent: [],
          networkExpectations: [],
          artifactExpectations: [],
          cleanup: [],
          unknowns: [],
        },
      ],
      coverageGaps: [],
      diagnostics: [],
    };

    const result = validateTestPlan(ephemeralPlan, sampleRequirement);
    expect(result.status).toBe('error');
    const codes = result.diagnostics.map((d) => d.code);
    expect(codes).toContain('PLAN_EPHEMERAL_REF_DETECTED');
  });

  test('flags planner assumptions with warning', () => {
    const planWithAssumption: TestPlanContractV1 = {
      schemaVersion: TEST_PLAN_SCHEMA_V1,
      sourceRequirementPath: 'requirements/auth/login.md',
      sourceRequirementHash: 'hash-req-123',
      catalogEvidence: [],
      scenarios: [
        {
          scenarioId: 'SC-01',
          covers: ['AC-01'],
          actor: 'finance',
          authContext: '.auth/local/finance.json',
          executionMode: 'automated',
          dataSetup: [],
          actions: ['Fill login'],
          assertions: [
            { description: 'Assumed notification badge appears', provenance: 'planner-assumption' },
          ],
          locatorIntent: [],
          networkExpectations: [],
          artifactExpectations: [],
          cleanup: [],
          unknowns: [],
        },
        {
          scenarioId: 'SC-02',
          covers: ['AC-02'],
          actor: 'finance',
          authContext: '.auth/local/finance.json',
          executionMode: 'automated',
          dataSetup: [],
          actions: ['Logout'],
          assertions: [{ description: 'Logout done', provenance: 'requirement' }],
          locatorIntent: [],
          networkExpectations: [],
          artifactExpectations: [],
          cleanup: [],
          unknowns: [],
        },
      ],
      coverageGaps: [],
      diagnostics: [],
    };

    const result = validateTestPlan(planWithAssumption, sampleRequirement);
    expect(result.status).toBe('warning');
    const codes = result.diagnostics.map((d) => d.code);
    expect(codes).toContain('PLAN_UNREVIEWED_ASSUMPTION');
    expect(result.data?.assumptionsCount).toBe(1);
  });

  test('validates Markdown plan path directly via validatePlan()', () => {
    // Temp files under requirements/ + specs/: validatePlan resolves paths
    // against the repo allowlist, and a test must never depend on a
    // documentation file.
    const root = path.resolve(__dirname, '../../..');
    const stamp = `tmp-validate-plan-${process.pid}-${Date.now()}`;
    const reqDir = path.join(root, 'requirements');
    const specDir = path.join(root, 'specs');
    const reqPath = path.join(reqDir, `${stamp}.md`);
    const planPath = path.join(specDir, `${stamp}.plan.md`);

    fs.writeFileSync(
      reqPath,
      [
        '# REQ-T-001: Feature',
        '',
        '## Metadata',
        '',
        '| Field | Nilai |',
        '| --- | --- |',
        '| Module | `demo` |',
        '| Feature | `feature` |',
        '',
        '## Kriteria Penerimaan',
        '',
        '| ID | Kriteria |',
        '| --- | --- |',
        '| AC-01 | Sesuatu terjadi. |',
        '',
        '## Skenario Uji',
        '',
        '### SC-01: Alur Utama (@success)',
        '',
        '| Field | Nilai |',
        '| --- | --- |',
        '| Test ID | `TC-T-001` |',
        '| Covers | `AC-01` |',
        '| Langkah | 1. Buka halaman |',
        '| Hasil yang Diharapkan | - Halaman tampil |',
        '',
      ].join('\n'),
    );

    fs.writeFileSync(
      planPath,
      [
        '# PLAN-T-001: Test Plan',
        '',
        '## Metadata',
        '',
        '| Field | Nilai |',
        '| --- | --- |',
        `| Source requirement | \`requirements/${stamp}.md\` |`,
        '| Module | `demo` |',
        '| Feature | `feature` |',
        '',
        '## Scenarios',
        '',
        '### SC-01: Alur Utama',
        '',
        '| Field | Nilai |',
        '| --- | --- |',
        '| Test ID | `TC-T-001` |',
        '| Covers | `AC-01` |',
        '| Actions | Buka halaman |',
        '| Assertions | [requirement] Halaman tampil |',
        '',
      ].join('\n'),
    );

    try {
      const result = validatePlan({
        testPlanPath: `specs/${stamp}.plan.md`,
        requirementPath: `requirements/${stamp}.md`,
      });
      expect(result.data?.valid).toBe(true);
      expect(result.data?.plannedScenarios).toBe(1);
    } finally {
      fs.rmSync(reqPath, { force: true });
      fs.rmSync(planPath, { force: true });
    }
  });

  test('detects unknown AC reference in plan', () => {
    const planWithUnknownAc: TestPlanContractV1 = {
      schemaVersion: TEST_PLAN_SCHEMA_V1,
      sourceRequirementPath: 'requirements/auth/login.md',
      sourceRequirementHash: 'hash-req-123',
      catalogEvidence: [],
      scenarios: [
        {
          scenarioId: 'SC-01',
          covers: ['AC-999'],
          actor: 'finance',
          authContext: '.auth/local/finance.json',
          executionMode: 'automated',
          dataSetup: [],
          actions: ['Action'],
          assertions: [{ description: 'Done', provenance: 'requirement' }],
          locatorIntent: [],
          networkExpectations: [],
          artifactExpectations: [],
          cleanup: [],
          unknowns: [],
        },
      ],
      coverageGaps: [],
      diagnostics: [],
    };

    const result = validateTestPlan(planWithUnknownAc, sampleRequirement);
    expect(result.status).toBe('error');
    const codes = result.diagnostics.map((d) => d.code);
    expect(codes).toContain('PLAN_UNKNOWN_AC');
  });

  test('flags an automated scenario with catalog evidence but no Locator Intent', () => {
    const plan: TestPlanContractV1 = {
      schemaVersion: TEST_PLAN_SCHEMA_V1,
      sourceRequirementPath: 'requirements/auth/login.md',
      sourceRequirementHash: 'hash-req-123',
      catalogEvidence: [{ page: 'login-form' }],
      scenarios: [
        {
          scenarioId: 'SC-01',
          covers: ['AC-01'],
          page: 'login-form',
          executionMode: 'automated',
          dataSetup: [],
          actions: ['Fill login form'],
          assertions: [{ description: 'x', provenance: 'requirement' }],
          locatorIntent: [],
          networkExpectations: [],
          artifactExpectations: [],
          cleanup: [],
          unknowns: [],
        },
        {
          scenarioId: 'SC-02',
          covers: ['AC-02'],
          page: 'login-form',
          executionMode: 'automated',
          dataSetup: [],
          actions: ['Click logout'],
          assertions: [{ description: 'x', provenance: 'requirement' }],
          locatorIntent: ['getByRole("button", { name: "Logout" })'],
          networkExpectations: [],
          artifactExpectations: [],
          cleanup: [],
          unknowns: [],
        },
      ],
      coverageGaps: [],
      diagnostics: [],
    };

    const result = validateTestPlan(plan, sampleRequirement);
    // Soft gate: evidence exists, but `Locator Intent | none` makes the
    // Generator guess — the tes-qa failure shape (one shallow page "covering"
    // 37 automated scenarios).
    expect(result.data?.valid).toBe(true);
    const codes = (result.diagnostics ?? []).map((d) => d.code);
    expect(codes).toContain('PLAN_LOCATOR_INTENT_MISSING');
    expect(result.data?.locatorIntentGapsCount).toBe(1);
    // The evidence gate itself is satisfied — no double reporting.
    expect(codes).not.toContain('PLAN_EVIDENCE_MISSING');
  });

  test('does not double-flag a scenario whose page already lacks evidence', () => {
    const plan: TestPlanContractV1 = {
      schemaVersion: TEST_PLAN_SCHEMA_V1,
      sourceRequirementPath: 'requirements/auth/login.md',
      sourceRequirementHash: 'hash-req-123',
      catalogEvidence: [{ page: 'login-form' }],
      scenarios: [
        {
          scenarioId: 'SC-01',
          covers: ['AC-01'],
          page: 'never-captured',
          executionMode: 'automated',
          dataSetup: [],
          actions: [],
          assertions: [{ description: 'x', provenance: 'requirement' }],
          locatorIntent: [],
          networkExpectations: [],
          artifactExpectations: [],
          cleanup: [],
          unknowns: [],
        },
      ],
      coverageGaps: [],
      diagnostics: [],
    };

    const result = validateTestPlan(plan, sampleRequirement);
    const codes = (result.diagnostics ?? []).map((d) => d.code);
    expect(codes).toContain('PLAN_EVIDENCE_MISSING');
    expect(codes).not.toContain('PLAN_LOCATOR_INTENT_MISSING');
  });

  test('flags scenarios depending on seed: refs while Metadata declares no Seed', () => {
    const plan: TestPlanContractV1 = {
      schemaVersion: TEST_PLAN_SCHEMA_V1,
      sourceRequirementPath: 'requirements/hris/payroll.md',
      sourceRequirementHash: 'hash-req-123',
      seed: 'none',
      catalogEvidence: [{ page: 'payroll-form' }],
      scenarios: [
        {
          scenarioId: 'SC-04',
          covers: ['AC-05'],
          page: 'payroll-form',
          executionMode: 'automated',
          dataSetup: ['Terdapat payroll Draft.', 'Input: `namaPayroll: seed:payroll.draft`'],
          actions: [],
          assertions: [{ description: 'x', provenance: 'requirement' }],
          locatorIntent: ['getByRole("button", { name: "Proses" })'],
          networkExpectations: [],
          artifactExpectations: [],
          cleanup: [],
          unknowns: [],
        },
      ],
      coverageGaps: [],
      diagnostics: [],
    };

    const result = validateTestPlan(plan, sampleRequirement);
    const codes = (result.diagnostics ?? []).map((d) => d.code);
    expect(codes).toContain('PLAN_SEED_UNPROVISIONED');
    expect(result.data?.seedUnprovisionedCount).toBe(1);
  });

  test('passes when the plan declares its seed producer', () => {
    const plan: TestPlanContractV1 = {
      schemaVersion: TEST_PLAN_SCHEMA_V1,
      sourceRequirementPath: 'requirements/hris/payroll.md',
      sourceRequirementHash: 'hash-req-123',
      seed: 'tests/data/payroll-seeds.json',
      catalogEvidence: [{ page: 'payroll-form' }],
      scenarios: [
        {
          scenarioId: 'SC-04',
          covers: ['AC-05'],
          page: 'payroll-form',
          executionMode: 'automated',
          dataSetup: ['Input: `namaPayroll: seed:payroll.draft`'],
          actions: [],
          assertions: [{ description: 'x', provenance: 'requirement' }],
          locatorIntent: ['getByRole("button", { name: "Proses" })'],
          networkExpectations: [],
          artifactExpectations: [],
          cleanup: [],
          unknowns: [],
        },
      ],
      coverageGaps: [],
      diagnostics: [],
    };

    const result = validateTestPlan(plan, sampleRequirement);
    const codes = (result.diagnostics ?? []).map((d) => d.code);
    expect(codes).not.toContain('PLAN_SEED_UNPROVISIONED');
    expect(result.data?.seedUnprovisionedCount).toBe(0);
  });

  test('flags a plan explicitly stamped with an older doctrine', () => {
    const plan: TestPlanContractV1 = {
      schemaVersion: TEST_PLAN_SCHEMA_V1,
      sourceRequirementPath: 'requirements/auth/login.md',
      sourceRequirementHash: 'hash-req-123',
      doctrine: 'doctrine/v0',
      catalogEvidence: [{ page: 'login-form' }],
      scenarios: [
        {
          scenarioId: 'SC-01',
          covers: ['AC-01'],
          page: 'login-form',
          executionMode: 'automated',
          dataSetup: [],
          actions: [],
          assertions: [{ description: 'x', provenance: 'requirement' }],
          locatorIntent: ['getByRole("button")'],
          networkExpectations: [],
          artifactExpectations: [],
          cleanup: [],
          unknowns: [],
        },
        {
          scenarioId: 'SC-02',
          covers: ['AC-02'],
          page: 'login-form',
          executionMode: 'automated',
          dataSetup: [],
          actions: [],
          assertions: [{ description: 'x', provenance: 'requirement' }],
          locatorIntent: ['getByRole("button")'],
          networkExpectations: [],
          artifactExpectations: [],
          cleanup: [],
          unknowns: [],
        },
      ],
      coverageGaps: [],
      diagnostics: [],
    };

    const result = validateTestPlan(plan, sampleRequirement);
    const codes = (result.diagnostics ?? []).map((d) => d.code);
    expect(codes).toContain('PLAN_DOCTRINE_STALE');
  });

  test('flags seed refs unknown to an existing seed registry', () => {
    const plan: TestPlanContractV1 = {
      schemaVersion: TEST_PLAN_SCHEMA_V1,
      sourceRequirementPath: 'requirements/hris/payroll.md',
      sourceRequirementHash: 'hash-req-123',
      seed: 'tests/data/payroll-seeds.json',
      catalogEvidence: [{ page: 'payroll-form' }],
      scenarios: [
        {
          scenarioId: 'SC-04',
          covers: ['AC-01'],
          page: 'payroll-form',
          executionMode: 'automated',
          dataSetup: ['Input: `namaPayroll: seed:payroll.draft`'],
          actions: [],
          assertions: [{ description: 'x', provenance: 'requirement' }],
          locatorIntent: ['getByRole("button", { name: "Proses" })'],
          networkExpectations: [],
          artifactExpectations: [],
          cleanup: [],
          unknowns: [],
        },
        {
          scenarioId: 'SC-05',
          covers: ['AC-02'],
          page: 'payroll-form',
          executionMode: 'automated',
          dataSetup: [],
          actions: [],
          assertions: [{ description: 'x', provenance: 'requirement' }],
          locatorIntent: ['getByRole("button", { name: "Simpan" })'],
          networkExpectations: [],
          artifactExpectations: [],
          cleanup: [],
          unknowns: [],
        },
      ],
      coverageGaps: [],
      diagnostics: [],
    };

    // Registry declares invoice.pending only — payroll.draft is unknown.
    const result = validateTestPlan(plan, sampleRequirement, {
      seedRegistry: { schemaVersion: 1, seeds: [{ name: 'invoice.pending' }] },
    });
    const codes = (result.diagnostics ?? []).map((d) => d.code);
    expect(codes).toContain('PLAN_SEED_UNKNOWN');
    expect(result.data?.seedUnknownCount).toBe(1);
    const unknown = (result.diagnostics ?? []).find((d) => d.code === 'PLAN_SEED_UNKNOWN');
    expect(unknown?.message).toContain('seed:payroll.draft');
    expect(unknown?.message).toContain('seed:invoice.pending');
  });

  test('stays silent about seed refs when the registry is absent or ref is declared', () => {
    const plan: TestPlanContractV1 = {
      schemaVersion: TEST_PLAN_SCHEMA_V1,
      sourceRequirementPath: 'requirements/hris/payroll.md',
      sourceRequirementHash: 'hash-req-123',
      seed: 'tests/data/payroll-seeds.json',
      catalogEvidence: [{ page: 'payroll-form' }],
      scenarios: [
        {
          scenarioId: 'SC-04',
          covers: ['AC-01'],
          page: 'payroll-form',
          executionMode: 'automated',
          dataSetup: ['Input: `namaPayroll: seed:invoice.pending`'],
          actions: [],
          assertions: [{ description: 'x', provenance: 'requirement' }],
          locatorIntent: ['getByRole("button", { name: "Proses" })'],
          networkExpectations: [],
          artifactExpectations: [],
          cleanup: [],
          unknowns: [],
        },
        {
          scenarioId: 'SC-05',
          covers: ['AC-02'],
          page: 'payroll-form',
          executionMode: 'automated',
          dataSetup: [],
          actions: [],
          assertions: [{ description: 'x', provenance: 'requirement' }],
          locatorIntent: ['getByRole("button", { name: "Simpan" })'],
          networkExpectations: [],
          artifactExpectations: [],
          cleanup: [],
          unknowns: [],
        },
      ],
      coverageGaps: [],
      diagnostics: [],
    };

    // No registry (null) — the unknown-seed check stays silent for legacy workspaces.
    const withoutRegistry = validateTestPlan(plan, sampleRequirement, { seedRegistry: null });
    expect((withoutRegistry.diagnostics ?? []).some((d) => d.code === 'PLAN_SEED_UNKNOWN')).toBe(
      false,
    );

    // Declared registry containing the referenced seed — silent too.
    const withRegistry = validateTestPlan(plan, sampleRequirement, {
      seedRegistry: { schemaVersion: 1, seeds: [{ name: 'invoice.pending' }] },
    });
    expect((withRegistry.diagnostics ?? []).some((d) => d.code === 'PLAN_SEED_UNKNOWN')).toBe(
      false,
    );
  });
});
