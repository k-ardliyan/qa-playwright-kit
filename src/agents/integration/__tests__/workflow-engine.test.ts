/**
 * Unit tests for the native semantic workflow engine — Agent AI Integration Layer
 *
 * Proves the three non-negotiable invariants of the migration:
 * 1. No Explore evidence when required → downstream stages do not proceed.
 * 2. Challenge fails → Generate is not called.
 * 3. Challenge passes → Generate is called exactly once.
 *
 * Plus the pure rules of the transition reducer, Explore policy, Challenge gate,
 * and feedback router.
 */

import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  createWorkflowEnvelope,
  transitionWorkflow,
  isStageUsable,
  evaluateExplorePolicy,
  resolveEvidence,
  evaluateChallenge,
  canGenerate,
  routeFeedback,
  WorkflowController,
  ModelHandoffError,
  type ChallengeGateInput,
  type ExploreDecision,
  type ModelResult,
  type WorkflowResponse,
} from '../index';
import {
  createMcpAdapters,
  resolveValidateResultsDir,
  extractReportCoverageFromTrace,
} from '../mcp-adapters';
import { parsePlaywrightJsonReport } from '../playwright-counters';
import { getTestFailures } from '../../../../tools/mcp/src/tools/get-test-failures';

// ─── Test helpers ────────────────────────────────────────────────────────────

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'qak-workflow-'));
}

function writeRequirement(dir: string): { requirementPath: string; repoRoot: string } {
  const repoRoot = path.join(dir, 'repo');
  const reqDir = path.join(repoRoot, 'requirements');
  fs.mkdirSync(reqDir, { recursive: true });
  const requirementPath = path.join('requirements', 'flow.md');
  fs.writeFileSync(path.join(repoRoot, requirementPath), '# Requirement\n\n## Scenario\n');
  return { requirementPath, repoRoot };
}

/** Create a real evidence file and return its absolute path (Explore policy
 *  resolves absolute paths directly, so tests never pollute the repo). */
function writeEvidence(dir: string): string {
  const evidenceDir = path.join(dir, 'evidence');
  fs.mkdirSync(evidenceDir, { recursive: true });
  const file = path.join(evidenceDir, 'list.json');
  fs.writeFileSync(file, '{"k": 1}');
  return file;
}

function validExplore(): ExploreDecision {
  return {
    status: 'satisfied',
    reason: 'evidence ok',
    evidencePaths: [],
    evidenceHashes: {},
    checkedAt: new Date().toISOString(),
  };
}

function passedModel(): ModelResult {
  return {
    status: 'passed',
    planPath: 'specs/flow-test-plan.md',
    planHash: 'plan-hash',
    requirementHash: 'req-hash',
    scenarioCount: 2,
    coverageGapCount: 0,
  };
}

function passedChallenge(overrides: Partial<ChallengeGateInput> = {}): {
  input: ChallengeGateInput;
  allow: boolean;
} {
  const input: ChallengeGateInput = {
    explore: validExplore(),
    model: passedModel(),
    diagnostics: [],
    assumptions: [],
    coverageGaps: [],
    assertionCount: 4,
    mode: 'automatic',
    ...overrides,
  };
  return { input, allow: evaluateChallenge(input).allow };
}

/**
 * A recording adapter set for controller tests. `generatedFiles` controls
 * whether the generate adapter succeeds.
 */
function recordingAdapters(tracking: { calls: string[] }) {
  return {
    async explore() {
      tracking.calls.push('explore-adapter');
      return { evidence: [] };
    },
    async model() {
      tracking.calls.push('model-adapter');
      return {
        planPath: 'specs/flow-test-plan.md',
        planHash: 'plan-hash',
        scenarioCount: 2,
        coverageGapCount: 0,
        requirementHash: 'req-hash',
      };
    },
    async challenge() {
      tracking.calls.push('challenge-adapter');
      return { diagnostics: [], assumptions: [], coverageGaps: [], assertionCount: 4 };
    },
    async generate() {
      tracking.calls.push('generate-adapter');
      return {
        mode: 'completed' as const,
        generatedFiles: ['tests/flow.spec.ts'],
        testCount: 2,
      };
    },
    async validate() {
      tracking.calls.push('validate-adapter');
      return {
        unresolvedFailures: 0,
        substage: 'qa-review' as const,
        analysisCompleted: true,
        analysisVerified: true,
        analysisVerdict: 'complete' as const,
      };
    },
  };
}

// ─── Transition reducer ──────────────────────────────────────────────────────

test.describe('Workflow Transition Reducer', () => {
  test('blocks Generate start before Model passed and Challenge passed', () => {
    let env = createWorkflowEnvelope('semantic-v1');

    // Try to jump straight to generate: must be rejected by the reducer itself.
    const illegal = transitionWorkflow(env, { type: 'stage:start', stage: 'generate' });
    expect(illegal.ok).toBe(false);
    if (!illegal.ok) expect(illegal.error).toContain('explore');

    // Legal path: explore pass → model pass → challenge pass → generate start.
    for (const stage of ['explore', 'model', 'challenge'] as const) {
      const start = transitionWorkflow(env, { type: 'stage:start', stage });
      expect(start.ok).toBe(true);
      if (start.ok) env = start.envelope;
      const pass = transitionWorkflow(env, { type: 'stage:pass', stage });
      expect(pass.ok).toBe(true);
      if (pass.ok) env = pass.envelope;
    }

    const generateStart = transitionWorkflow(env, { type: 'stage:start', stage: 'generate' });
    expect(generateStart.ok).toBe(true);
  });

  test('stage:pass requires running/required/recommended status', () => {
    const env = createWorkflowEnvelope('semantic-v1');
    const result = transitionWorkflow(env, { type: 'stage:pass', stage: 'model' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('running/required/recommended');
  });

  test('only explore can be skipped and only validate accepts a QA decision', () => {
    const env = createWorkflowEnvelope('semantic-v1');

    const skipModel = transitionWorkflow(env, { type: 'stage:skip', stage: 'model', reason: 'x' });
    expect(skipModel.ok).toBe(false);

    const skipExplore = transitionWorkflow(env, {
      type: 'stage:skip',
      stage: 'explore',
      reason: 'public static site, no auth',
    });
    expect(skipExplore.ok).toBe(true);
    if (skipExplore.ok) expect(isStageUsable(skipExplore.envelope.stages.explore)).toBe(true);

    const qaOnModel = transitionWorkflow(env, { type: 'stage:qa-decision', stage: 'model' });
    expect(qaOnModel.ok).toBe(false);

    const qaWithoutProof = transitionWorkflow(createWorkflowEnvelope('semantic-v1'), {
      type: 'stage:qa-decision',
      stage: 'validate',
    });
    expect(qaWithoutProof.ok).toBe(false);
    if (!qaWithoutProof.ok) expect(qaWithoutProof.error).toContain('complete before QA');

    let validateEnv = createWorkflowEnvelope('semantic-v1');
    for (const stage of ['explore', 'model', 'challenge', 'generate', 'validate'] as const) {
      const start = transitionWorkflow(validateEnv, { type: 'stage:start', stage });
      expect(start.ok).toBe(true);
      if (start.ok) validateEnv = start.envelope;
      if (stage !== 'validate') {
        const pass = transitionWorkflow(validateEnv, { type: 'stage:pass', stage });
        expect(pass.ok).toBe(true);
        if (pass.ok) validateEnv = pass.envelope;
      }
    }
    const qaFailed = transitionWorkflow(validateEnv, {
      type: 'stage:qa-decision',
      stage: 'validate',
      completionProof: {
        analysisCompleted: true,
        analysisVerified: true,
        analysisVerdict: 'complete',
      },
    });
    expect(qaFailed.ok).toBe(true);
  });

  test('feedback records the decision and increments the loop count', () => {
    const env = createWorkflowEnvelope('semantic-v1');
    const result = transitionWorkflow(env, {
      type: 'feedback',
      decision: {
        loopTarget: 'generate',
        failureSource: 'test',
        reason: 'locator wrong',
        evidencePaths: ['artifacts/test-results/x/trace.zip'],
      },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.envelope.loopCounts.generate).toBe(1);
      expect(result.envelope.lastFeedback?.loopTarget).toBe('generate');
    }
  });
});

// ─── Explore policy ──────────────────────────────────────────────────────────

test.describe('Explore Policy & Evidence Resolver', () => {
  test('resolver outcomes: invalid, matched, missing, stale', () => {
    const dir = tmpDir();
    const repoRoot = path.join(dir, 'repo');
    fs.mkdirSync(path.join(repoRoot, 'artifacts', 'selector-catalog', 'flow'), {
      recursive: true,
    });
    const catalog = path.join('artifacts', 'selector-catalog', 'flow', 'list.json');
    fs.writeFileSync(path.join(repoRoot, catalog), '{"k": 1}');

    expect(resolveEvidence([], repoRoot).outcome).toBe('invalid');

    expect(
      resolveEvidence([{ path: catalog, expectedHash: 'definitely-wrong' }], repoRoot).outcome,
    ).toBe('stale');

    expect(resolveEvidence([{ path: catalog }], repoRoot).outcome).toBe('matched');

    expect(
      resolveEvidence([{ path: path.join('artifacts', 'missing.json') }], repoRoot).outcome,
    ).toBe('missing');
  });

  test('policy blocks when blockedReason is set', () => {
    const decision = evaluateExplorePolicy({
      requirementPath: 'requirements/flow.md',
      blockedReason: 'No auth session for protected route.',
    });
    expect(decision.status).toBe('blocked');
  });

  test('policy requires exploration when evidence is invalid or missing', () => {
    expect(evaluateExplorePolicy({ requirementPath: 'requirements/flow.md' }).status).toBe(
      'required',
    );

    expect(
      evaluateExplorePolicy({
        requirementPath: 'requirements/flow.md',
        evidence: [{ path: 'artifacts/never.json' }],
      }).status,
    ).toBe('required');
  });

  test('valid evidence with new-feature flag is recommended, otherwise satisfied', () => {
    const dir = tmpDir();
    const catalogAbs = path.join(dir, 'list.json');
    fs.writeFileSync(catalogAbs, '{"k": 1}');

    const satisfied = evaluateExplorePolicy({
      requirementPath: 'requirements/flow.md',
      evidence: [{ path: catalogAbs }],
    });
    expect(satisfied.status).toBe('satisfied');
    expect(satisfied.evidencePaths).toEqual([catalogAbs]);

    const recommended = evaluateExplorePolicy({
      requirementPath: 'requirements/flow.md',
      evidence: [{ path: catalogAbs }],
      flags: { newFeature: true },
    });
    expect(recommended.status).toBe('recommended');
  });
});

// ─── Challenge gate ──────────────────────────────────────────────────────────

test.describe('Challenge Gate', () => {
  test('blocks on error diagnostics with blocking codes', () => {
    const { input, allow } = passedChallenge({
      diagnostics: [
        { code: 'PLAN_AC_UNCOVERED', severity: 'error' },
        { code: 'PLAN_LOW_COVERAGE', severity: 'warning' },
      ],
    });
    expect(allow).toBe(false);
    const verdict = evaluateChallenge(input);
    expect(verdict.result.blockingCodes).toContain('PLAN_AC_UNCOVERED');
    expect(verdict.result.blockingCodes).not.toContain('PLAN_LOW_COVERAGE');
  });

  test('blocks when Explore is required or Model not passed', () => {
    const noExplore = passedChallenge({ explore: { ...validExplore(), status: 'required' } });
    expect(noExplore.allow).toBe(false);

    const noModel = passedChallenge({
      model: { ...passedModel(), status: 'failed' },
    });
    expect(noModel.allow).toBe(false);
  });

  test('warnings pause in manual mode but proceed (recorded) in automatic mode', () => {
    const warningInput = {
      diagnostics: [{ code: 'PLAN_ASSUMPTION', severity: 'warning' as const }],
    };

    const manual = passedChallenge({ ...warningInput, mode: 'manual' });
    expect(manual.allow).toBe(false);
    expect(evaluateChallenge(manual.input).result.status).toBe('needs-review');

    const automatic = passedChallenge({ ...warningInput, mode: 'automatic' });
    expect(automatic.allow).toBe(true);
    expect(evaluateChallenge(automatic.input).result.status).toBe('passed');
  });

  test('no diagnostics → allow', () => {
    const { input, allow } = passedChallenge();
    expect(allow).toBe(true);
    expect(evaluateChallenge(input).result.status).toBe('passed');
  });

  test('Task 3.1: fails closed on validatorStatus=error even with empty diagnostics', () => {
    const { input, allow } = passedChallenge({
      diagnostics: [],
      validatorStatus: 'error',
    });
    expect(allow).toBe(false);
    expect(evaluateChallenge(input).result.status).toBe('blocked');
    expect(evaluateChallenge(input).result.reason).toContain('status');
  });

  test('Task 3.1: fails closed on malformed validatorStatus', () => {
    const { allow } = passedChallenge({
      diagnostics: [],
      validatorStatus: 'unknown-status',
    });
    expect(allow).toBe(false);
  });

  test('Task 3.2: coverage gaps need-review in manual, recorded-pass in automatic', () => {
    const manual = passedChallenge({
      diagnostics: [],
      coverageGapCount: 2,
      mode: 'manual',
    });
    expect(manual.allow).toBe(false);
    expect(evaluateChallenge(manual.input).result.status).toBe('needs-review');
    expect(evaluateChallenge(manual.input).result.policyAccepted).toBe(false);

    const automatic = passedChallenge({
      diagnostics: [],
      coverageGapCount: 2,
      mode: 'automatic',
    });
    expect(automatic.allow).toBe(true);
    const autoResult = evaluateChallenge(automatic.input).result;
    expect(autoResult.status).toBe('passed');
    expect(autoResult.policyAccepted).toBe(true);
    expect(autoResult.policyMode).toBe('automatic');
  });
});

// ─── canGenerate — the machine-enforced invariant ────────────────────────────

test.describe('canGenerate', () => {
  test('returns false for missing/blocked Explore, failed Model, unpassed Challenge', () => {
    expect(
      canGenerate({ ...validExplore(), status: 'required' }, passedModel(), {
        status: 'passed',
        planHash: 'h',
        blockingCodes: [],
        warningCodes: [],
        assumptionCount: 0,
        coverageGapCount: 0,
        assertionCount: 0,
        checkedAt: new Date().toISOString(),
      }).allow,
    ).toBe(false);

    expect(
      canGenerate(
        validExplore(),
        { ...passedModel(), status: 'failed' },
        {
          status: 'passed',
          planHash: 'h',
          blockingCodes: [],
          warningCodes: [],
          assumptionCount: 0,
          coverageGapCount: 0,
          assertionCount: 0,
          checkedAt: new Date().toISOString(),
        },
      ).allow,
    ).toBe(false);

    expect(
      canGenerate(validExplore(), passedModel(), {
        status: 'blocked',
        planHash: 'h',
        blockingCodes: ['X'],
        warningCodes: [],
        assumptionCount: 0,
        coverageGapCount: 0,
        assertionCount: 0,
        checkedAt: new Date().toISOString(),
      }).allow,
    ).toBe(false);
  });

  test('returns true only when all three preconditions hold', () => {
    const gate = canGenerate(validExplore(), passedModel(), {
      status: 'passed',
      planHash: 'plan-hash',
      blockingCodes: [],
      warningCodes: [],
      assumptionCount: 0,
      coverageGapCount: 0,
      assertionCount: 4,
      checkedAt: new Date().toISOString(),
    });
    expect(gate.allow).toBe(true);
  });
});

// ─── Feedback router ─────────────────────────────────────────────────────────

test.describe('Feedback Router', () => {
  test('routes auth redirects to fix-environment, never to locator healing', () => {
    const decision = routeFeedback({
      failureSource: 'test',
      message: 'locator timeout',
      authRedirect: true,
    });
    expect(decision.loopTarget).toBe('fix-environment');
    expect(decision.failureSource).toBe('env');
  });

  test('routes app/env/requirement/test/unknown findings', () => {
    expect(routeFeedback({ failureSource: 'app', message: 'x' }).loopTarget).toBe('file-bug');
    expect(routeFeedback({ failureSource: 'env', message: 'x' }).loopTarget).toBe(
      'fix-environment',
    );
    expect(routeFeedback({ failureSource: 'requirement', message: 'x' }).loopTarget).toBe('model');
    expect(routeFeedback({ failureSource: 'test', message: 'x' }).loopTarget).toBe('generate');
    expect(routeFeedback({ failureSource: 'unknown', message: 'x' }).loopTarget).toBe('blocked');
  });

  test('never fabricates a loop count on routing', () => {
    const decision = routeFeedback({ failureSource: 'unknown', message: 'x' });
    expect(decision.loopTarget).toBe('blocked');
  });
});

// ─── WorkflowController — the runtime proof ──────────────────────────────────

test.describe('WorkflowController runtime invariants', () => {
  let previousReportDir: string | undefined;

  test.beforeEach(() => {
    previousReportDir = process.env['QA_REPORT_DIR'];
    process.env['QA_REPORT_DIR'] = tmpDir();
  });

  test.afterEach(() => {
    if (previousReportDir === undefined) delete process.env['QA_REPORT_DIR'];
    else process.env['QA_REPORT_DIR'] = previousReportDir;
  });

  test('no Explore evidence when required → Model and Generate are never called', async () => {
    const tracking = { calls: [] as string[] };
    const { requirementPath } = writeRequirement(process.env['QA_REPORT_DIR']!);

    const controller = new WorkflowController(
      { orchestrationMode: 'automatic', requirementPath },
      recordingAdapters(tracking),
    );

    const response: WorkflowResponse = await controller.run({
      requirementPath,
      orchestrationMode: 'automatic',
      evidence: [{ path: 'artifacts/selector-catalog/flow/list.json' }], // missing on disk
    });

    expect(response.workflowStage).toBe('explore');
    expect(response.workflowStatus).toBe('blocked');
    expect(tracking.calls).not.toContain('model-adapter');
    expect(tracking.calls).not.toContain('generate-adapter');
  });

  test('Challenge blocked → Generate adapter is never called', async () => {
    const tracking = { calls: [] as string[] };
    const { requirementPath } = writeRequirement(process.env['QA_REPORT_DIR']!);

    // Seed the workflow envelope so Explore/Model pass but Challenge blocks.
    const blockingAdapters = {
      ...recordingAdapters(tracking),
      async challenge() {
        tracking.calls.push('challenge-adapter');
        return {
          diagnostics: [{ code: 'PLAN_AC_UNCOVERED', severity: 'error' as const }],
          assumptions: [],
          coverageGaps: [],
          assertionCount: 4,
        };
      },
    };

    const evidencePath = writeEvidence(process.env['QA_REPORT_DIR']!);

    const controller = new WorkflowController(
      { orchestrationMode: 'automatic', requirementPath },
      blockingAdapters,
    );

    const response: WorkflowResponse = await controller.run({
      requirementPath,
      orchestrationMode: 'automatic',
      evidence: [{ path: evidencePath }],
    });

    expect(response.workflowStage).toBe('challenge');
    expect(response.workflowStatus).toBe('blocked');
    expect(tracking.calls).toContain('model-adapter');
    expect(tracking.calls).not.toContain('generate-adapter');
  });

  test('Challenge passes → Generate is called exactly once', async () => {
    const tracking = { calls: [] as string[] };
    const { requirementPath } = writeRequirement(process.env['QA_REPORT_DIR']!);
    const evidencePath = writeEvidence(process.env['QA_REPORT_DIR']!);

    const controller = new WorkflowController(
      { orchestrationMode: 'automatic', requirementPath },
      recordingAdapters(tracking),
    );

    const response: WorkflowResponse = await controller.run({
      requirementPath,
      orchestrationMode: 'automatic',
      evidence: [{ path: evidencePath }],
    });

    expect(response.workflowStatus).toBe('qa-decision-required');
    expect(tracking.calls.filter((c) => c === 'generate-adapter')).toHaveLength(1);
    expect(tracking.calls).toContain('validate-adapter');
  });

  test('PC-06: blocked run is persisted as blocked, never running', async () => {
    const tracking = { calls: [] as string[] };
    const { requirementPath } = writeRequirement(process.env['QA_REPORT_DIR']!);

    const controller = new WorkflowController(
      { orchestrationMode: 'automatic', requirementPath },
      recordingAdapters(tracking),
    );

    const response: WorkflowResponse = await controller.run({
      requirementPath,
      orchestrationMode: 'automatic',
      evidence: [{ path: 'artifacts/selector-catalog/flow/list.json' }], // missing
    });

    expect(response.workflowStatus).toBe('blocked');
    expect(controller.getState().status).toBe('blocked');
  });

  test('PC-01: resume with same runId continues from the persisted stage', async () => {
    const tracking = { calls: [] as string[] };
    const { requirementPath, repoRoot } = writeRequirement(process.env['QA_REPORT_DIR']!);
    const evidencePath = writeEvidence(process.env['QA_REPORT_DIR']!);

    // Model adapter simulates the Planner handoff: fails while the plan is
    // missing (first run), succeeds once the plan exists (resume).
    let planExists = false;
    const handoffAdapters = {
      ...recordingAdapters(tracking),
      async model() {
        tracking.calls.push('model-adapter');
        if (!planExists) {
          throw new ModelHandoffError('specs/flow-test-plan.md');
        }
        return {
          planPath: 'specs/flow-test-plan.md',
          planHash: 'plan-hash',
          scenarioCount: 2,
          coverageGapCount: 0,
          requirementHash: 'req-hash',
        };
      },
    };

    // First run: Explore passes, Model pauses on the Planner handoff (plan missing).
    const first = new WorkflowController(
      { orchestrationMode: 'automatic', requirementPath, repoRoot },
      handoffAdapters,
    );
    const firstResponse = await first.run({
      requirementPath,
      orchestrationMode: 'automatic',
      evidence: [{ path: evidencePath }],
    });
    expect(firstResponse.workflowStage).toBe('model');
    expect(firstResponse.workflowStatus).toBe('blocked');
    const runId = first.getState().runId;

    // Planner creates the plan, then resume with the same runId.
    planExists = true;
    const resumed = new WorkflowController(
      { orchestrationMode: 'automatic', requirementPath, runId, repoRoot },
      handoffAdapters,
      first.getState(),
    );
    const resumedResponse = await resumed.run({
      requirementPath,
      orchestrationMode: 'automatic',
      evidence: [{ path: evidencePath }],
      resume: true,
    });

    // Explore must NOT re-run on resume — Model/Challenge/Generate/Validate continue.
    expect(tracking.calls.filter((c) => c === 'explore-adapter')).toHaveLength(0);
    expect(resumedResponse.workflowStatus).toBe('qa-decision-required');
    expect(resumed.getState().runId).toBe(runId);
  });

  test('PC-01: resume rejects a stale requirement hash', async () => {
    const tracking = { calls: [] as string[] };
    const { requirementPath, repoRoot } = writeRequirement(process.env['QA_REPORT_DIR']!);
    const evidencePath = writeEvidence(process.env['QA_REPORT_DIR']!);

    const first = new WorkflowController(
      { orchestrationMode: 'automatic', requirementPath, repoRoot },
      recordingAdapters(tracking),
    );
    await first.run({
      requirementPath,
      orchestrationMode: 'automatic',
      evidence: [{ path: evidencePath }],
    });
    const runId = first.getState().runId;

    // Change the requirement on disk.
    fs.writeFileSync(path.join(repoRoot, requirementPath), '# CHANGED\n');

    const resumed = new WorkflowController(
      { orchestrationMode: 'automatic', requirementPath, runId, repoRoot },
      recordingAdapters(tracking),
      first.getState(),
    );
    const response = await resumed.run({
      requirementPath,
      orchestrationMode: 'automatic',
      evidence: [{ path: evidencePath }],
      resume: true,
    });

    expect(response.workflowStatus).toBe('blocked');
    expect(response.errors?.[0]?.code).toBe('RESUME_STALE_REQUIREMENT');
  });

  test('PC-02: resume at qa-decision-required does not re-run Validate', async () => {
    const tracking = { calls: [] as string[] };
    const { requirementPath, repoRoot } = writeRequirement(process.env['QA_REPORT_DIR']!);
    const evidencePath = writeEvidence(process.env['QA_REPORT_DIR']!);

    const first = new WorkflowController(
      { orchestrationMode: 'automatic', requirementPath, repoRoot },
      recordingAdapters(tracking),
    );
    await first.run({
      requirementPath,
      orchestrationMode: 'automatic',
      evidence: [{ path: evidencePath }],
    });
    const runId = first.getState().runId;
    const validateCallsAfterFirst = tracking.calls.filter((c) => c === 'validate-adapter').length;

    const resumed = new WorkflowController(
      { orchestrationMode: 'automatic', requirementPath, runId, repoRoot },
      recordingAdapters(tracking),
      first.getState(),
    );
    const response = await resumed.run({
      requirementPath,
      orchestrationMode: 'automatic',
      evidence: [{ path: evidencePath }],
      resume: true,
    });

    expect(response.workflowStatus).toBe('qa-decision-required');
    expect(tracking.calls.filter((c) => c === 'validate-adapter').length).toBe(
      validateCallsAfterFirst,
    );
  });

  test('PC-02 Task 4.5: awaiting-generator → Generate blocked/paused, never passed', async () => {
    const tracking = { calls: [] as string[] };
    const { requirementPath, repoRoot } = writeRequirement(process.env['QA_REPORT_DIR']!);
    const evidencePath = writeEvidence(process.env['QA_REPORT_DIR']!);

    const pendingAdapters = {
      ...recordingAdapters(tracking),
      async generate() {
        tracking.calls.push('generate-adapter');
        return {
          mode: 'awaiting-generator' as const,
          generatedFiles: [],
          testCount: 0,
          reason: 'Generator not wired.',
        };
      },
    };

    const controller = new WorkflowController(
      { orchestrationMode: 'automatic', requirementPath, repoRoot },
      pendingAdapters,
    );
    const response = await controller.run({
      requirementPath,
      orchestrationMode: 'automatic',
      evidence: [{ path: evidencePath }],
    });

    expect(response.workflowStage).toBe('generate');
    expect(response.workflowStatus).toBe('blocked');
    expect(response.nextRequiredAction).toContain('resume');
    expect(controller.getState().status).toBe('paused');
    expect(controller.getState().workflow?.generate?.status).toBe('blocked');
    expect(tracking.calls).not.toContain('validate-adapter');
  });

  test('PC-02 Task 4.5: generator throws → Generate failed, run paused', async () => {
    const tracking = { calls: [] as string[] };
    const { requirementPath, repoRoot } = writeRequirement(process.env['QA_REPORT_DIR']!);
    const evidencePath = writeEvidence(process.env['QA_REPORT_DIR']!);

    const failingAdapters = {
      ...recordingAdapters(tracking),
      async generate() {
        tracking.calls.push('generate-adapter');
        throw new Error('generator crashed');
      },
    };

    const controller = new WorkflowController(
      { orchestrationMode: 'automatic', requirementPath, repoRoot },
      failingAdapters,
    );
    const response = await controller.run({
      requirementPath,
      orchestrationMode: 'automatic',
      evidence: [{ path: evidencePath }],
    });

    expect(response.workflowStatus).toBe('failed');
    expect(controller.getState().status).toBe('paused');
  });

  test('Task 6.4: unresolved failure routes feedback and persists loopCounts', async () => {
    const tracking = { calls: [] as string[] };
    const { requirementPath, repoRoot } = writeRequirement(process.env['QA_REPORT_DIR']!);
    const evidencePath = writeEvidence(process.env['QA_REPORT_DIR']!);

    const failingValidateAdapters = {
      ...recordingAdapters(tracking),
      async validate() {
        tracking.calls.push('validate-adapter');
        return {
          unresolvedFailures: 1,
          substage: 'needs-heal' as const,
          failureList: [
            {
              failureSource: 'test',
              message: 'locator timeout on #submit',
              authRedirect: false,
            },
          ],
        };
      },
    };

    const controller = new WorkflowController(
      { orchestrationMode: 'automatic', requirementPath, repoRoot },
      failingValidateAdapters,
    );
    const response = await controller.run({
      requirementPath,
      orchestrationMode: 'automatic',
      evidence: [{ path: evidencePath }],
    });

    expect(response.workflowStatus).toBe('needs-review');
    expect(response.nextRequiredAction).toContain('generate');
    const wf = controller.getState().workflow!;
    expect(wf.lastFeedback?.loopTarget).toBe('generate');
    expect(wf.loopCounts.generate).toBe(1);
  });

  test('Task 6.4: auth redirect failure routes to fix-environment, never locator heal', async () => {
    const tracking = { calls: [] as string[] };
    const { requirementPath, repoRoot } = writeRequirement(process.env['QA_REPORT_DIR']!);
    const evidencePath = writeEvidence(process.env['QA_REPORT_DIR']!);

    const authFailAdapters = {
      ...recordingAdapters(tracking),
      async validate() {
        tracking.calls.push('validate-adapter');
        return {
          unresolvedFailures: 1,
          substage: 'needs-heal' as const,
          failureList: [
            {
              failureSource: 'test',
              message: 'page redirected to login',
              authRedirect: true,
            },
          ],
        };
      },
    };

    const controller = new WorkflowController(
      { orchestrationMode: 'automatic', requirementPath, repoRoot },
      authFailAdapters,
    );
    const response = await controller.run({
      requirementPath,
      orchestrationMode: 'automatic',
      evidence: [{ path: evidencePath }],
    });

    expect(response.nextRequiredAction).toContain('fix-environment');
    expect(controller.getState().workflow?.lastFeedback?.loopTarget).toBe('fix-environment');
  });

  test('Task D4: awaiting-generator then explicit generated output resumes to Generate passed', async () => {
    const tracking = { calls: [] as string[] };
    const { requirementPath, repoRoot } = writeRequirement(process.env['QA_REPORT_DIR']!);
    const evidencePath = writeEvidence(process.env['QA_REPORT_DIR']!);
    let generated = false;
    const adapters = {
      ...recordingAdapters(tracking),
      async generate(input: { generatedFiles?: string[] }) {
        tracking.calls.push('generate-adapter');
        if (!generated || !input.generatedFiles?.length) {
          return {
            mode: 'awaiting-generator' as const,
            generatedFiles: [],
            testCount: 0,
            reason: 'Awaiting external Generator.',
          };
        }
        return {
          mode: 'completed' as const,
          generatedFiles: input.generatedFiles,
          testCount: input.generatedFiles.length,
        };
      },
    };
    const first = new WorkflowController(
      { orchestrationMode: 'automatic', requirementPath, repoRoot, runId: 'run-d4' },
      adapters,
    );
    const firstResponse = await first.run({
      requirementPath,
      orchestrationMode: 'automatic',
      evidence: [{ path: evidencePath }],
    });
    expect(firstResponse.workflowStatus).toBe('blocked');
    expect(first.getState().workflow?.generate?.requiredOutputPaths).toBeDefined();

    generated = true;
    const resumed = new WorkflowController(
      { orchestrationMode: 'automatic', requirementPath, repoRoot, runId: 'run-d4' },
      adapters,
      first.getState(),
    );
    const resumedResponse = await resumed.run({
      requirementPath,
      orchestrationMode: 'automatic',
      evidence: [{ path: evidencePath }],
      resume: true,
    });
    expect(resumedResponse.workflowStage).toBe('validate');
  });

  test('Task C3: current pass without Analyze proof stays needs-review, not QA decision', async () => {
    const tracking = { calls: [] as string[] };
    const { requirementPath, repoRoot } = writeRequirement(process.env['QA_REPORT_DIR']!);
    const evidencePath = writeEvidence(process.env['QA_REPORT_DIR']!);
    const noAnalyzeAdapters = {
      ...recordingAdapters(tracking),
      async validate() {
        tracking.calls.push('validate-adapter');
        return { unresolvedFailures: 0, substage: 'qa-review' as const };
      },
    };
    const controller = new WorkflowController(
      { orchestrationMode: 'automatic', requirementPath, repoRoot },
      noAnalyzeAdapters,
    );
    const response = await controller.run({
      requirementPath,
      orchestrationMode: 'automatic',
      evidence: [{ path: evidencePath }],
    });
    expect(response.workflowStatus).toBe('needs-review');
    expect(response.nextRequiredAction).toContain('Reporter Analyze');
    expect(controller.getState().workflow?.stages.validate.status).toBe('needs-review');
  });

  test('Task C3: current pass with verified Analyze reaches QA decision required', async () => {
    const tracking = { calls: [] as string[] };
    const { requirementPath, repoRoot } = writeRequirement(process.env['QA_REPORT_DIR']!);
    const evidencePath = writeEvidence(process.env['QA_REPORT_DIR']!);
    const analyzedAdapters = {
      ...recordingAdapters(tracking),
      async validate() {
        tracking.calls.push('validate-adapter');
        return {
          unresolvedFailures: 0,
          substage: 'qa-review' as const,
          analysisCompleted: true,
          analysisVerified: true,
          analysisVerdict: 'complete' as const,
        };
      },
    };
    const controller = new WorkflowController(
      { orchestrationMode: 'automatic', requirementPath, repoRoot },
      analyzedAdapters,
    );
    const response = await controller.run({
      requirementPath,
      orchestrationMode: 'automatic',
      evidence: [{ path: evidencePath }],
    });
    expect(response.workflowStatus).toBe('qa-decision-required');
    expect(response.nextRequiredAction).toContain('archive_report');
  });

  test('explicit generated files are contained regular .spec.ts files and all are validated', async () => {
    const dir = tmpDir();
    const testsDir = path.join(dir, 'tests');
    fs.mkdirSync(testsDir, { recursive: true });
    fs.writeFileSync(path.join(testsDir, 'a.spec.ts'), 'ok');
    fs.writeFileSync(path.join(testsDir, 'b.spec.ts'), 'ok');
    const calls: string[] = [];
    const adapters = createMcpAdapters({
      repoRoot: dir,
      tools: {
        validateGeneratedTests: async (args) => {
          calls.push(String(args.filePath));
          return { status: 'success' };
        },
      },
    });
    const result = await adapters.generate({
      requirementPath: 'requirements/flow.md',
      planPath: 'specs/flow-test-plan.md',
      generatedFiles: ['tests/a.spec.ts', 'tests/b.spec.ts'],
    });
    expect(result.mode).toBe('completed');
    expect(calls).toEqual(['tests/a.spec.ts', 'tests/b.spec.ts']);

    const outside = await adapters.generate({
      requirementPath: 'requirements/flow.md',
      planPath: 'specs/flow-test-plan.md',
      generatedFiles: ['tests/../outside.spec.ts'],
    });
    expect(outside.mode).toBe('blocked');

    const directory = path.join(testsDir, 'directory.spec.ts');
    fs.mkdirSync(directory);
    const directoryResult = await adapters.generate({
      requirementPath: 'requirements/flow.md',
      planPath: 'specs/flow-test-plan.md',
      generatedFiles: ['tests/directory.spec.ts'],
    });
    expect(directoryResult.mode).toBe('blocked');
  });

  test('Task B1/B2: Validate result carries the controller runId', async () => {
    const tracking = { calls: [] as string[] };
    const { requirementPath, repoRoot } = writeRequirement(process.env['QA_REPORT_DIR']!);
    const evidencePath = writeEvidence(process.env['QA_REPORT_DIR']!);
    const runId = 'run-test-b1';
    const validateRuns: Array<{ runId?: string; generatedFiles: string[] }> = [];
    const adapters = {
      ...recordingAdapters(tracking),
      async validate(input: { runId?: string; generatedFiles: string[] }) {
        validateRuns.push(input);
        return { unresolvedFailures: 0, substage: 'qa-review' as const };
      },
    };

    const controller = new WorkflowController(
      { orchestrationMode: 'automatic', requirementPath, repoRoot, runId },
      adapters,
    );
    await controller.run({
      requirementPath,
      orchestrationMode: 'automatic',
      evidence: [{ path: evidencePath }],
    });

    expect(validateRuns[0]?.runId).toBe(runId);
    expect(validateRuns[0]?.generatedFiles).toEqual(['tests/flow.spec.ts']);
  });

  test('Task B1: each runId resolves to an isolated results directory', () => {
    const a = resolveValidateResultsDir('C:/repo', 'run-a');
    const b = resolveValidateResultsDir('C:/repo', 'run-b');
    expect(a).not.toBe(b);
    expect(a).toContain('workflow');
    expect(a).toContain('run-a');
    expect(() => resolveValidateResultsDir('C:/repo', undefined)).toThrow(
      'VALIDATE_RUN_ID_REQUIRED',
    );
  });

  test('report coverage: trace graph maps to coverage rows and heal counts', () => {
    const coverage = extractReportCoverageFromTrace({
      scenarios: [
        { scenarioId: 'SC-01', title: 'login', executionStatus: 'passed' },
        { scenarioId: 'SC-02', title: 'logout', executionStatus: 'failed' },
        { scenarioId: 'SC-03', title: 'upload', executionStatus: 'timedOut' },
        { scenarioId: 'SC-04', title: 'reset', executionStatus: 'manual' },
        { scenarioId: 'SC-05', title: 'export', executionStatus: 'skipped' },
        { scenarioId: 'SC-06', title: 'blocked one', executionStatus: 'blocked' },
        { title: 'no id — must be skipped', executionStatus: 'passed' },
      ],
      metrics: { healedScenarios: 2 },
    });

    expect(coverage.scenarios.map((s) => [s.id, s.status])).toEqual([
      ['SC-01', 'passed'],
      ['SC-02', 'failed'],
      ['SC-03', 'failed'],
      ['SC-04', 'not-generated'],
      ['SC-05', 'skipped'],
      ['SC-06', 'not-generated'],
    ]);
    expect(coverage.healedScenarios).toBe(2);
  });

  test('report coverage: malformed trace input yields no invented rows', () => {
    expect(extractReportCoverageFromTrace({}).scenarios).toEqual([]);
    expect(extractReportCoverageFromTrace({ scenarios: 'nope' }).healedScenarios).toBe(0);
    expect(
      extractReportCoverageFromTrace({ metrics: { healedScenarios: -3 } }).healedScenarios,
    ).toBe(0);
  });

  test('Task B3: JSON counters count tests, not spec files', () => {
    const suites = [
      {
        specs: [
          {
            tests: Array.from({ length: 19 }, (_, i) => ({
              status: i === 18 ? 'skipped' : 'passed',
            })),
          },
        ],
      },
    ];
    const counters = parsePlaywrightJsonReport({ suites }, 'results.json');
    expect(counters.total).toBe(19);
    expect(counters.passed).toBe(18);
    expect(counters.skipped).toBe(1);
  });

  test('Task B3: JSON counters exclude auth.setup.ts from feature test counts', () => {
    const suites = [
      {
        title: 'auth.setup.ts',
        specs: [
          {
            tests: [{ status: 'expected' }],
          },
        ],
      },
      {
        title: 'feature.spec.ts',
        specs: [
          {
            tests: [{ status: 'expected' }, { status: 'unexpected' }],
          },
        ],
      },
    ];
    const counters = parsePlaywrightJsonReport({ suites }, 'results.json');
    expect(counters.total).toBe(2);
    expect(counters.passed).toBe(1);
    expect(counters.failed).toBe(1);
  });

  test('state honesty: a needs-heal result never records the heal phase as completed', async () => {
    const tracking = { calls: [] as string[] };
    const { requirementPath, repoRoot } = writeRequirement(process.env['QA_REPORT_DIR']!);
    const evidencePath = writeEvidence(process.env['QA_REPORT_DIR']!);

    const failingAdapters = {
      ...recordingAdapters(tracking),
      async validate() {
        tracking.calls.push('validate-adapter');
        return {
          unresolvedFailures: 2,
          substage: 'needs-heal' as const,
          // Report(Analyze) did run (the honest minimum records failure
          // insights); only the heal substep did not.
          analysisCompleted: true,
          analysisVerified: true,
          analysisVerdict: 'complete' as const,
          failureList: [
            { failureSource: 'test', message: 'locator timeout on #submit', authRedirect: false },
          ],
        };
      },
    };

    const controller = new WorkflowController(
      { orchestrationMode: 'automatic', requirementPath, repoRoot },
      failingAdapters,
    );
    const response = await controller.run({
      requirementPath,
      orchestrationMode: 'automatic',
      evidence: [{ path: evidencePath }],
    });

    expect(response.workflowStatus).toBe('needs-review');
    const state = controller.getState();
    // Execute genuinely ran…
    expect(state.completedPhases).toContain('execute');
    // …but Heal did NOT — claiming otherwise fakes a healing pass.
    expect(state.completedPhases).not.toContain('heal');
    expect(state.completedPhases).not.toContain('report');
    // Physical pointer must reflect the substage that actually ran.
    expect(state.currentPhase).toBe('execute');
    // Routing back to Generate invalidates the downstream Validate payload —
    // no stale Validate result may survive the feedback re-entry.
    expect(state.workflow?.lastFeedback?.loopTarget).toBe('generate');
    expect(state.workflow?.validate).toBeUndefined();
  });

  test('state honesty: a qa-review result records execute/heal/report and points at report', async () => {
    const tracking = { calls: [] as string[] };
    const { requirementPath, repoRoot } = writeRequirement(process.env['QA_REPORT_DIR']!);
    const evidencePath = writeEvidence(process.env['QA_REPORT_DIR']!);

    const cleanAdapters = {
      ...recordingAdapters(tracking),
      async validate() {
        tracking.calls.push('validate-adapter');
        return {
          unresolvedFailures: 0,
          substage: 'qa-review' as const,
          analysisCompleted: true,
          analysisVerified: true,
          analysisVerdict: 'complete' as const,
        };
      },
    };

    const controller = new WorkflowController(
      { orchestrationMode: 'automatic', requirementPath, repoRoot },
      cleanAdapters,
    );
    await controller.run({
      requirementPath,
      orchestrationMode: 'automatic',
      evidence: [{ path: evidencePath }],
    });

    const state = controller.getState();
    for (const phase of ['execute', 'heal', 'report'] as const) {
      expect(state.completedPhases).toContain(phase);
    }
    expect(state.currentPhase).toBe('report');
  });

  test('needs-heal persists when a failure routes to a terminal target (file-bug)', async () => {
    const tracking = { calls: [] as string[] };
    const { requirementPath, repoRoot } = writeRequirement(process.env['QA_REPORT_DIR']!);
    const evidencePath = writeEvidence(process.env['QA_REPORT_DIR']!);

    const appBugAdapters = {
      ...recordingAdapters(tracking),
      async validate() {
        tracking.calls.push('validate-adapter');
        return {
          unresolvedFailures: 1,
          substage: 'needs-heal' as const,
          analysisCompleted: true,
          analysisVerified: true,
          analysisVerdict: 'complete' as const,
          failureList: [
            { failureSource: 'app', message: 'HTTP 500 on /api/invoices', authRedirect: false },
          ],
        };
      },
    };

    const controller = new WorkflowController(
      { orchestrationMode: 'automatic', requirementPath, repoRoot },
      appBugAdapters,
    );
    await controller.run({
      requirementPath,
      orchestrationMode: 'automatic',
      evidence: [{ path: evidencePath }],
    });

    const wf = controller.getState().workflow!;
    // Terminal routing (file-bug) is not a stage re-entry, so the Validate
    // payload and substage survive for QA/agents to read.
    expect(wf.lastFeedback?.loopTarget).toBe('file-bug');
    expect(wf.currentSubstage).toBe('needs-heal');
    expect(wf.validate?.substage).toBe('needs-heal');
    expect(controller.getState().completedPhases).not.toContain('heal');
  });

  test('bounded re-entry: the 4th consecutive failure blocks instead of looping forever', async () => {
    const tracking = { calls: [] as string[] };
    const { requirementPath, repoRoot } = writeRequirement(process.env['QA_REPORT_DIR']!);
    const evidencePath = writeEvidence(process.env['QA_REPORT_DIR']!);

    // Deterministic adapter: Generate always "succeeds", Validate always fails
    // with a fixable test defect → the loop target is `generate` every time.
    const alwaysFailingAdapters = {
      ...recordingAdapters(tracking),
      async validate() {
        tracking.calls.push('validate-adapter');
        return {
          unresolvedFailures: 1,
          substage: 'needs-heal' as const,
          analysisCompleted: true,
          analysisVerified: true,
          analysisVerdict: 'complete' as const,
          failureList: [
            { failureSource: 'test', message: 'locator timeout on #submit', authRedirect: false },
          ],
        };
      },
    };

    const controller = new WorkflowController(
      { orchestrationMode: 'automatic', requirementPath, repoRoot },
      alwaysFailingAdapters,
    );

    // Re-enter Generate → Validate repeatedly; the bound must stop the loop.
    for (let attempt = 0; attempt < 5; attempt++) {
      await controller.run({
        requirementPath,
        orchestrationMode: 'automatic',
        evidence: [{ path: evidencePath }],
      });
    }

    const wf = controller.getState().workflow!;
    // Loop counter is bounded at the limit, not unbounded.
    expect(wf.loopCounts.generate).toBeLessThanOrEqual(4);
    expect(wf.loopCounts.blocked).toBeGreaterThanOrEqual(1);
    expect(wf.lastFeedback?.loopTarget).toBe('blocked');
    expect(String(wf.lastFeedback?.reason)).toContain('re-entry limit');
  });

  test('Task B4: getTestFailures resolves results.json even when newer run-manifest.json exists', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-manifest-coexist-'));
    try {
      const resultsJsonPath = path.join(tempDir, 'results.json');
      fs.writeFileSync(
        resultsJsonPath,
        JSON.stringify({
          suites: [
            {
              specs: [
                {
                  title: 'failing test',
                  file: 'tests/failing.spec.ts',
                  tests: [
                    {
                      results: [
                        {
                          status: 'failed',
                          duration: 120,
                          errors: [{ message: 'Assertion error' }],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        }),
        'utf-8',
      );
      // Write run-manifest.json later so its mtime is newer than results.json
      const manifestPath = path.join(tempDir, 'run-manifest.json');
      fs.writeFileSync(
        manifestPath,
        JSON.stringify({ runId: 'run-123', requirementPath: 'requirements/sample.md' }),
        'utf-8',
      );

      const res = getTestFailures(tempDir);
      expect(res.status).toBe('failure');
      expect(res.failures).toHaveLength(1);
      expect(res.failures[0]?.errorMessage).toBe('Assertion error');
      expect(res.sourceFile).toBe(path.resolve(resultsJsonPath));
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
