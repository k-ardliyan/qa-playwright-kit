/**
 * Stage handler: Generate — Native Semantic Engine
 *
 * Runs the physical generator + validate_generated_tests through the Generate
 * adapter. An `awaiting-generator` result is a truthful PAUSED handoff — never
 * a Generate pass. `passed` requires mode=completed with real files. Feedback
 * from a failed Validate can re-enter Generate with explicit required outputs.
 *
 * @module agents/integration/stages/generate
 */

import * as path from 'path';
import { canGenerate } from '../challenge-gate';
import { transitionWorkflow } from '../workflow-transitions';
import type { StageContext, StageResult } from './context';
import type { StageInput } from './context';

export async function runGenerateStage(ctx: StageContext, input: StageInput): Promise<StageResult> {
  const wf = ctx.workflow();
  const { state } = ctx;
  const explore = wf.explore;
  const model = wf.model;
  const challenge = wf.challenge;

  if (!explore || !model || !challenge) {
    const missing = !explore ? 'Explore' : !model ? 'Model' : 'Challenge';
    const reason = `${missing} has not passed — Generate cannot run before all prerequisites are complete.`;
    const tx = transitionWorkflow(wf, { type: 'stage:block', stage: 'generate', reason });
    if (tx.ok) state.workflow = tx.envelope;
    ctx.markBlocked(reason);
    return ctx.errorResponse(
      state.runId,
      [{ code: 'GENERATE_BLOCKED', message: reason, retryable: false }],
      'generate',
      'blocked',
      `Run '${missing}' before Generate.`,
    );
  }

  const gate = canGenerate(explore, model, challenge);
  if (!gate.allow) {
    const tx = transitionWorkflow(wf, {
      type: 'stage:block',
      stage: 'generate',
      reason: gate.reason,
    });
    if (tx.ok) {
      state.workflow = tx.envelope;
    }
    ctx.markBlocked(gate.reason);
    return ctx.errorResponse(
      state.runId,
      [{ code: 'GENERATE_BLOCKED', message: gate.reason, retryable: false }],
      'generate',
      'blocked',
      gate.reason,
    );
  }

  const tx = transitionWorkflow(wf, { type: 'stage:start', stage: 'generate' });
  if (!tx.ok) return 'continue';
  state.workflow = tx.envelope;
  ctx.saveState(state);

  try {
    const result = await ctx.adapters.generate({
      requirementPath: input.requirementPath,
      planPath: model.planPath,
      roleFilter: input.roleFilter,
      runId: state.runId,
      ...(state.workflow.generate?.requiredOutputPaths
        ? { generatedFiles: state.workflow.generate.requiredOutputPaths }
        : {}),
    });

    // Task 4.2: an awaiting-generator result is a truthful PAUSED handoff —
    // never a Generate pass. `passed` requires mode=completed with files.
    if (result.mode !== 'completed') {
      const tx2 = transitionWorkflow(ctx.workflow(), {
        type: 'stage:block',
        stage: 'generate',
        reason: result.reason ?? 'Generator handoff pending.',
      });
      if (tx2.ok) {
        state.workflow = {
          ...tx2.envelope,
          generate: {
            status: 'blocked',
            reason: result.reason,
            generatedFiles: result.generatedFiles,
            testCount: result.testCount,
            requiredOutputPaths:
              result.generatedFiles.length > 0
                ? result.generatedFiles
                : [`tests/${path.basename(input.requirementPath).replace(/\.md$/i, '')}.spec.ts`],
            freshnessVerified: false,
          },
        };
      }
      ctx.markPaused(result.reason ?? 'Awaiting external generator.');
      const resumeInstruction = `Run the Generator to produce ${'tests/<feature>[-<role>].spec.ts'}, then resume: npx tsx tools/scripts/workflow-run.ts ${input.requirementPath} --resume --run-id ${state.runId}`;
      return {
        status: 'in-progress',
        runId: state.runId,
        workflowStage: 'generate',
        workflowStatus: 'blocked',
        nextRequiredAction: resumeInstruction,
        phase: 'generate',
        result: {
          handoff: {
            handoffType: 'awaiting-generator',
            resumeInstruction,
            reason: result.reason,
          },
        },
      };
    }

    const tx2 = transitionWorkflow(ctx.workflow(), {
      type: 'stage:pass',
      stage: 'generate',
      reason: `Generate passed: ${result.generatedFiles.length} files, ${result.testCount} tests.`,
    });
    if (!tx2.ok) {
      return ctx.errorResponse(
        state.runId,
        [{ code: 'GENERATE_TRANSITION', message: tx2.error, retryable: false }],
        'generate',
        'failed',
      );
    }
    state.workflow = {
      ...tx2.envelope,
      generate: { status: 'passed', ...result },
    };
    state.completedPhases = [...state.completedPhases, 'generate'];
    state.currentPhase = 'generate';
    state.artifacts.generate = result.generatedFiles;
    ctx.saveState(state);
    return 'continue';
  } catch (err) {
    const tx2 = transitionWorkflow(ctx.workflow(), {
      type: 'stage:fail',
      stage: 'generate',
      reason: err instanceof Error ? err.message : 'Generate adapter failed',
    });
    if (tx2.ok) {
      state.workflow = tx2.envelope;
    }
    ctx.markPaused(err instanceof Error ? err.message : 'Generate failed');
    return ctx.errorResponse(
      state.runId,
      [
        {
          code: 'GENERATE_FAILED',
          message: err instanceof Error ? err.message : 'Generate failed',
          retryable: true,
        },
      ],
      'generate',
      'failed',
      'Fix the generator input and re-run Generate.',
    );
  }
}
