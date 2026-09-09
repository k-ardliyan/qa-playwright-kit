/**
 * Stage handler: Challenge — Native Semantic Engine
 *
 * The QA gate between Model and Generate. Runs the plan validator through the
 * Challenge adapter, then evaluates the verdict (fail-closed on error/malformed
 * validator status, needs-review for coverage gaps in manual mode). A blocked
 * Challenge never reaches Generate — enforced at runtime, not by prompt.
 *
 * @module agents/integration/stages/challenge
 */

import { evaluateChallenge } from '../challenge-gate';
import { transitionWorkflow } from '../workflow-transitions';
import type { StageContext, StageResult } from './context';
import type { StageInput } from './context';

export async function runChallengeStage(
  ctx: StageContext,
  input: StageInput,
): Promise<StageResult> {
  const wf = ctx.workflow();
  const { state } = ctx;
  const prerequisite = ctx.firstUnusableStageBefore('challenge');
  if (prerequisite) {
    const reason = `Challenge cannot run before '${prerequisite}' passes or is skipped.`;
    const tx = transitionWorkflow(wf, { type: 'stage:block', stage: 'challenge', reason });
    if (tx.ok) state.workflow = tx.envelope;
    ctx.markBlocked(reason);
    return ctx.errorResponse(
      state.runId,
      [{ code: 'CHALLENGE_BLOCKED', message: reason, retryable: false }],
      'challenge',
      'blocked',
      `Run '${prerequisite}' before Challenge.`,
    );
  }
  const tx = transitionWorkflow(wf, { type: 'stage:start', stage: 'challenge' });
  if (!tx.ok) return 'continue';
  state.workflow = tx.envelope;
  ctx.saveState(state);

  const model = state.workflow.model;
  if (!model || model.status !== 'passed') {
    const tx2 = transitionWorkflow(ctx.workflow(), {
      type: 'stage:block',
      stage: 'challenge',
      reason: 'Model is not passed — Challenge cannot run.',
    });
    if (tx2.ok) {
      state.workflow = tx2.envelope;
    }
    ctx.markBlocked('Model must pass before Challenge.');
    return ctx.errorResponse(
      state.runId,
      [
        {
          code: 'CHALLENGE_BLOCKED',
          message: 'Model must pass before Challenge.',
          retryable: false,
        },
      ],
      'challenge',
      'blocked',
      'Fix and re-run Model.',
    );
  }

  const explore = state.workflow.explore!;
  let adapter: Awaited<ReturnType<StageContext['adapters']['challenge']>>;
  try {
    adapter = await ctx.adapters.challenge({
      planPath: model.planPath,
      requirementPath: input.requirementPath,
      mode: input.orchestrationMode,
    });
  } catch (err) {
    const tx2 = transitionWorkflow(ctx.workflow(), {
      type: 'stage:fail',
      stage: 'challenge',
      reason: err instanceof Error ? err.message : 'Challenge adapter failed',
    });
    if (tx2.ok) {
      state.workflow = tx2.envelope;
      ctx.saveState(state);
    }
    return ctx.errorResponse(
      state.runId,
      [
        {
          code: 'CHALLENGE_FAILED',
          message: err instanceof Error ? err.message : 'Challenge failed',
          retryable: true,
        },
      ],
      'challenge',
      'failed',
    );
  }

  const verdict = evaluateChallenge({
    explore,
    model,
    diagnostics: adapter.diagnostics,
    assumptions: adapter.assumptions,
    coverageGaps: adapter.coverageGaps,
    assertionCount: adapter.assertionCount,
    assumptionCount: adapter.assumptionCount,
    coverageGapCount: adapter.coverageGapCount,
    validatorStatus: adapter.validatorStatus,
    mode: input.orchestrationMode,
  });
  const tx2 = transitionWorkflow(ctx.workflow(), {
    type:
      verdict.result.status === 'passed'
        ? 'stage:pass'
        : verdict.result.status === 'needs-review'
          ? 'stage:needs-review'
          : 'stage:block',
    stage: 'challenge',
    reason: verdict.result.reason ?? '',
  });
  if (!tx2.ok) {
    return ctx.errorResponse(
      state.runId,
      [{ code: 'CHALLENGE_TRANSITION', message: tx2.error, retryable: false }],
      'challenge',
      'failed',
    );
  }
  state.workflow = { ...tx2.envelope, challenge: verdict.result };
  ctx.saveState(state);

  if (!verdict.allow) {
    const reason = verdict.result.reason ?? 'Challenge did not approve Generate.';
    ctx.markBlocked(reason);
    return ctx.errorResponse(
      state.runId,
      [{ code: 'CHALLENGE_BLOCKED', message: reason, retryable: false }],
      'challenge',
      verdict.result.status === 'needs-review' ? 'needs-review' : 'blocked',
      `Fix the test plan (${verdict.result.blockingCodes.join(', ') || 'warnings/assumptions'}) and re-run Challenge.`,
    );
  }
  return 'continue';
}
