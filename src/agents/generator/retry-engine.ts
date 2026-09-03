/**
 * Retry Engine for Generator Agent.
 *
 * Implements exponential backoff retry strategy for scenario generation.
 * Classifies failures and determines whether to retry, skip, or fallback
 * to skeleton test generation.
 *
 * Backoff formula: delay = retryDelayMs × 2^(attempt-1), capped at 30000ms
 * Total attempts = maxRetriesPerScenario + 1 (initial + retries)
 *
 * @module agents/generator/retry-engine
 * @requirements 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7
 */

import type {
  FailureClassification,
  GenerationOptions,
  GeneratedScenario,
  SkippedScenario,
} from '../../shared/types';
import { classifyFailure, isRetryable } from './failure-classifier';
import type { TestScenario, ScenarioGenerator } from './partial-engine';

// ─── Constants ────────────────────────────────────────────────────────────────

/** Maximum backoff delay cap in milliseconds */
const MAX_BACKOFF_DELAY_MS = 30000;

// ─── Exported Types ───────────────────────────────────────────────────────────

/**
 * Result of retrying a single scenario through the retry engine.
 */
export interface RetryResult {
  /** Whether the scenario ultimately succeeded (generated or skeleton) */
  success: boolean;
  /** The generated scenario details (set when generation or skeleton succeeds) */
  generated?: GeneratedScenario;
  /** The skipped scenario details (set when all retries exhausted and no fallback) */
  skipped?: SkippedScenario;
  /** Total number of attempts made (initial + retries) */
  attempts: number;
  /** Actual delays applied between attempts in milliseconds (for testing) */
  delays: number[];
}

// ─── Backoff Calculation ──────────────────────────────────────────────────────

/**
 * Calculates exponential backoff delay.
 *
 * Formula: delay = retryDelayMs × 2^(attempt-1), capped at 30000ms
 *
 * @param retryDelayMs - Base delay in milliseconds
 * @param attempt - 1-based retry attempt number
 * @returns Computed delay in milliseconds, capped at MAX_BACKOFF_DELAY_MS
 *
 * @requirements 4.3
 */
export function calculateBackoffDelay(retryDelayMs: number, attempt: number): number {
  const delay = retryDelayMs * Math.pow(2, attempt - 1);
  return Math.min(delay, MAX_BACKOFF_DELAY_MS);
}

// ─── Default Implementations ──────────────────────────────────────────────────

/**
 * Default delay function using setTimeout.
 */
function defaultDelayFn(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Default no-op catalog refresh.
 */
async function defaultRefreshCatalog(): Promise<void> {
  // No-op: in production this would re-scan the selector catalog
}

// ─── Skeleton Generation ──────────────────────────────────────────────────────

/**
 * Generates a skeleton test file content with test.fixme() marker.
 *
 * Produces a valid .spec.ts string that serves as a placeholder when
 * live generation fails after all retries are exhausted.
 *
 * @param scenario - The test scenario to generate a skeleton for
 * @param reason - Human-readable reason why the skeleton was generated
 * @returns A valid TypeScript test file content string with test.fixme() marker
 *
 * @requirements 4.6
 */
export function generateSkeletonContent(scenario: TestScenario, reason: string): string {
  const escapedTitle = scenario.title.replace(/'/g, "\\'");
  const escapedReason = reason.replace(/'/g, "\\'");
  const escapedSteps = scenario.steps.replace(/'/g, "\\'").replace(/\n/g, '\\n');
  const escapedExpected = scenario.expectedResult.replace(/'/g, "\\'").replace(/\n/g, '\\n');

  return `import { test, expect } from '@playwright/test';

/**
 * Skeleton test generated as fallback after retry exhaustion.
 *
 * Scenario: ${scenario.title}
 * Reason: ${reason}
 *
 * Steps: ${scenario.steps}
 * Expected: ${scenario.expectedResult}
 */
test.fixme('${escapedTitle}', async ({ page }) => {
  // TODO: This test could not be generated automatically.
  // Reason: ${escapedReason}
  //
  // Steps to implement:
  // ${escapedSteps}
  //
  // Expected result:
  // ${escapedExpected}
});
`;
}

// ─── Retry Engine ─────────────────────────────────────────────────────────────

/**
 * Retries a scenario with exponential backoff according to failure classification.
 *
 * Behavior:
 * - Non-retryable failures (auth_required, structural_error) → immediate skip
 * - Retryable failures → retry with exponential backoff up to maxRetries
 * - On selector_not_found → refresh selector catalog before next attempt
 * - On retry success → include in generated list with attempt count
 * - On exhaustion + fallbackToSkeleton → generate skeleton with test.fixme()
 * - On exhaustion + no fallback → add to skipped list
 *
 * @param scenario - The test scenario to generate
 * @param options - Generation options controlling retry behavior
 * @param generator - Callback that attempts scenario generation
 * @param delayFn - Injectable delay function (defaults to setTimeout-based delay)
 * @param refreshCatalog - Injectable catalog refresh function (defaults to no-op)
 * @returns RetryResult with success status, generated/skipped details, and metrics
 *
 * @requirements 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7
 */
export async function retryScenario(
  scenario: TestScenario,
  options: GenerationOptions,
  generator: ScenarioGenerator,
  delayFn: (ms: number) => Promise<void> = defaultDelayFn,
  refreshCatalog: () => Promise<void> = defaultRefreshCatalog,
): Promise<RetryResult> {
  const maxAttempts = options.maxRetriesPerScenario + 1; // total attempts = initial + retries
  const delays: number[] = [];
  let lastClassification: FailureClassification = 'structural_error';
  let lastErrorMessage = '';

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    // Attempt generation
    const result = await generator(scenario);

    // Requirement 4.5: On success, include in generated list with attempt count
    if (result.success) {
      return {
        success: true,
        generated: {
          scenarioId: scenario.id,
          filePath: result.filePath ?? `tests/${scenario.id}.spec.ts`,
          verified: result.verified ?? false,
          verificationMethod: result.verificationMethod ?? 'none',
        },
        attempts: attempt,
        delays,
      };
    }

    // Generation failed — classify the failure
    const errorMessage = result.error?.message ?? 'Unknown generation failure';
    const classification = classifyFailure({
      message: errorMessage,
      code: result.error?.code,
      statusCode: result.error?.statusCode,
    });

    lastClassification = classification;
    lastErrorMessage = errorMessage;

    // Requirement 4.2: Non-retryable → skip immediately
    if (!isRetryable(classification)) {
      return {
        success: false,
        skipped: {
          scenarioId: scenario.id,
          reason: errorMessage,
          classification,
          canRetryLater: false,
        },
        attempts: attempt,
        delays,
      };
    }

    // If we've exhausted all attempts, break out of the loop
    if (attempt >= maxAttempts) {
      break;
    }

    // Requirement 4.4: Refresh selector catalog on selector_not_found
    if (classification === 'selector_not_found') {
      await refreshCatalog();
    }

    // Requirement 4.3: Apply exponential backoff before next attempt
    const delay = calculateBackoffDelay(options.retryDelayMs, attempt);
    delays.push(delay);
    await delayFn(delay);
  }

  // All retries exhausted — determine fallback strategy

  // Requirement 4.6: fallbackToSkeleton → generate skeleton with test.fixme()
  if (options.fallbackToSkeleton) {
    void generateSkeletonContent(scenario, lastErrorMessage);
    const skeletonPath = `tests/${scenario.id}.skeleton.spec.ts`;

    return {
      success: true,
      generated: {
        scenarioId: scenario.id,
        filePath: skeletonPath,
        verified: false,
        verificationMethod: 'skeleton',
      },
      attempts: maxAttempts,
      delays,
    };
  }

  // Requirement 4.7: No fallback → add to skipped list
  return {
    success: false,
    skipped: {
      scenarioId: scenario.id,
      reason: lastErrorMessage,
      classification: lastClassification,
      canRetryLater: isRetryable(lastClassification),
    },
    attempts: maxAttempts,
    delays,
  };
}
