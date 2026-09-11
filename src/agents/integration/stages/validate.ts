/**
 * Stage handler: Validate — Native Semantic Engine
 *
 * Grouped Execute → Heal → Report(Analyze). Requires every prerequisite to be
 * usable, never re-executes a run already waiting for the QA decision, and
 * fails closed without verified Report(Analyze) evidence (C3/C4: without
 * analysis.completed/verified/complete, Validate is needs-review, never
 * QA-decision-required and never success). Unresolved failures are routed to
 * the smallest responsible stage (bounded by loopCounts) via routeFeedback.
 *
 * @module agents/integration/stages/validate
 */

import { routeFeedback, type FeedbackInput } from '../feedback-router';
import type { FeedbackDecision, PipelinePhase } from '../types';
import type { WorkflowResponse } from '../workflow-controller';
import { transitionWorkflow } from '../workflow-transitions';
import { buildManualResumeInstruction } from './resume-instruction';
import type { StageContext } from './context';
import type { StageInput } from './context';

function requirementPathToFeature(requirementPath: string): string {
  return requirementPath.split(/[/\\]/).pop()?.replace(/\.md$/i, '') ?? 'feature';
}

export async function runValidateStage(
  ctx: StageContext,
  input: StageInput,
): Promise<WorkflowResponse> {
  const wf = ctx.workflow();
  const { state } = ctx;

  const firstPrerequisite = ctx.firstUnusableStageBefore('validate');
  if (firstPrerequisite) {
    const reason = `Validate cannot run before '${firstPrerequisite}' passes or is skipped.`;
    const tx = transitionWorkflow(wf, { type: 'stage:block', stage: 'validate', reason });
    if (tx.ok) state.workflow = tx.envelope;
    ctx.markBlocked(reason);
    return ctx.errorResponse(
      state.runId,
      [{ code: 'VALIDATE_BLOCKED', message: reason, retryable: false }],
      'validate',
      'blocked',
      `Run '${firstPrerequisite}' before Validate.`,
    );
  }

  // Resume guard: a run already waiting for the QA decision must not
  // re-execute tests (PC-01/PC-02 — no fabricated re-validation).
  if (wf.stages.validate.status === 'qa-decision-required') {
    return {
      status: 'in-progress',
      runId: state.runId,
      workflowStage: 'validate',
      workflowStatus: 'qa-decision-required',
      nextRequiredAction:
        'This run already completed Validate. Record the explicit QA decision (archive_report) — do not re-run tests.',
      phase: 'report',
      result: { validate: wf.validate },
    };
  }

  const tx = transitionWorkflow(wf, { type: 'stage:start', stage: 'validate' });
  if (!tx.ok) {
    return ctx.errorResponse(
      state.runId,
      [{ code: 'VALIDATE_TRANSITION', message: tx.error, retryable: false }],
      'validate',
      'failed',
    );
  }
  state.workflow = { ...tx.envelope, currentSubstage: 'execute' };
  ctx.saveState(state);

  const generated = state.workflow.generate?.generatedFiles ?? [];
  if (generated.length === 0) {
    const reason = 'No executable generated files are available for Validate.';
    ctx.markPaused(reason);
    const fallbackPaths = [`tests/${requirementPathToFeature(input.requirementPath)}.spec.ts`];
    return {
      status: 'in-progress',
      runId: state.runId,
      workflowStage: 'validate',
      workflowStatus: 'blocked',
      nextRequiredAction: buildManualResumeInstruction(
        fallbackPaths,
        input.requirementPath,
        state.runId,
      ),
      phase: 'generate',
      result: { handoff: { handoffType: 'awaiting-generator', reason } },
    };
  }
  try {
    const result = await ctx.adapters.validate({
      requirementPath: input.requirementPath,
      generatedFiles: generated,
      runId: state.runId,
    });
    const analysisComplete =
      result.analysisCompleted === true &&
      result.analysisVerified === true &&
      result.analysisVerdict === 'complete';
    if (!analysisComplete) {
      // C3/C4: without verified Report(Analyze), Validate is needs-review,
      // never QA-decision-required and never success.
      const analysisTx = transitionWorkflow(ctx.workflow(), {
        type: 'stage:needs-review',
        stage: 'validate',
        reason: 'Report(Analyze) evidence is incomplete or unverifiable.',
      });
      if (analysisTx.ok) state.workflow = analysisTx.envelope;
      state.workflow = {
        ...ctx.workflow(),
        currentSubstage: 'report-analyze',
        validate: {
          status: 'needs-review',
          substage: 'report-analyze',
          unresolvedFailures: result.unresolvedFailures,
          reason: 'Report(Analyze) evidence is incomplete or unverifiable.',
        },
      };
      let incompleteFeedback: FeedbackDecision | undefined;
      if (result.unresolvedFailures > 0 && Array.isArray(result.failureList)) {
        const firstFailure = result.failureList[0] as Record<string, unknown> | undefined;
        incompleteFeedback = routeFeedback({
          failureSource:
            typeof firstFailure?.failureSource === 'string'
              ? (firstFailure.failureSource as FeedbackInput['failureSource'])
              : 'unknown',
          message: String(firstFailure?.message ?? 'Unresolved failure'),
          evidencePaths: [],
          authRedirect: firstFailure?.authRedirect === true,
        });
        const feedbackTx = transitionWorkflow(ctx.workflow(), {
          type: 'feedback',
          decision: incompleteFeedback,
        });
        if (feedbackTx.ok)
          state.workflow = ctx.invalidateDownstream(
            feedbackTx.envelope,
            incompleteFeedback.loopTarget,
          );
      }
      ctx.markPaused('Report(Analyze) proof is incomplete.');
      return {
        status: 'in-progress',
        runId: state.runId,
        workflowStage: 'validate',
        workflowStatus: 'needs-review',
        nextRequiredAction: incompleteFeedback
          ? `Route to '${incompleteFeedback.loopTarget}' (${incompleteFeedback.failureSource}): ${incompleteFeedback.reason}`
          : 'Run Reporter Analyze and verify analysis.completed, analysisVerified, analysisVerdict=complete before QA decision.',
        phase: 'report',
        result: {
          validate: state.workflow.validate,
          ...(incompleteFeedback ? { feedback: incompleteFeedback } : {}),
        },
      };
    }

    const validateResult = {
      status: result.unresolvedFailures === 0 ? ('passed' as const) : ('needs-review' as const),
      substage: result.substage,
      unresolvedFailures: result.unresolvedFailures,
    };
    if (result.unresolvedFailures === 0) {
      const tx2 = transitionWorkflow(ctx.workflow(), {
        type: 'stage:qa-decision',
        stage: 'validate',
        reason: 'Validate completed with no unresolved failures.',
        completionProof: {
          analysisCompleted: true,
          analysisVerified: true,
          analysisVerdict: 'complete',
        },
      });
      if (!tx2.ok) {
        return ctx.errorResponse(
          state.runId,
          [{ code: 'VALIDATE_TRANSITION', message: tx2.error, retryable: false }],
          'validate',
          'failed',
        );
      }
      state.workflow = {
        ...tx2.envelope,
        currentSubstage: result.substage,
        validate: validateResult,
      };
    } else {
      const reviewTx = transitionWorkflow(ctx.workflow(), {
        type: 'stage:needs-review',
        stage: 'validate',
        reason: 'Validate completed with unresolved failures.',
      });
      state.workflow = reviewTx.ok
        ? {
            ...reviewTx.envelope,
            currentSubstage: result.substage,
            validate: validateResult,
          }
        : {
            ...ctx.workflow(),
            currentSubstage: result.substage,
            validate: validateResult,
          };
    }
    state.status = 'paused'; // WAITING for an explicit QA decision
    // PC-04: only mark physical phases completed when their substeps REALLY
    // ran. The validate adapter reports which substages executed.
    // `needs-heal` proves Execute ran but NOT Heal — a failing run routed back
    // to Generate must not record `heal` as completed.
    const completedPhysical: PipelinePhase[] = [];
    // Execute ran whenever Validate returned an adapter result (all substage
    // values except the early-exit paths prove the runner executed).
    completedPhysical.push('execute');
    if (
      result.substage === 'heal' ||
      result.substage === 'report-analyze' ||
      result.substage === 'qa-review'
    ) {
      completedPhysical.push('heal');
    }
    if (result.substage === 'report-analyze' || result.substage === 'qa-review') {
      completedPhysical.push('report');
    }
    state.completedPhases = [...new Set([...state.completedPhases, ...completedPhysical])];
    // Keep the physical pointer aligned with the substage that actually ran —
    // `currentPhase` must never stay on an earlier phase once Validate acted.
    if (completedPhysical.length > 0) {
      state.currentPhase = completedPhysical[completedPhysical.length - 1];
    }

    // Task 6.1: route unresolved failures to the smallest responsible stage
    // and persist the decision (bounded by loopCounts).
    let feedback: FeedbackDecision | undefined;
    if (result.unresolvedFailures > 0) {
      const firstFailure =
        Array.isArray(result.failureList) && result.failureList.length > 0
          ? (result.failureList[0] as Record<string, unknown>)
          : undefined;
      const failureMessage = String(
        firstFailure?.errorMessage ?? firstFailure?.message ?? 'Unresolved failure',
      );
      const failureSource =
        firstFailure && typeof firstFailure.failureSource === 'string'
          ? (firstFailure.failureSource as FeedbackInput['failureSource'])
          : 'unknown';
      const authRedirect =
        firstFailure && typeof firstFailure.authRedirect === 'boolean'
          ? firstFailure.authRedirect
          : /login required|session expired|redirected to login|kredensial tidak valid/i.test(
              failureMessage,
            );
      const evidencePaths: string[] = [];
      if (typeof firstFailure?.tracePath === 'string' && firstFailure.tracePath) {
        evidencePaths.push(firstFailure.tracePath);
      }
      if (typeof firstFailure?.screenshotPath === 'string' && firstFailure.screenshotPath) {
        evidencePaths.push(firstFailure.screenshotPath);
      }
      feedback = routeFeedback({
        failureSource,
        message: failureMessage,
        evidencePaths,
        authRedirect,
      });
      const currentLoopCount = ctx.workflow().loopCounts[feedback.loopTarget] ?? 0;
      if (currentLoopCount >= 3) {
        feedback = {
          ...feedback,
          loopTarget: 'blocked',
          reason: `Semantic re-entry limit reached for '${feedback.loopTarget}' (max 3). Human/QA decision required.`,
        };
      }
      const tx3 = transitionWorkflow(ctx.workflow(), {
        type: 'feedback',
        decision: feedback,
      });
      if (tx3.ok) {
        state.workflow = ctx.invalidateDownstream(tx3.envelope, feedback.loopTarget);
      }
    }
    ctx.saveState(state);

    return {
      status: result.unresolvedFailures === 0 ? 'success' : 'in-progress',
      runId: state.runId,
      workflowStage: 'validate',
      workflowStatus: result.unresolvedFailures === 0 ? 'qa-decision-required' : 'needs-review',
      nextRequiredAction:
        result.unresolvedFailures === 0
          ? 'Review the report and record an explicit QA decision (archive_report).'
          : feedback
            ? `Route to '${feedback.loopTarget}' (${feedback.failureSource}): ${feedback.reason}`
            : 'Inspect unresolved failures; classify and route (heal/file-bug/fix-environment).',
      phase: 'report',
      result: {
        validate: state.workflow.validate,
        ...(feedback ? { feedback } : {}),
      },
    };
  } catch (err) {
    const tx2 = transitionWorkflow(ctx.workflow(), {
      type: 'stage:fail',
      stage: 'validate',
      reason: err instanceof Error ? err.message : 'Validate adapter failed',
    });
    if (tx2.ok) {
      state.workflow = tx2.envelope;
      ctx.saveState(state);
    }
    return ctx.errorResponse(
      state.runId,
      [
        {
          code: 'VALIDATE_FAILED',
          message: err instanceof Error ? err.message : 'Validate failed',
          retryable: true,
        },
      ],
      'validate',
      'failed',
    );
  }
}
