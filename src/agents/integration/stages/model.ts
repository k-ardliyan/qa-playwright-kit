/**
 * Stage handler: Model — Native Semantic Engine
 *
 * Compiles the requirement + test plan through the Model adapter. A missing
 * plan artifact is a PAUSED Planner handoff (ModelHandoffError), never a
 * terminal failure — the run waits for external Planner output with an exact
 * resume instruction.
 *
 * @module agents/integration/stages/model
 */

import { ModelHandoffError } from '../mcp-adapters';
import { transitionWorkflow } from '../workflow-transitions';
import type { StageContext, StageResult } from './context';
import type { StageInput } from './context';

export async function runModelStage(ctx: StageContext, input: StageInput): Promise<StageResult> {
  const { state } = ctx;
  const tx = transitionWorkflow(ctx.workflow(), { type: 'stage:start', stage: 'model' });
  if (!tx.ok) return 'continue';
  state.workflow = tx.envelope;
  ctx.saveState(state);

  let result: Awaited<ReturnType<StageContext['adapters']['model']>>;
  try {
    result = await ctx.adapters.model({
      requirementPath: input.requirementPath,
      roleFilter: input.roleFilter,
    });
  } catch (err) {
    const tx2 = transitionWorkflow(ctx.workflow(), {
      type: 'stage:fail',
      stage: 'model',
      reason: err instanceof Error ? err.message : 'Model adapter failed',
    });
    if (tx2.ok) {
      state.workflow = tx2.envelope;
    }

    // Planner handoff: the plan artifact is missing — this is a PAUSED run
    // waiting for external Planner output, never a terminal failure.
    if (err instanceof ModelHandoffError) {
      ctx.markPaused(err.message);
      const resumeInstruction = `Run the Planner to create ${err.requiredArtifactPath}, then resume: npx tsx tools/scripts/workflow-run.ts ${input.requirementPath} --resume --run-id ${state.runId}`;
      return {
        status: 'in-progress',
        runId: state.runId,
        workflowStage: 'model',
        workflowStatus: 'blocked',
        nextRequiredAction: resumeInstruction,
        phase: 'model',
        result: {
          handoff: {
            handoffType: err.handoffType,
            requiredArtifactPath: err.requiredArtifactPath,
            resumeInstruction,
          },
        },
      };
    }

    // Model failure waiting on external input (e.g. missing plan = Planner
    // handoff) pauses the run — it must not stay `running` after exit.
    ctx.markPaused(err instanceof Error ? err.message : 'Model failed');
    return ctx.errorResponse(
      state.runId,
      [
        {
          code: 'MODEL_FAILED',
          message: err instanceof Error ? err.message : 'Model failed',
          retryable: true,
        },
      ],
      'model',
      'failed',
      'Fix the requirement/plan input and re-run Model.',
    );
  }

  const modelResult = {
    status: 'passed' as const,
    ...result,
    requirementHash: state.requirementHash ?? result.requirementHash,
  };
  const tx2 = transitionWorkflow(ctx.workflow(), {
    type: 'stage:pass',
    stage: 'model',
    reason: `Model passed: ${result.scenarioCount} scenarios, ${result.coverageGapCount} coverage gaps.`,
  });
  if (!tx2.ok) {
    return ctx.errorResponse(
      state.runId,
      [{ code: 'MODEL_TRANSITION', message: tx2.error, retryable: false }],
      'model',
      'failed',
    );
  }
  state.workflow = { ...tx2.envelope, model: modelResult };
  state.planHash = result.planHash;
  state.completedPhases = [...state.completedPhases, 'plan'];
  state.currentPhase = 'plan';
  ctx.saveState(state);
  return 'continue';
}
