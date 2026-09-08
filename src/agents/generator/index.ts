/**
 * LEGACY — superseded oleh src/agents/integration (WorkflowController, commit 0d3baaa)
 * dan tools/mcp. Konsumen hanya test (property/unit). JANGAN diperluas; keputusan hapus
 * menunggu tanpa regresi.
 *
 * Generator Agent — Barrel Export
 *
 * Re-exports all generator sub-modules for unified import access:
 * - failure-classifier: Classifies generation errors into retryable/non-retryable categories
 * - partial-engine: Processes scenarios independently with per-scenario success/failure tracking
 * - retry-engine: Exponential backoff retry with skeleton fallback for exhausted retries
 *
 * @module agents/generator
 */

export { classifyFailure, isRetryable } from './failure-classifier';
export type { GenerationError } from './failure-classifier';

export { generatePartial } from './partial-engine';
export type {
  TestPlan,
  TestScenario,
  ScenarioGenerationResult,
  ScenarioGenerator,
} from './partial-engine';

export { retryScenario, calculateBackoffDelay, generateSkeletonContent } from './retry-engine';
export type { RetryResult } from './retry-engine';

export { LiveVerificationGate } from './live-verification-gate';
export type { GateInput } from './live-verification-gate';
