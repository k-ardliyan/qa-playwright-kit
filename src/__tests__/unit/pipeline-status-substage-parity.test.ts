/// <reference types="node" />

/**
 * Parity guard: the Validate substage union must be identical everywhere it is
 * declared. `needs-heal` was added to the src union but `pipeline-status.ts`
 * (MCP, separately built) kept the old 4-value union — a silent drift that
 * would misreport a real runtime state. This test fails on the next drift.
 */

import { test, expect } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

function substageUnionFrom(relativePath: string): string[] {
  const source = fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf-8');
  // Matches: "execute" | "needs-heal" | ...  (single or double quotes)
  const matches = [
    ...source.matchAll(/['"]((?:execute|needs-heal|heal|report-analyze|qa-review))['"]/g),
  ];
  return [...new Set(matches.map((m) => m[1]))].sort();
}

const EXPECTED = ['execute', 'heal', 'needs-heal', 'qa-review', 'report-analyze'];

test.describe('Validate substage union parity', () => {
  test('src contracts declare the full substage union', () => {
    for (const file of [
      'src/agents/integration/types.ts',
      'src/agents/integration/workflow-controller-types.ts',
    ]) {
      expect(substageUnionFrom(file), file).toEqual(EXPECTED);
    }
  });

  test('MCP pipeline_status accepts the same union as the runtime', () => {
    expect(substageUnionFrom('tools/mcp/src/tools/pipeline-status.ts')).toEqual(EXPECTED);
  });

  test('state validator + JSON schema accept needs-heal', () => {
    const stateValidator = fs.readFileSync(
      path.join(REPO_ROOT, 'src/agents/integration/state.ts'),
      'utf-8',
    );
    const schema = fs.readFileSync(
      path.join(REPO_ROOT, 'src/agents/integration/schemas/pipeline-state.schema.json'),
      'utf-8',
    );
    expect(stateValidator).toContain("'needs-heal'");
    expect(schema).toContain('needs-heal');
  });

  test('completed-phase rule only credits heal for a real heal pass', () => {
    const validateStage = fs.readFileSync(
      path.join(REPO_ROOT, 'src/agents/integration/stages/validate.ts'),
      'utf-8',
    );
    // Isolate the `if (...) { completedPhysical.push('heal'); }` guard and
    // strip comment lines so prose mentioning `needs-heal` cannot leak in.
    const healGuard = validateStage.match(
      /\n\s*if \(([\s\S]*?)\)\s*\{\s*\n\s*completedPhysical\.push\('heal'\);/,
    );
    expect(healGuard, 'heal-phase completion guard must exist').not.toBeNull();
    const condition = healGuard![1]
      .split('\n')
      .filter((line) => !line.trim().startsWith('//'))
      .join('\n');
    expect(condition).toContain("result.substage === 'heal'");
    expect(condition).toContain("'report-analyze'");
    expect(condition).toContain("'qa-review'");
    // needs-heal must NOT be part of the proof set — a failing run has not healed.
    expect(condition).not.toContain('needs-heal');
  });
});
