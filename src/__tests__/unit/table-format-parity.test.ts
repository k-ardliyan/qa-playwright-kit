import { test, expect } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { compileRequirementFromText } from '../../../tools/mcp/src/tools/compile-requirement';
import { compileTestPlanFromText } from '../../../tools/mcp/src/tools/compile-test-plan';

const repoRoot = path.resolve(__dirname, '../../..');

test.describe('Table-format parity (requirement + plan)', () => {
  test('table-format requirement compiles to the same contract shape as the bullet one', () => {
    const p = path.join(repoRoot, 'requirements/_TABLE_EXAMPLE.md');
    const r = compileRequirementFromText(
      fs.readFileSync(p, 'utf-8'),
      'requirements/_TABLE_EXAMPLE.md',
    );

    expect(r.status).toBe('success');
    const req = r.data!;
    expect(req.module).toBe('finance');
    expect(req.feature).toBe('approve-invoice');
    expect(req.acceptanceCriteria.map((a) => a.id)).toEqual(['AC-01', 'AC-02', 'AC-03']);
    expect(req.scenarios.length).toBe(3);

    const s1 = req.scenarios[0];
    expect(s1.testId).toBe('TC-INV-001');
    expect(s1.covers).toEqual(expect.arrayContaining(['AC-01', 'AC-02']));
    expect(s1.actor).toBe('finance');
    expect(s1.steps.length).toBe(4);
    expect(s1.steps[0]).toContain('Buka halaman detail invoice');
    expect(s1.expectations.length).toBeGreaterThanOrEqual(3);
    expect(s1.inputData.some((i) => i.source === 'seed')).toBe(true);

    // Access Matrix (a 3-column table) is unaffected by the 2-column label reader.
    const matrix = req.accessMatrix ?? [];
    expect(matrix.length).toBe(3);
    expect(matrix.find((m) => m.role === 'hrd')?.access).toBe('deny');
  });

  test('legacy bullet requirement still compiles identically (no regression)', () => {
    const p = path.join(repoRoot, 'requirements/_GOOD_EXAMPLE.md');
    const r = compileRequirementFromText(
      fs.readFileSync(p, 'utf-8'),
      'requirements/_GOOD_EXAMPLE.md',
    );
    expect(r.status).toBe('success');
    expect(r.data!.scenarios.length).toBe(5);
    expect(r.data!.acceptanceCriteria.length).toBe(6);
  });

  test('table-format plan compiles: scenarios, sections and coverage gaps', () => {
    const p = path.join(repoRoot, 'specs/_TABLE_EXAMPLE.md');
    const r = compileTestPlanFromText(fs.readFileSync(p, 'utf-8'), 'specs/_TABLE_EXAMPLE.md');

    expect(r.status).toBe('success');
    const plan = r.data!;
    expect(plan.module).toBe('auth');
    expect(plan.feature).toBe('login-valid');
    expect(plan.scenarios.length).toBe(2);

    const s1 = plan.scenarios[0];
    expect(s1.testId).toBe('TC-AUTH-001');
    expect(s1.actions.length).toBe(4);
    expect(s1.assertions.length).toBe(3);
    expect(s1.locatorIntent.length).toBe(3);

    // Coverage Gaps table row → one gap
    expect(plan.coverageGaps.length).toBe(1);
    expect(plan.coverageGaps[0].scenarioId).toBe('SC-03');
    expect(plan.coverageGaps[0].acceptanceCriterionId).toBe('AC-04');
  });
});
