import { test, expect } from '@playwright/test';
import { compileTestPlanFromText } from '../../../tools/mcp/src/tools/compile-test-plan';

/**
 * TestPlanContractV1 compiler contract.
 *
 * Fixtures are INLINE on purpose - a test must never depend on a documentation
 * file, or deleting docs silently deletes coverage.
 */

const GOOD_PLAN = `# PLAN-AUTH-001: Test Plan for Login

## Metadata

| Field              | Nilai                        |
| ------------------ | ---------------------------- |
| Source requirement | \`requirements/login-valid.md\` |
| Module             | \`auth\`                       |
| Feature            | \`login-valid\`                |

## Scenarios

### SC-01: Login Berhasil

| Field          | Nilai                                                                                      |
| -------------- | ------------------------------------------------------------------------------------------ |
| Test ID        | \`TC-AUTH-001\`                                                                             |
| Covers         | \`AC-01\`, \`AC-02\`                                                                         |
| Actor          | \`user\`                                                                                    |
| Auth Context   | \`user\`                                                                                    |
| Execution Mode | \`automated\`                                                                                |
| Actions        | 1. Buka halaman login<br>2. Isi kredensial valid<br>3. Klik tombol masuk                     |
| Assertions     | \`[requirement]\` URL berpindah ke /dashboard<br>\`[framework-derived]\` Network 200<br>\`[live-verification]\` Toast tampil |
| Locator Intent | \`input[name="email"]\`<br>\`button[type="submit"]\`                                          |

---

### SC-02: Verifikasi SMS OTP (@manual)

| Field          | Nilai                                    |
| -------------- | ---------------------------------------- |
| Test ID        | \`TC-AUTH-002\`                           |
| Covers         | \`AC-01\`                                  |
| Actor          | \`user\`                                  |
| Actions        | 1. Terima SMS OTP pada handset fisik     |
| Assertions     | \`[requirement]\` Transaksi disetujui      |
`;

const BAD_PLAN = `# PLAN-BAD-001: Bad Test Plan

## Metadata

| Field              | Nilai                          |
| ------------------ | ------------------------------ |
| Source requirement | \`requirements/non-existent.md\` |
| Module             | \`unknown\`                      |

## Scenarios

### SC-01: Bad Scenario With Ephemeral Ref

| Field          | Nilai                                              |
| -------------- | -------------------------------------------------- |
| Test ID        | \`TC-BAD-001\`                                       |
| Covers         | \`AC-999\`                                           |
| Actions        | Click ref:tw-8f2a<br>Fill handle:input-1 with test |
| Assertions     | Status is good                                     |
| Locator Intent | ref:tw-8f2a                                        |
`;

test.describe('Test Plan compiler (TestPlanContractV1)', () => {
  test('compiles a well-formed table plan cleanly', () => {
    const result = compileTestPlanFromText(GOOD_PLAN, 'specs/login-valid.plan.md');

    expect(result.status).toBe('success');
    expect(result.data).toBeDefined();

    const plan = result.data!;
    expect(plan.schemaVersion).toBe('qa.test-plan/v1');
    expect(plan.sourceRequirementPath).toBe('requirements/login-valid.md');
    expect(plan.module).toBe('auth');
    expect(plan.feature).toBe('login-valid');
    expect(plan.scenarios.length).toBe(2);

    const sc1 = plan.scenarios[0];
    expect(sc1.scenarioId).toBe('SC-01');
    expect(sc1.testId).toBe('TC-AUTH-001');
    expect(sc1.covers).toContain('AC-01');
    expect(sc1.covers).toContain('AC-02');
    expect(sc1.actor).toBe('user');
    expect(sc1.authContext).toBe('user');
    expect(sc1.executionMode).toBe('automated');
    expect(sc1.actions.length).toBeGreaterThan(0);
    expect(sc1.assertions.length).toBeGreaterThan(0);

    // Provenance
    const reqAssertions = sc1.assertions.filter((a) => a.provenance === 'requirement');
    expect(reqAssertions.length).toBeGreaterThan(0);

    // @manual in the heading forces manual execution mode
    expect(plan.scenarios[1].executionMode).toBe('manual');

    const errors = (plan.diagnostics ?? []).filter((d) => d.severity === 'error');
    expect(errors).toHaveLength(0);
  });

  test('rejects ephemeral browser references with PLAN_EPHEMERAL_REF diagnostic', () => {
    const result = compileTestPlanFromText(BAD_PLAN, 'specs/bad.plan.md');

    expect(result.status).toBe('error');
    expect(result.data).toBeDefined();

    const plan = result.data!;
    const ephemeralErrors = (plan.diagnostics ?? []).filter((d) => d.code === 'PLAN_EPHEMERAL_REF');
    expect(ephemeralErrors.length).toBeGreaterThan(0);
    expect(ephemeralErrors[0].message).toContain('ref:tw-8f2a');
  });

  test('correctly parses coverage gaps and catalog evidence', () => {
    const markdown = `# PLAN-GAP: Test Plan

## Metadata
- **Source requirement:** \`requirements/sample.md\`

## Catalog Evidence
- **Page:** \`invoice-list\` | \`artifacts/selector-catalog/finance/invoice-list.json\`

## Scenarios
### SC-01: Sample Scenario
- **Test ID:** \`TC-001\`
- **Covers:** \`AC-01\`
**Actions:**
- Click button
**Assertions:**
- [requirement] Status is active

## Coverage Gaps
- **Scenario:** \`SC-02\` | **AC:** \`AC-02\` | **Reason:** Third party payment provider
`;

    const result = compileTestPlanFromText(markdown, 'specs/sample.plan.md');
    expect(result.status).toBe('success');
    const plan = result.data!;

    expect(plan.catalogEvidence).toHaveLength(1);
    expect(plan.catalogEvidence[0].page).toBe('invoice-list');

    expect(plan.coverageGaps).toHaveLength(1);
    expect(plan.coverageGaps[0].scenarioId).toBe('SC-02');
    expect(plan.coverageGaps[0].acceptanceCriterionId).toBe('AC-02');
    expect(plan.coverageGaps[0].reason).toContain('Third party payment');
  });
});
