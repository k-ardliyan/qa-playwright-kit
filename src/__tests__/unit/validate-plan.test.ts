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
      catalogEvidence: [],
      scenarios: [
        {
          scenarioId: 'SC-01',
          covers: ['AC-01'],
          actor: 'finance',
          authContext: '.auth/local/finance.json',
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
});
