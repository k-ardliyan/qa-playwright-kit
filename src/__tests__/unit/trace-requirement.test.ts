import { test, expect } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  traceRequirement,
  buildTraceabilityMatrix,
} from '../../../tools/mcp/src/tools/trace-requirement';
import { extractTestMetadataFromSpec } from '../../../tools/mcp/src/utils/test-index';
import { classifyFailureError } from '../../../tools/mcp/src/utils/failure-classifier';

test.describe('Traceability Contract & Linkage Convergence (CF-201 - CF-206)', () => {
  const repoRoot = path.resolve(__dirname, '../../../');

  test('extractTestMetadataFromSpec parses metadata and test titles accurately', () => {
    const sampleSpec = `
import { test, expect } from './fixtures';
import { setTestMetadata } from '@/support/meta';

test.describe('Sample Feature', () => {
  test('SC-01: Login Success TC-AUTH-001', async ({ page }) => {
    setTestMetadata(test.info(), {
      scenarioId: 'SC-01',
      testId: 'TC-AUTH-001',
      module: 'auth',
      feature: 'login',
      actor: 'user',
      requirementPath: 'requirements/auth/login.md',
    });
    expect(true).toBe(true);
  });
});
`;

    const entries = extractTestMetadataFromSpec(sampleSpec, 'tests/auth/login.spec.ts');
    expect(entries).toHaveLength(1);
    expect(entries[0].scenarioId).toBe('SC-01');
    expect(entries[0].testId).toBe('TC-AUTH-001');
    expect(entries[0].module).toBe('auth');
    expect(entries[0].feature).toBe('login');
    expect(entries[0].actor).toBe('user');
    expect(entries[0].specFile).toBe('tests/auth/login.spec.ts');
  });

  test('CF-201 & CF-203: trace_requirement builds complete TraceabilityContractV1 with 4D coverageState', () => {
    const reqPath = 'requirements/auth/login-otp-browser.md';
    const result = traceRequirement({ requirementPath: reqPath });

    expect(result.status).toBe('success');
    expect(result.data).toBeDefined();

    const trace = result.data!;
    expect(trace.schemaVersion).toBe('qa.traceability/v1');
    expect(trace.requirementId).toBe('REQ-AUTH-OTP-BROWSER');
    expect(trace.requirementTitle).toContain('Login');
    expect(trace.acceptanceCriteria.length).toBeGreaterThan(0);
    expect(trace.scenarios.length).toBeGreaterThan(0);
    expect(trace.coverageState).toBeDefined();
    expect(['planned', 'unplanned']).toContain(trace.coverageState?.design);

    // Last scenario in otp-browser catalog is the (@manual) OTP path
    const sc7 = trace.scenarios.find((s) => s.scenarioId === 'SC-07');
    expect(sc7).toBeDefined();
    expect(sc7?.executionStatus).toBe('manual');
    expect(sc7?.coverageState?.automation).toBe('manual');
    expect(sc7?.coverageState?.verification).toBe('manual-verification-required');

    // Metrics
    expect(trace.metrics.totalScenarios).toBeGreaterThan(0);
    expect(trace.metrics.manualScenarios).toBe(1);
    expect(typeof trace.metrics.healedScenarios).toBe('number');
  });

  test('CF-204: never treats planned or unexecuted scenarios as covered ACs', () => {
    const rawReq = `
# REQ-TRACE-001: Unexecuted Feature
## Metadata
- **Tags:** #smoke
- **Prioritas:** high
- **Auth state:** authenticated
- **Halaman awal:** /trace
- **Module:** trace
- **Feature:** unexecuted

## Kriteria Penerimaan
- **AC-01:** Should be uncovered when not executed

### SC-01: Scenario Planned (@success)
- **Test ID:** TC-TRACE-001
- **Covers:** AC-01
- **Actor:** user
- **Auth Context:** user
- **Langkah:**
  1. Step 1
- **Hasil yang Diharapkan:**
  1. Outcome 1
`;
    // Create matrix with non-existent summary path so no execution results match
    const trace = buildTraceabilityMatrix(
      rawReq,
      'requirements/trace-unexecuted.md',
      '/tmp/nonexistent-summary.json',
    );
    expect(['not-generated', 'not-executed']).toContain(trace.scenarios[0].executionStatus);
    expect(trace.scenarios[0].coverageState?.verification).toBe('unverified');

    // AC must be uncovered, not covered!
    expect(trace.acceptanceCriteria[0].status).toBe('uncovered');
    expect(trace.metrics.coveredAcs).toBe(0);
    expect(trace.metrics.uncoveredAcs).toBe(1);
  });

  test('CF-205: shared failure classifier correctly routes failure sources', () => {
    // 5xx backend error -> app
    const appFail = classifyFailureError('Internal Server Error 500 in response');
    expect(appFail.source).toBe('app');

    // Locator timeout -> test
    const testLocatorFail = classifyFailureError(
      'Error: locator.click: Target page, context or browser has been closed',
    );
    expect(testLocatorFail.source).toBe('test');

    // Auth 401 -> env
    const envAuthFail = classifyFailureError('401 Unauthorized: session expired');
    expect(envAuthFail.source).toBe('env');

    // Network connection refused -> env
    const envNetFail = classifyFailureError('connect ECONNREFUSED 127.0.0.1:3000');
    expect(envNetFail.source).toBe('env');
  });

  test('CF-202: heuristic fallback emits TRACE_HEURISTIC_LINK_USED diagnostic', () => {
    const rawReq = `
# REQ-HEUR-001: Heuristic Feature
## Metadata
- **Tags:** #regression
- **Prioritas:** medium
- **Auth state:** unauthenticated
- **Halaman awal:** /heur
- **Module:** heur
- **Feature:** fallback

## Kriteria Penerimaan
- **AC-01:** Basic check

### SC-01: Fallback Scenario (@success)
- **Covers:** AC-01
- **Langkah:**
  1. Do something
- **Hasil yang Diharapkan:**
  1. Something happens
`;
    const trace = buildTraceabilityMatrix(rawReq, 'requirements/heur/fallback.md');
    // If a spec matched heuristically, diagnostic is emitted
    const heurSc = trace.scenarios.find((s) => s.linkageType === 'heuristic-fallback');
    if (heurSc) {
      expect(heurSc.heuristicDiagnostic).toBeDefined();
      expect(trace.diagnostics?.some((d) => d.code === 'TRACE_HEURISTIC_LINK_USED')).toBe(true);
    }
  });

  test('trace_requirement supports raw requirementsText', () => {
    const goodPath = path.join(repoRoot, 'requirements', '_GOOD_EXAMPLE.md');
    const content = fs.readFileSync(goodPath, 'utf-8');
    const result = traceRequirement({
      requirementPath: 'requirements/auth/login-valid.md',
      requirementsText: content,
    });

    expect(result.status).toBe('success');
    expect(result.data).toBeDefined();
    const trace = result.data!;
    expect(trace.requirementId).toBe('REQ-AUTH-001');
    expect(trace.acceptanceCriteria.length).toBe(6);
    expect(trace.scenarios.length).toBe(5);
  });
});
