import { test, expect } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { saveState, resumeState, type PipelineState } from '../../agents/integration/state';
import { computeSourceHash } from '../../../tools/mcp/src/contracts/hashing';
import { useIsolatedReportDir } from '../helpers/report-dir-isolation';

test.describe('Staleness Invalidation & Resume Safety (Phase 9)', () => {
  // Isolate state writes into a temp dir — never touch the production
  // artifacts/reports/pipeline-state.json (previously polluted on disk).
  const isolate = useIsolatedReportDir();
  test.beforeAll(isolate.setup);
  test.afterAll(isolate.teardown);

  const repoRoot = path.resolve(__dirname, '../../../');
  const reqPath = 'requirements/auth/login-none.md';
  const reqAbs = path.resolve(repoRoot, reqPath);

  test('resumeState invalidates all phases when requirement hash changes', () => {
    const realContent = fs.readFileSync(reqAbs, 'utf-8');
    const realHash = computeSourceHash(realContent);
    const staleHash = 'stale-hash-00000000000000000000000000000000000000000000000000000000';

    const testState: PipelineState = {
      runId: 'test-run-staleness',
      status: 'paused',
      currentPhase: 'generate',
      completedPhases: ['plan'],
      artifacts: {
        plan: ['specs/sample.plan.md'],
        generate: [],
        execute: [],
        heal: [],
        report: [],
      },
      timestamp: new Date().toISOString(),
      startedAt: new Date().toISOString(),
      requirementPath: reqPath,
      requirementHash: staleHash,
      orchestrationMode: 'automatic',
      errors: [],
    };

    saveState(testState);

    const resumeResult = resumeState();
    expect('state' in resumeResult).toBe(true);
    if ('state' in resumeResult) {
      expect(resumeResult.resumePhase).toBe('plan');
      expect(resumeResult.state.completedPhases).toHaveLength(0);
      expect(resumeResult.state.requirementHash).toBe(realHash);
    }
  });

  test('state file is written inside the isolated dir, not artifacts/reports', () => {
    const isolated: PipelineState = {
      runId: 'isolation-check-0000',
      status: 'paused',
      currentPhase: null,
      completedPhases: [],
      artifacts: { plan: [], generate: [], execute: [], heal: [], report: [] },
      timestamp: new Date().toISOString(),
      startedAt: new Date().toISOString(),
      requirementPath: 'requirements/auth/login-none.md',
      orchestrationMode: 'automatic',
      errors: [],
    };
    saveState(isolated);
    expect(fs.existsSync(path.join(isolateDir(), 'pipeline-state.json'))).toBe(true);
    expect(
      fs.existsSync(path.resolve(repoRoot, 'artifacts', 'reports', 'pipeline-state.json')),
    ).toBe(false);
  });
});

/** The QA_REPORT_DIR override set by useIsolatedReportDir (read at call time). */
function isolateDir(): string {
  return path.resolve(process.env['QA_REPORT_DIR']!);
}
