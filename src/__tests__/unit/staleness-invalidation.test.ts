import { test, expect } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { saveState, resumeState, type PipelineState } from '../../agents/integration/state';
import { computeSourceHash } from '../../../tools/mcp/src/contracts/hashing';

test.describe('Staleness Invalidation & Resume Safety (Phase 9)', () => {
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
});
