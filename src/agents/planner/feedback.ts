/**
 * LEGACY — superseded oleh src/agents/integration (WorkflowController, commit 0d3baaa)
 * dan tools/mcp. Konsumen hanya test (property/unit). JANGAN diperluas; keputusan hapus
 * menunggu tanpa regresi.
 *
 * Planner Feedback Module — Ambiguity Detection
 *
 * Scans normalized requirements for vague assertions, missing preconditions,
 * and undefined terms. Returns a confidence score indicating requirement clarity.
 *
 * @module agents/planner/feedback
 */

import { AmbiguityReport, AmbiguityItem } from '@/shared/types';

// ─── Public Types ─────────────────────────────────────────────────────────────

/**
 * Represents a normalized requirement suitable for ambiguity analysis.
 */
export interface NormalizedRequirement {
  /** File path of the requirement */
  path: string;
  /** Acceptance criteria extracted from the requirement */
  acceptanceCriteria: { id: string; text: string }[];
  /** Scenarios with steps and optional precondition */
  scenarios: { id: string; title: string; steps: string[]; precondition?: string }[];
  /** Optional glossary mapping terms to definitions */
  glossary?: Map<string, string> | Record<string, string>;
}

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * Regex patterns that indicate vague/untestable assertions in requirement text.
 */
const VAGUE_PATTERNS: RegExp[] = [
  /should\s+work\s+(properly|correctly|well)/i,
  /appropriate\s+(error|message|response)/i,
  /the\s+system\s+handles/i,
  /etc\.?$/i,
  /and\s+so\s+on/i,
];

// ─── Main Function ────────────────────────────────────────────────────────────

/**
 * Detects ambiguities in a normalized requirement.
 *
 * Performs three checks:
 * 1. Vague assertion patterns in acceptance criteria
 * 2. Missing preconditions in scenarios (no Given step)
 * 3. Undefined terms referenced but not in glossary
 *
 * @param requirement - The normalized requirement to analyze
 * @returns An AmbiguityReport with detected issues and confidence score
 */
export function detectAmbiguity(requirement: NormalizedRequirement): AmbiguityReport {
  const ambiguities: AmbiguityItem[] = [];

  // Step 1: Check acceptance criteria for vague assertions
  for (const criteria of requirement.acceptanceCriteria) {
    for (const pattern of VAGUE_PATTERNS) {
      if (pattern.test(criteria.text)) {
        ambiguities.push({
          section: 'acceptance_criteria',
          text: criteria.text,
          reason: 'vague_assertion',
          suggestion: `Specify exact expected behavior: what state/value/UI element should be observable?`,
        });
        break; // Only flag once per criterion even if multiple patterns match
      }
    }
  }

  // Step 2: Check scenarios for missing preconditions (no Given step)
  for (const scenario of requirement.scenarios) {
    const hasGiven = scenario.steps.some((s) => s.toLowerCase().startsWith('given'));
    if (!hasGiven && !scenario.precondition) {
      ambiguities.push({
        section: `scenario:${scenario.id}`,
        text: scenario.title,
        reason: 'missing_precondition',
        suggestion: `Add a Given/precondition: what state must exist before this scenario runs?`,
      });
    }
  }

  // Step 3: Check for undefined terms (referenced but not defined in glossary)
  const definedTerms = extractDefinedTerms(requirement);
  const referencedTerms = extractReferencedTerms(requirement);
  for (const term of referencedTerms) {
    if (!definedTerms.has(term)) {
      ambiguities.push({
        section: 'terminology',
        text: term,
        reason: 'undefined_term',
        suggestion: `Define "${term}" — what does it mean in this context?`,
      });
    }
  }

  // Step 4: Calculate confidence score
  // Analyzable sections = acceptance criteria + scenarios
  const analyzableSections = requirement.acceptanceCriteria.length + requirement.scenarios.length;
  const confidence =
    analyzableSections > 0
      ? Math.max(0, Math.min(1, 1 - ambiguities.length / analyzableSections))
      : 0;

  return {
    requirementPath: requirement.path,
    ambiguities,
    confidence,
    suggestedInterpretations: ambiguities.map((a) => a.suggestion),
  };
}

// ─── Helper Functions ─────────────────────────────────────────────────────────

/**
 * Extracts terms defined in the requirement's glossary.
 *
 * @param requirement - The normalized requirement
 * @returns A Set of lowercased defined terms
 */
export function extractDefinedTerms(requirement: NormalizedRequirement): Set<string> {
  const defined = new Set<string>();

  if (!requirement.glossary) {
    return defined;
  }

  // Support both Map and plain Record
  if (requirement.glossary instanceof Map) {
    for (const key of requirement.glossary.keys()) {
      defined.add(key.toLowerCase());
    }
  } else {
    for (const key of Object.keys(requirement.glossary)) {
      defined.add(key.toLowerCase());
    }
  }

  return defined;
}

/**
 * Extracts referenced technical terms from acceptance criteria and scenario text.
 *
 * Identifies:
 * - Terms in backticks (e.g., `UserSession`)
 * - Capitalized multi-word terms (e.g., "Test Plan", "Heal Pattern")
 *
 * @param requirement - The normalized requirement
 * @returns A Set of lowercased referenced terms
 */
export function extractReferencedTerms(requirement: NormalizedRequirement): Set<string> {
  const referenced = new Set<string>();
  const allText: string[] = [];

  // Collect all text from acceptance criteria
  for (const criteria of requirement.acceptanceCriteria) {
    allText.push(criteria.text);
  }

  // Collect all text from scenarios (title + steps)
  for (const scenario of requirement.scenarios) {
    allText.push(scenario.title);
    for (const step of scenario.steps) {
      allText.push(step);
    }
  }

  const combined = allText.join(' ');

  // Pattern 1: Backtick-enclosed terms (technical terms)
  const backtickPattern = /`([^`]+)`/g;
  let match: RegExpExecArray | null;
  while ((match = backtickPattern.exec(combined)) !== null) {
    const term = match[1].trim();
    if (term.length > 0) {
      referenced.add(term.toLowerCase());
    }
  }

  // Pattern 2: Capitalized multi-word terms (PascalCase compounds or Title Case phrases)
  // Matches sequences like "Test Plan", "Heal Pattern", "Browser Matrix"
  const capitalizedPattern = /\b([A-Z][a-z]+(?:[_\s][A-Z][a-z]+)+)\b/g;
  while ((match = capitalizedPattern.exec(combined)) !== null) {
    const term = match[1].trim();
    // Exclude common English phrases that aren't technical terms
    if (term.length > 0 && !isCommonPhrase(term)) {
      referenced.add(term.toLowerCase());
    }
  }

  // Pattern 3: PascalCase single words (e.g., "UserSession", "TestPlan")
  const pascalCasePattern = /\b([A-Z][a-z]+[A-Z][A-Za-z]*)\b/g;
  while ((match = pascalCasePattern.exec(combined)) !== null) {
    const term = match[1].trim();
    if (term.length > 0) {
      referenced.add(term.toLowerCase());
    }
  }

  return referenced;
}

/**
 * Checks if a capitalized phrase is a common English phrase (not a technical term).
 */
function isCommonPhrase(phrase: string): boolean {
  const common = new Set(['the system', 'the user', 'the application', 'the browser', 'the page']);
  return common.has(phrase.toLowerCase());
}
