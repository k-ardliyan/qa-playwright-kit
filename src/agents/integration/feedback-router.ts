/**
 * Feedback Router — Agent AI Integration Layer
 *
 * Pure routing function that maps a Validate finding to the smallest stage
 * that can fix it (LEARN → REFINE → RE-EXPLORE). `failureSource` stays the
 * machine-readable classification; `loopTarget` is the re-entry destination.
 *
 * @module agents/integration/feedback-router
 */

import { FeedbackDecision, WorkflowLoopTarget } from './types';

/**
 * A Validate finding to route.
 */
export interface FeedbackInput {
  /** Machine-readable failure classification. */
  failureSource: 'app' | 'test' | 'requirement' | 'env' | 'ai_generation' | 'unknown';
  /** Error text / summary of the finding. */
  message: string;
  /** Evidence paths (trace/screenshot/console) when available. */
  evidencePaths?: string[];
  /** True when the page landed on a login page or auth failed mid-run. */
  authRedirect?: boolean;
}

/**
 * Route a finding to the smallest useful stage.
 *
 * Mapping:
 * - auth redirect / session failure → fix-environment (never heal locators)
 * - app bug proven → file-bug
 * - env/auth/seed → fix-environment
 * - unknown UI/selector/state → explore
 * - observed behavior differs from requirement → model
 * - weak assertion / missing edge case → challenge
 * - locator/setup/generated script wrong → generate
 * - insufficient evidence → blocked
 */
export function routeFeedback(input: FeedbackInput): FeedbackDecision {
  const evidencePaths = input.evidencePaths ?? [];

  if (input.authRedirect) {
    return {
      loopTarget: 'fix-environment',
      failureSource: 'env',
      reason:
        'Auth failure detected (login redirect / session expired). Re-run real UI auth setup — never patch locators against a login page.',
      evidencePaths,
    };
  }

  switch (input.failureSource) {
    case 'app':
      return {
        loopTarget: 'file-bug',
        failureSource: 'app',
        reason: 'App defect proven by evidence — file a bug, keep the test as a regression guard.',
        evidencePaths,
      };
    case 'env':
      return {
        loopTarget: 'fix-environment',
        failureSource: 'env',
        reason: 'Environment/auth/seed failure — fix the environment, then re-run Validate.',
        evidencePaths,
      };
    case 'requirement':
      return {
        loopTarget: 'model',
        failureSource: 'requirement',
        reason: 'Observed behavior conflicts with the requirement — revise the requirement/model.',
        evidencePaths,
      };
    case 'test':
    case 'ai_generation':
      return {
        loopTarget: 'generate',
        failureSource: input.failureSource,
        reason: 'Test implementation is wrong — fix the generated spec, then re-run Validate.',
        evidencePaths,
      };
    case 'unknown':
    default:
      return {
        loopTarget: 'blocked',
        failureSource: 'unknown',
        reason: 'Insufficient evidence to classify — do not guess; document the blocker.',
        evidencePaths,
      };
  }
}

/**
 * True when a loop target is a workflow stage (re-entry) rather than a
 * terminal decision (file-bug / fix-environment / blocked).
 */
export function isStageReentry(target: WorkflowLoopTarget): boolean {
  return (
    target === 'explore' || target === 'model' || target === 'challenge' || target === 'generate'
  );
}
