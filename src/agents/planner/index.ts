/**
 * LEGACY — superseded oleh src/agents/integration (WorkflowController, commit 0d3baaa)
 * dan tools/mcp. Konsumen hanya test (property/unit). JANGAN diperluas; keputusan hapus
 * menunggu tanpa regresi.
 *
 * Planner Agent — Barrel Export
 *
 * Exports all planner modules: feedback (ambiguity detection),
 * clarification (request routing + timeout), and plan-validator.
 *
 * @module agents/planner
 */

// Feedback / Ambiguity Detection
export { detectAmbiguity, extractDefinedTerms, extractReferencedTerms } from './feedback';
export type { NormalizedRequirement } from './feedback';

// Clarification Request System
export { requestClarification, handleClarificationTimeout } from './clarification';
export type {
  ClarificationRequest,
  ClarificationQuestion,
  ClarificationResponse,
  ClarificationResult,
} from './clarification';

// Test Plan Validator
export {
  validateTestPlan,
  isObservableAssertion,
  scenarioCoversAcceptanceCriteria,
} from './plan-validator';
export type {
  TestPlan,
  TestPlanScenario,
  AcceptanceCriterion,
  ValidatorOptions,
} from './plan-validator';
