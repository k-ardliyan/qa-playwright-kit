/**
 * LEGACY — superseded oleh src/agents/integration (WorkflowController, commit 0d3baaa)
 * dan tools/mcp. Konsumen hanya test (property/unit). JANGAN diperluas; keputusan hapus
 * menunggu tanpa regresi.
 *
 * Planner Clarification Request System
 *
 * Generates structured clarifying questions from AmbiguityReport entries.
 * Implements the decision logic for whether clarification is needed (confidence < 0.7)
 * and handles the timeout fallback scenario (300s elapsed without response).
 *
 * @module agents/planner/clarification
 */

import { AmbiguityReport, AmbiguityItem } from '@/shared/types';

// ─── Public Types ─────────────────────────────────────────────────────────────

/**
 * A structured request for clarification sent to the QA engineer.
 */
export interface ClarificationRequest {
  /** Path to the requirement being analyzed */
  requirementPath: string;
  /** List of structured clarifying questions */
  questions: ClarificationQuestion[];
  /** Timeout in milliseconds before auto-proceeding (300000 = 300 seconds) */
  timeout: number;
  /** The confidence score that triggered clarification */
  confidence: number;
}

/**
 * A single clarifying question generated from an ambiguity item.
 */
export interface ClarificationQuestion {
  /** Unique identifier for this question */
  id: string;
  /** Section of the requirement where ambiguity was found */
  section: string;
  /** The original ambiguous text */
  originalText: string;
  /** The clarifying question to ask */
  question: string;
  /** Optional suggested answer based on the ambiguity suggestion */
  suggestedAnswer?: string;
}

/**
 * Response to a clarification request (from the QA engineer or timeout).
 */
export interface ClarificationResponse {
  /** Answers provided for each question */
  answers: { questionId: string; answer: string }[];
  /** Whether the response is due to timeout (no human answer received) */
  timedOut: boolean;
}

/**
 * Result of the clarification decision process.
 */
export interface ClarificationResult {
  /** Whether planning should proceed (true = go ahead, false = wait) */
  proceeded: boolean;
  /** Whether clarification was determined to be needed */
  clarificationNeeded: boolean;
  /** The generated clarification request (present when clarificationNeeded is true) */
  request?: ClarificationRequest;
  /** Warnings from unresolved ambiguities (present on timeout fallback) */
  warnings?: string[];
}

// ─── Constants ────────────────────────────────────────────────────────────────

/** Confidence threshold below which clarification is requested */
const CONFIDENCE_THRESHOLD = 0.7;

/** Timeout duration in milliseconds (300 seconds) */
const CLARIFICATION_TIMEOUT_MS = 300_000;

// ─── Main Functions ───────────────────────────────────────────────────────────

/**
 * Determines whether clarification is needed based on the ambiguity report,
 * and generates structured clarifying questions if so.
 *
 * - If confidence >= 0.7: returns { proceeded: true, clarificationNeeded: false }
 * - If confidence < 0.7: returns { proceeded: false, clarificationNeeded: true, request: ... }
 *
 * @param report - The AmbiguityReport produced by detectAmbiguity()
 * @returns A ClarificationResult indicating the decision and any request
 */
export function requestClarification(report: AmbiguityReport): ClarificationResult {
  // Requirement 1.5: confidence >= 0.7 → proceed without clarification
  if (report.confidence >= CONFIDENCE_THRESHOLD) {
    return {
      proceeded: true,
      clarificationNeeded: false,
    };
  }

  // Requirement 1.4: confidence < 0.7 → generate ClarificationRequest and halt
  const questions = generateQuestionsFromAmbiguities(report.ambiguities, report.requirementPath);

  const request: ClarificationRequest = {
    requirementPath: report.requirementPath,
    questions,
    timeout: CLARIFICATION_TIMEOUT_MS,
    confidence: report.confidence,
  };

  return {
    proceeded: false,
    clarificationNeeded: true,
    request,
  };
}

/**
 * Handles the timeout scenario: proceeds with warnings from unresolved ambiguities.
 * Called when the 300-second timeout elapses without a response.
 *
 * Requirement 1.7: proceed with original requirement and include unresolved
 * ambiguities as warnings in the output.
 *
 * @param report - The AmbiguityReport that triggered clarification
 * @returns A ClarificationResult with proceeded=true and warnings populated
 */
export function handleClarificationTimeout(report: AmbiguityReport): ClarificationResult {
  const warnings = report.ambiguities.map(
    (item) => `[Unresolved ambiguity] ${item.section}: "${item.text}" — ${item.suggestion}`,
  );

  return {
    proceeded: true,
    clarificationNeeded: true,
    warnings,
  };
}

// ─── Helper Functions ─────────────────────────────────────────────────────────

/**
 * Generates structured clarifying questions from ambiguity items.
 * Each ambiguity item maps to exactly one question.
 *
 * @param ambiguities - List of detected ambiguity items
 * @param requirementPath - Path to the requirement file
 * @returns Array of ClarificationQuestion objects
 */
function generateQuestionsFromAmbiguities(
  ambiguities: AmbiguityItem[],
  requirementPath: string,
): ClarificationQuestion[] {
  return ambiguities.map((item, index) => {
    const question = buildQuestionText(item);
    const baseId = requirementPath.replace(/[^a-zA-Z0-9]/g, '-');

    return {
      id: `${baseId}-q${index + 1}`,
      section: item.section,
      originalText: item.text,
      question,
      suggestedAnswer: item.suggestion,
    };
  });
}

/**
 * Builds a human-readable clarifying question from an ambiguity item
 * based on its reason classification.
 *
 * @param item - The ambiguity item to create a question for
 * @returns A question string appropriate for the ambiguity type
 */
function buildQuestionText(item: AmbiguityItem): string {
  switch (item.reason) {
    case 'vague_assertion':
      return `The text "${item.text}" is vague. What specific, measurable behavior should be verified?`;
    case 'missing_precondition':
      return `Scenario "${item.text}" has no precondition. What state or setup is required before this scenario runs?`;
    case 'undefined_term':
      return `The term "${item.text}" is referenced but not defined. What does it mean in this context?`;
    case 'conflicting_steps':
      return `The section "${item.text}" contains conflicting instructions. Which behavior is intended?`;
  }
}
