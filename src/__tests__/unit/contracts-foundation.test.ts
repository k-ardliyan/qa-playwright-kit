import { test, expect } from '@playwright/test';
import {
  REQUIREMENT_SCHEMA_V1,
  TEST_PLAN_SCHEMA_V1,
  TRACEABILITY_SCHEMA_V1,
  MCP_RESULT_SCHEMA_V1,
  SELECTOR_CATALOG_SCHEMA_V1,
  createDiagnostic,
  computeSourceHash,
  computeObjectHash,
  successResult,
  warningResult,
  failureResult,
} from '@/contracts';
import type { CoverageStateBreakdown, TraceabilityContractV1 } from '@/contracts';

test.describe('Contract Schema Foundation & Hashing (Phase 2)', () => {
  test('schema version identifiers are stable strings', () => {
    expect(REQUIREMENT_SCHEMA_V1).toBe('qa.requirement/v1');
    expect(TEST_PLAN_SCHEMA_V1).toBe('qa.test-plan/v1');
    expect(TRACEABILITY_SCHEMA_V1).toBe('qa.traceability/v1');
    expect(MCP_RESULT_SCHEMA_V1).toBe('qa.mcp-result/v1');
    expect(SELECTOR_CATALOG_SCHEMA_V1).toBe('qa.selector-catalog/v1');
  });

  test('computeSourceHash is deterministic and normalizes CRLF', () => {
    const textUnix = 'Line 1\nLine 2\nLine 3';
    const textWin = 'Line 1\r\nLine 2\r\nLine 3\r\n';
    const hashUnix = computeSourceHash(textUnix);
    const hashWin = computeSourceHash(textWin);

    expect(hashUnix).toBe(hashWin);
    expect(hashUnix.length).toBe(64); // SHA-256 hex length
  });

  test('computeObjectHash sorts object keys deterministically', () => {
    const objA = { b: 2, a: 1, nested: { y: 'world', x: 'hello' } };
    const objB = { nested: { x: 'hello', y: 'world' }, a: 1, b: 2 };

    const hashA = computeObjectHash(objA);
    const hashB = computeObjectHash(objB);

    expect(hashA).toBe(hashB);
  });

  test('createDiagnostic builds properly structured diagnostic items', () => {
    const diag = createDiagnostic('REQ_MISSING_MODULE', 'error', 'Module is missing', {
      path: 'requirements/auth/login.md',
    });
    expect(diag.code).toBe('REQ_MISSING_MODULE');
    expect(diag.severity).toBe('error');
    expect(diag.message).toBe('Module is missing');
    expect(diag.path).toBe('requirements/auth/login.md');
  });

  test('McpResult builders produce conforming envelopes', () => {
    const success = successResult({ compiled: true });
    expect(success.schemaVersion).toBe('qa.mcp-result/v1');
    expect(success.status).toBe('success');
    expect(success.data).toEqual({ compiled: true });
    expect(success.diagnostics).toEqual([]);

    const warning = warningResult({ compiled: true }, [
      createDiagnostic('PLAN_UNREVIEWED_ASSUMPTION', 'warning', 'Review assumption'),
    ]);
    expect(warning.status).toBe('warning');
    expect(warning.diagnostics.length).toBe(1);

    const failure = failureResult([createDiagnostic('REQ_MALFORMED', 'error', 'Syntax error')]);
    expect(failure.status).toBe('error');
    expect(failure.data).toBeUndefined();
    expect(failure.diagnostics.length).toBe(1);
  });

  test('traceability v1 exposes optional 4D coverageState (contract parity)', () => {
    const coverage: CoverageStateBreakdown = {
      design: 'planned',
      automation: 'automated',
      execution: 'executed',
      verification: 'verified-pass',
    };
    const contract: TraceabilityContractV1 = {
      schemaVersion: TRACEABILITY_SCHEMA_V1,
      requirementId: 'REQ-1',
      requirementTitle: 't',
      requirementPath: 'requirements/t.md',
      requirementHash: 'a'.repeat(64),
      acceptanceCriteria: [],
      scenarios: [
        {
          scenarioId: 'SC-01',
          title: 'x',
          coversAcIds: [],
          executionStatus: 'passed',
          coverageState: coverage,
          linkageType: 'exact-test-id',
        },
      ],
      metrics: {
        totalAcs: 0,
        coveredAcs: 0,
        uncoveredAcs: 0,
        totalScenarios: 1,
        passingScenarios: 1,
        failingScenarios: 0,
        healedScenarios: 0,
        skippedScenarios: 0,
        manualScenarios: 0,
        blockedScenarios: 0,
      },
      coverageState: coverage,
      diagnostics: [],
      generatedAt: '2026-08-26T00:00:00.000Z',
    };
    expect(contract.scenarios[0].coverageState?.design).toBe('planned');
    expect(contract.diagnostics).toEqual([]);
  });
});
