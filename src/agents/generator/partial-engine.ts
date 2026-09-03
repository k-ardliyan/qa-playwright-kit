/**
 * Partial Generation Engine for Generator Agent.
 *
 * Processes test plan scenarios sequentially and independently, tracking
 * success/failure per scenario. A failure in one scenario does not prevent
 * processing of subsequent scenarios.
 *
 * Postconditions:
 * - generated.length + skipped.length === plan.scenarios.length
 * - status === 'complete' iff skipped.length === 0
 * - status === 'failed' iff generated.length === 0
 * - status === 'partial' otherwise
 *
 * @module agents/generator/partial-engine
 * @requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6
 */

import type {
  PartialGenerationResult,
  GeneratedScenario,
  SkippedScenario,
  RetriedScenario,
  GenerationOptions,
  GenerationMetrics,
  FailureClassification,
} from '../../shared/types';
import { classifyFailure, isRetryable } from './failure-classifier';

// ─── Domain Types ─────────────────────────────────────────────────────────────

/**
 * A test plan containing scenarios to generate.
 */
export interface TestPlan {
  scenarios: TestScenario[];
}

/**
 * An individual test scenario within a plan.
 */
export interface TestScenario {
  /** Unique identifier for the scenario */
  id: string;
  /** Human-readable title */
  title: string;
  /** Executable steps (Gherkin-style or plain text) */
  steps: string;
  /** Expected result after executing the steps */
  expectedResult: string;
}

/**
 * Result of generating a single scenario.
 * Returned by the injected ScenarioGenerator callback.
 */
export interface ScenarioGenerationResult {
  /** Whether generation succeeded */
  success: boolean;
  /** Path to the generated test file (set on success) */
  filePath?: string;
  /** Whether live verification passed */
  verified?: boolean;
  /** Method used for verification */
  verificationMethod?: 'cli' | 'mcp' | 'skeleton' | 'none';
  /** Error details (set on failure) */
  error?: { message: string; code?: string; statusCode?: number };
}

/**
 * Callback type for generating a single scenario.
 * Injected for testability — allows mocking generation behavior.
 */
export type ScenarioGenerator = (scenario: TestScenario) => Promise<ScenarioGenerationResult>;

// ─── Per-Scenario State Machine ───────────────────────────────────────────────

type ScenarioStatus = 'pending' | 'in_progress' | 'generated' | 'skipped' | 'failed';

interface ScenarioTracker {
  scenarioId: string;
  status: ScenarioStatus;
}

// ─── Default Generator ────────────────────────────────────────────────────────

/**
 * Default generator that always succeeds.
 * Used when no generator callback is provided (useful for unit testing).
 */
const defaultGenerator: ScenarioGenerator = async (scenario: TestScenario) => ({
  success: true,
  filePath: `tests/${scenario.id}.spec.ts`,
  verified: true,
  verificationMethod: 'none' as const,
});

// ─── Main Function ────────────────────────────────────────────────────────────

/**
 * Generates tests scenario-by-scenario with independent success/failure tracking.
 *
 * Processes each scenario in a test plan sequentially. A failure in one scenario
 * does not block processing of subsequent scenarios (Requirement 3.1).
 *
 * @param plan - The test plan containing scenarios to generate
 * @param options - Generation options controlling retry and fallback behavior
 * @param generator - Optional injected generator callback for testability
 * @returns PartialGenerationResult with generated/skipped lists and metrics
 *
 * @requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6
 */
export async function generatePartial(
  plan: TestPlan,
  options: GenerationOptions,
  generator?: ScenarioGenerator,
): Promise<PartialGenerationResult> {
  const gen = generator ?? defaultGenerator;

  // Requirement 3.6: Empty plan → status "complete" with empty lists
  if (plan.scenarios.length === 0) {
    return {
      status: 'complete',
      generated: [],
      skipped: [],
      retried: [],
      metrics: buildMetrics(0, 0, 0, 0, 0, 0),
    };
  }

  const generated: GeneratedScenario[] = [];
  const skipped: SkippedScenario[] = [];
  const retried: RetriedScenario[] = [];
  const startTime = Date.now();

  // Initialize per-scenario state tracking
  const trackers: ScenarioTracker[] = plan.scenarios.map((sc) => ({
    scenarioId: sc.id,
    status: 'pending' as ScenarioStatus,
  }));

  // Process scenarios sequentially and independently (Requirement 3.1)
  for (let i = 0; i < plan.scenarios.length; i++) {
    const scenario = plan.scenarios[i];
    const tracker = trackers[i];

    // Transition: pending → in_progress
    tracker.status = 'in_progress';

    try {
      const result = await gen(scenario);

      if (result.success) {
        // Transition: in_progress → generated
        tracker.status = 'generated';
        generated.push({
          scenarioId: scenario.id,
          filePath: result.filePath ?? `tests/${scenario.id}.spec.ts`,
          verified: result.verified ?? false,
          verificationMethod: result.verificationMethod ?? 'none',
        });
      } else {
        // Generation reported failure — classify and skip
        const errorMessage = result.error?.message ?? 'Unknown generation failure';
        const classification = classifyFailure({
          message: errorMessage,
          code: result.error?.code,
          statusCode: result.error?.statusCode,
        });

        // Transition: in_progress → skipped
        tracker.status = 'skipped';
        skipped.push({
          scenarioId: scenario.id,
          reason: errorMessage,
          classification,
          canRetryLater: isRetryable(classification),
        });
      }
    } catch (unexpectedError: unknown) {
      // Unexpected/catastrophic error — classify as structural_error and skip
      const errorMessage =
        unexpectedError instanceof Error ? unexpectedError.message : String(unexpectedError);

      // Transition: in_progress → skipped
      tracker.status = 'skipped';
      skipped.push({
        scenarioId: scenario.id,
        reason: `Unexpected: ${errorMessage}`,
        classification: 'structural_error' as FailureClassification,
        canRetryLater: false,
      });
    }
  }

  const totalDuration = Date.now() - startTime;

  // Determine overall status (Requirements 3.2, 3.3, 3.4)
  const status = determineStatus(generated.length, skipped.length);

  // Invariant check: generated + skipped = total (Requirement 3.5)
  const total = plan.scenarios.length;
  if (generated.length + skipped.length !== total) {
    // This should never happen, but provides defensive safety
    throw new Error(
      `Invariant violation: generated(${generated.length}) + skipped(${skipped.length}) !== total(${total})`,
    );
  }

  return {
    status,
    generated,
    skipped,
    retried,
    metrics: buildMetrics(
      total,
      generated.length,
      skipped.length,
      retried.length,
      totalDuration,
      generated.filter((g) => g.verified).length,
    ),
  };
}

// ─── Internal Helpers ─────────────────────────────────────────────────────────

/**
 * Determines the overall generation status based on generated/skipped counts.
 *
 * - Requirement 3.2: All generated → 'complete'
 * - Requirement 3.3: Some generated + some skipped → 'partial'
 * - Requirement 3.4: None generated → 'failed'
 */
function determineStatus(
  generatedCount: number,
  skippedCount: number,
): 'complete' | 'partial' | 'failed' {
  if (skippedCount === 0) {
    return 'complete';
  }
  if (generatedCount === 0) {
    return 'failed';
  }
  return 'partial';
}

/**
 * Builds the GenerationMetrics object from raw counts and timing.
 */
function buildMetrics(
  totalScenarios: number,
  generatedCount: number,
  skippedCount: number,
  retriedCount: number,
  totalDurationMs: number,
  verifiedCount: number,
): GenerationMetrics {
  return {
    totalScenarios,
    generatedCount,
    skippedCount,
    retriedCount,
    averageGenerationTimeMs: totalScenarios > 0 ? totalDurationMs / totalScenarios : 0,
    verificationSuccessRate: generatedCount > 0 ? verifiedCount / generatedCount : 0,
  };
}
