/**
 * Challenge Gate — Agent AI Integration Layer
 *
 * The blocking gate between Model and Generate. Wraps the existing
 * `validate_plan` authority (tools/mcp/src/tools/validate-plan.ts) semantics
 * into a pure decision: can Generate run?
 *
 * The gate is deliberately pure — it takes typed inputs and returns a typed
 * verdict, so the controller can enforce it without duplicating validator
 * logic and without browser access.
 *
 * @module agents/integration/challenge-gate
 */

import { ChallengeResult, ExploreDecision, ModelResult } from './types';

/**
 * Inputs the gate needs to decide.
 */
export interface ChallengeGateInput {
  explore: ExploreDecision;
  model: ModelResult;
  /** Diagnostic codes with severity, from the plan validator. */
  diagnostics: Array<{ code: string; severity: 'error' | 'warning' | 'info' }>;
  /** Plan assumptions surfaced by the validator. */
  assumptions?: unknown[];
  /** Coverage gaps surfaced by the validator. */
  coverageGaps?: unknown[];
  /** Assertion count from the compiled plan. */
  assertionCount?: number;
  /** Direct counts when the validator reports them (preferred over array length). */
  assumptionCount?: number;
  coverageGapCount?: number;
  /** validate_plan result status — fail closed unless success/warning. */
  validatorStatus?: string;
  /** Orchestration mode: automatic records warning decisions, manual pauses. */
  mode: 'manual' | 'automatic';
}

/**
 * Verdict of the Challenge gate.
 */
export type ChallengeVerdict =
  | { allow: true; result: ChallengeResult }
  | { allow: false; result: ChallengeResult };

/**
 * Decide whether Generate may run.
 *
 * Rules:
 * - Explore not usable (required/blocked) → block.
 * - Model not passed → block.
 * - Any `error` diagnostic → block.
 * - Warnings only: automatic mode records the decision and allows; manual
 *   mode pauses with `needs-review`.
 * - Zero blocking diagnostics + current hashes → allow.
 */
export function evaluateChallenge(input: ChallengeGateInput): ChallengeVerdict {
  const checkedAt = new Date().toISOString();
  const blockingCodes = input.diagnostics.filter((d) => d.severity === 'error').map((d) => d.code);
  const warningCodes = input.diagnostics.filter((d) => d.severity === 'warning').map((d) => d.code);

  const base = {
    planHash: input.model.planHash,
    blockingCodes,
    warningCodes,
    assumptionCount: input.assumptionCount ?? input.assumptions?.length ?? 0,
    coverageGapCount: input.coverageGapCount ?? input.coverageGaps?.length ?? 0,
    assertionCount: input.assertionCount ?? 0,
    checkedAt,
    ...(input.validatorStatus !== undefined ? { validatorStatus: input.validatorStatus } : {}),
    policyMode: input.mode,
  };

  if (input.explore.status === 'required' || input.explore.status === 'blocked') {
    return {
      allow: false,
      result: {
        ...base,
        status: 'blocked',
        reason: `Explore is '${input.explore.status}' — Generate cannot be approved without usable UI evidence.`,
      },
    };
  }

  if (input.model.status !== 'passed') {
    return {
      allow: false,
      result: {
        ...base,
        status: 'blocked',
        reason: `Model is '${input.model.status}' — a passed Model is required before Challenge can approve Generate.`,
      },
    };
  }

  // Task 3.1: fail closed on the validator RESULT STATUS. A result that is not
  // success/warning (error, malformed, missing) must never allow Generate —
  // even when diagnostics happen to be empty.
  if (
    input.validatorStatus !== undefined &&
    input.validatorStatus !== 'success' &&
    input.validatorStatus !== 'warning'
  ) {
    return {
      allow: false,
      result: {
        ...base,
        status: 'blocked',
        reason: `validate_plan returned status '${input.validatorStatus}' — Challenge fails closed.`,
      },
    };
  }

  if (blockingCodes.length > 0) {
    return {
      allow: false,
      result: {
        ...base,
        status: 'blocked',
        reason: `Challenge found blocking diagnostic(s): ${blockingCodes.join(', ')}. Fix the plan and re-run Challenge.`,
      },
    };
  }

  // Task 3.2: unresolved coverage gaps are a gate decision, not a silent pass.
  const gapCount = input.coverageGapCount ?? input.coverageGaps?.length ?? 0;
  if (gapCount > 0) {
    if (input.mode === 'automatic') {
      return {
        allow: true,
        result: {
          ...base,
          status: 'passed',
          policyAccepted: true,
          reason: `Challenge passed with ${gapCount} recorded coverage gap(s) (automatic mode policy decision).`,
        },
      };
    }
    return {
      allow: false,
      result: {
        ...base,
        status: 'needs-review',
        policyAccepted: false,
        reason: `Challenge found ${gapCount} coverage gap(s). Review before Generate in manual mode.`,
      },
    };
  }

  if (warningCodes.length > 0) {
    if (input.mode === 'automatic') {
      return {
        allow: true,
        result: {
          ...base,
          status: 'passed',
          policyAccepted: true,
          reason: `Challenge passed with recorded warning(s): ${warningCodes.join(', ')} (automatic mode policy decision).`,
        },
      };
    }
    return {
      allow: false,
      result: {
        ...base,
        status: 'needs-review',
        policyAccepted: false,
        reason: `Challenge found warning(s): ${warningCodes.join(', ')}. Review before Generate in manual mode.`,
      },
    };
  }

  return {
    allow: true,
    result: {
      ...base,
      status: 'passed',
      reason: 'Challenge passed: no blocking diagnostics, hashes current.',
    },
  };
}

/**
 * Pure precondition check for Generate — the machine-enforced
 * "FOURTH, NOT FIRST" invariant.
 *
 * @returns `{ allow: true }` or `{ allow: false, reason }`.
 */
export function canGenerate(
  explore: ExploreDecision,
  model: ModelResult,
  challenge: ChallengeResult,
): { allow: true } | { allow: false; reason: string } {
  if (explore.status === 'required' || explore.status === 'blocked') {
    return {
      allow: false,
      reason: `Explore is '${explore.status}' — Generate is blocked until UI evidence is usable.`,
    };
  }
  if (model.status !== 'passed') {
    return {
      allow: false,
      reason: `Model is '${model.status}' — Generate is blocked until the model passes.`,
    };
  }
  if (challenge.status !== 'passed') {
    return {
      allow: false,
      reason: `Challenge is '${challenge.status}' — Generate is blocked until the gate passes.`,
    };
  }
  return { allow: true };
}
