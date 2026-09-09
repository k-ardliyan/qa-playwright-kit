/**
 * Stage handler: Explore — Native Semantic Engine
 *
 * Enforces the Explore policy at runtime: `required` runs the live Explore
 * adapter (snapshot_page/discover_pages) then re-checks the policy against the
 * fresh evidence; `satisfied`/`recommended` commit the policy decision, with
 * `recommended` still recording best-effort live evidence in automatic mode.
 * A hard block (no session for a protected route) stops the workflow here.
 *
 * @module agents/integration/stages/explore
 */

import { evaluateExplorePolicy } from '../explore-policy';
import { isStageUsable, transitionWorkflow } from '../workflow-transitions';
import type { StageContext, StageResult } from './context';
import type { StageInput } from './context';

export async function runExploreStage(ctx: StageContext, input: StageInput): Promise<StageResult> {
  const wf = ctx.workflow();
  if (isStageUsable(wf.stages.explore)) return 'continue';
  const { state } = ctx;
  const tx = transitionWorkflow(wf, { type: 'stage:start', stage: 'explore' });
  if (!tx.ok) return 'continue';
  state.workflow = tx.envelope;
  ctx.saveState(state);

  const policy = evaluateExplorePolicy({
    requirementPath: input.requirementPath,
    evidence: input.evidence,
    blockedReason: input.blockedReason,
    flags: input.flags,
  });

  // `required` means live exploration MUST run (evidence missing/stale).
  // Run the Explore adapter (snapshot_page/discover_pages) and re-check the
  // policy against the fresh evidence. Only a hard block (e.g. no session
  // for a protected route) stops the workflow here.
  if (policy.status === 'required') {
    try {
      const live = await ctx.adapters.explore({
        requirementPath: input.requirementPath,
        role: input.roleFilter?.[0],
      });
      const refreshed = evaluateExplorePolicy({
        requirementPath: input.requirementPath,
        evidence: live.evidence,
        blockedReason: input.blockedReason,
        flags: input.flags,
      });
      if (refreshed.status === 'required' || refreshed.status === 'blocked') {
        const tx2 = transitionWorkflow(ctx.workflow(), {
          type: 'stage:block',
          stage: 'explore',
          reason: refreshed.reason,
        });
        if (tx2.ok) {
          state.workflow = { ...tx2.envelope, explore: refreshed };
        }
        ctx.markBlocked(refreshed.reason);
        return ctx.errorResponse(
          state.runId,
          [{ code: 'EXPLORE_REQUIRED', message: refreshed.reason, retryable: true }],
          'explore',
          'blocked',
          'Run snapshot_page/discover_pages for the requirement, then resume.',
        );
      }
      // Fresh evidence satisfied the policy — commit the decision.
      const tx2 = transitionWorkflow(ctx.workflow(), {
        type: 'stage:pass',
        stage: 'explore',
        reason: refreshed.reason,
      });
      if (!tx2.ok) {
        return ctx.errorResponse(
          state.runId,
          [{ code: 'EXPLORE_TRANSITION', message: tx2.error, retryable: false }],
          'explore',
          'failed',
        );
      }
      state.workflow = { ...tx2.envelope, explore: refreshed };
      ctx.saveState(state);
      return 'continue';
    } catch (err) {
      const tx2 = transitionWorkflow(ctx.workflow(), {
        type: 'stage:block',
        stage: 'explore',
        reason: err instanceof Error ? err.message : 'Live exploration failed',
      });
      if (tx2.ok) {
        state.workflow = { ...tx2.envelope, explore: policy };
      }
      ctx.markBlocked(err instanceof Error ? err.message : 'Live exploration failed');
      return ctx.errorResponse(
        state.runId,
        [
          {
            code: 'EXPLORE_REQUIRED',
            message: err instanceof Error ? err.message : 'Live exploration failed',
            retryable: true,
          },
        ],
        'explore',
        'blocked',
        'Fix the exploration blocker (BASE_URL/session/network), then resume.',
      );
    }
  }

  // satisfied / recommended / skipped: commit decision; recommended still
  // proceeds in automatic mode — recorded as a policy decision.
  const target: 'pass' | 'skip' = policy.status === 'skipped' ? 'skip' : 'pass';
  const tx2 = transitionWorkflow(ctx.workflow(), {
    type: target === 'skip' ? 'stage:skip' : 'stage:pass',
    stage: 'explore',
    reason: policy.reason,
  });
  if (!tx2.ok) {
    return ctx.errorResponse(
      state.runId,
      [{ code: 'EXPLORE_TRANSITION', message: tx2.error, retryable: false }],
      'explore',
      'failed',
    );
  }
  // Live exploration only when the policy asks for it.
  if (policy.status === 'recommended') {
    try {
      const live = await ctx.adapters.explore({
        requirementPath: input.requirementPath,
        role: input.roleFilter?.[0],
      });
      policy.evidencePaths = live.evidence.map((e) => e.path);
    } catch {
      // Exploration failed but evidence policy already passed — record and continue.
    }
  }
  state.workflow = { ...tx2.envelope, explore: policy };
  ctx.saveState(state);
  return 'continue';
}
