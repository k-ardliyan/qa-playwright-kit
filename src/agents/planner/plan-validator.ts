/**
 * LEGACY — superseded oleh src/agents/integration (WorkflowController, commit 0d3baaa)
 * dan tools/mcp. Konsumen hanya test (property/unit). JANGAN diperluas; keputusan hapus
 * menunggu tanpa regresi.
 *
 * Test Plan Validator
 *
 * Validates generated test plans for structural correctness and requirement coverage.
 * Checks for executable steps, observable assertions, fixture references,
 * coverage gaps, and duplicate scenarios.
 *
 * @module agents/planner/plan-validator
 */

import { PlanValidationResult, PlanValidationIssue } from '@/shared/types';

// ─── Public Types ─────────────────────────────────────────────────────────────

/**
 * A structured test plan containing one or more scenarios.
 */
export interface TestPlan {
  scenarios: TestPlanScenario[];
}

/**
 * A single scenario within a test plan.
 */
export interface TestPlanScenario {
  /** Unique identifier for the scenario */
  id: string;
  /** Human-readable scenario title */
  title: string;
  /** Multi-line or single string of steps (Given/When/Then) */
  steps: string;
  /** Expected outcome of the scenario */
  expectedResult: string;
  /** Optional list of referenced fixture names */
  fixtures?: string[];
  /** Optional: tagged as @manual (not automatable) */
  manual?: boolean;
  /** Optional: reason why scenario is @manual (extracted from Hasil section) */
  manualReason?: string;
}

/**
 * An acceptance criterion from the source requirement.
 */
export interface AcceptanceCriterion {
  /** Unique identifier for the criterion */
  id: string;
  /** Full text of the acceptance criterion */
  text: string;
}

/**
 * Options for configuring the validator behavior.
 */
export interface ValidatorOptions {
  /** List of registered fixture names; if provided, enables Rule 3 */
  registeredFixtures?: string[];
  /** Acceptance criteria to check coverage against */
  acceptanceCriteria?: AcceptanceCriterion[];
}

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * Keywords indicating an observable/verifiable assertion.
 * Presence of any of these in the expected result makes it "observable".
 */
const OBSERVABLE_KEYWORDS: RegExp[] = [
  // Visual state / display
  /\b(visible|displayed|shows?|shown|appears?|hidden|invisible)\b/i,
  // Content
  /\b(contains?|includes?|text|label|title|placeholder)\b/i,
  // Navigation
  /\b(navigates?|redirects?|url|route|path)\b/i,
  // UI state
  /\b(enabled|disabled|selected|checked|unchecked|active|inactive|focused)\b/i,
  // UI elements
  /\b(button|field|input|page|dialog|modal|message|error|notification|toast|alert|form|table|list|menu|dropdown|tab|link|icon|image|banner|header|footer)\b/i,
  // Measurements / specific values
  /\d+/,
  /\b(count|total|size|length|width|height|percentage|px|em|rem)\b/i,
];

/**
 * Patterns indicating a vague/non-observable expected result.
 */
const VAGUE_PATTERNS: RegExp[] = [
  /^works?$/i,
  /\b(works?\s*(properly|correctly|well|fine|as expected))\b/i,
  /^(is\s+)?correct$/i,
  /\b(functions?\s*(properly|correctly))\b/i,
  /^(it\s+)?(is\s+)?(ok|okay|good|fine)$/i,
  /\b(behaves?\s*(as expected|correctly|properly))\b/i,
  /^(should\s+)?(be\s+)?(successful|handled)$/i,
];

// ─── Main Function ────────────────────────────────────────────────────────────

/**
 * Validates a test plan for structural correctness and requirement coverage.
 *
 * Rules applied in order:
 * 1. Rule 6: Empty plan (zero scenarios) → error "empty_plan"
 * 2. Rule 1: Empty/whitespace steps → error "executable_steps"
 * 3. Rule 2: Non-observable expected result → warning "observable_result"
 * 4. Rule 3: Unregistered fixture reference → warning "fixture_exists"
 * 5. Rule 4: Coverage gap detection against acceptance criteria
 * 6. Rule 5: Duplicate scenario detection → warning "no_duplicates"
 *
 * Status determination:
 * - Any error → "invalid"
 * - Any warning (but no errors) → "warnings"
 * - No issues AND no coverage gaps → "valid"
 * - Has coverage gaps but no issues → "warnings"
 *
 * @param plan - The test plan to validate
 * @param options - Optional configuration for fixture checking and coverage analysis
 * @returns Validation result with status, issues, and coverage gaps
 */
export function validateTestPlan(plan: TestPlan, options?: ValidatorOptions): PlanValidationResult {
  const issues: PlanValidationIssue[] = [];
  const coverageGaps: string[] = [];

  // Rule 6: Empty plan check
  if (plan.scenarios.length === 0) {
    issues.push({
      scenarioId: '',
      severity: 'error',
      rule: 'empty_plan',
      message: 'Test plan contains no scenarios',
      autoFixable: false,
    });

    return {
      status: 'invalid',
      scenarioCount: 0,
      issues,
      coverageGaps,
    };
  }

  // Per-scenario validation
  for (const scenario of plan.scenarios) {
    // Rule 1: Empty/whitespace steps → error "executable_steps"
    if (!scenario.steps || scenario.steps.trim().length === 0) {
      issues.push({
        scenarioId: scenario.id,
        severity: 'error',
        rule: 'executable_steps',
        message: `Scenario "${scenario.title}" has no executable steps`,
        autoFixable: false,
      });
    }

    // Rule 2: Non-observable expected result → warning "observable_result"
    if (!isObservableAssertion(scenario.expectedResult)) {
      issues.push({
        scenarioId: scenario.id,
        severity: 'warning',
        rule: 'observable_result',
        message: `Expected result "${scenario.expectedResult}" is not clearly observable`,
        autoFixable: false,
      });
    }

    // Rule 3: Unregistered fixture reference → warning "fixture_exists"
    if (options?.registeredFixtures && scenario.fixtures) {
      for (const fixture of scenario.fixtures) {
        if (!options.registeredFixtures.includes(fixture)) {
          issues.push({
            scenarioId: scenario.id,
            severity: 'warning',
            rule: 'fixture_exists',
            message: `Referenced fixture "${fixture}" is not registered in the project fixture chain`,
            autoFixable: true,
          });
        }
      }
    }
  }

  // Rule 4: Coverage gap detection
  if (options?.acceptanceCriteria) {
    for (const criterion of options.acceptanceCriteria) {
      const covered = plan.scenarios.some((sc) => scenarioCoversAcceptanceCriteria(sc, criterion));
      if (!covered) {
        coverageGaps.push(criterion.text);
      }
    }
  }

  // Rule 5: Duplicate scenario detection → warning "no_duplicates"
  const seen = new Map<string, string>(); // key → first scenario id
  for (const scenario of plan.scenarios) {
    const key = normalizeForDuplicateCheck(scenario.steps, scenario.expectedResult);
    if (seen.has(key)) {
      issues.push({
        scenarioId: scenario.id,
        severity: 'warning',
        rule: 'no_duplicates',
        message: `Scenario "${scenario.title}" is a duplicate of scenario "${seen.get(key)}"`,
        autoFixable: true,
      });
    } else {
      seen.set(key, scenario.id);
    }
  }

  // Rule 7: @manual scenario without reason → warning "manual_reason"
  // Help QA non-coder understand: every @manual scenario MUST explain why.
  // See docs/MANUAL-SCENARIOS.md for guidance.
  for (const scenario of plan.scenarios) {
    if (scenario.manual && (!scenario.manualReason || scenario.manualReason.trim().length === 0)) {
      issues.push({
        scenarioId: scenario.id,
        severity: 'warning',
        rule: 'manual_reason',
        message: `Scenario "${scenario.title}" ditandai (@manual) tanpa penjelasan di bagian **Hasil:**`,
        autoFixable: false,
      });
    }
  }

  // Determine status
  const hasErrors = issues.some((i) => i.severity === 'error');
  const hasWarnings = issues.length > 0 || coverageGaps.length > 0;

  let status: 'valid' | 'warnings' | 'invalid';
  if (hasErrors) {
    status = 'invalid';
  } else if (hasWarnings) {
    status = 'warnings';
  } else {
    status = 'valid';
  }

  return {
    status,
    scenarioCount: plan.scenarios.length,
    issues,
    coverageGaps,
  };
}

// ─── Helper Functions ─────────────────────────────────────────────────────────

/**
 * Determines if an expected result text contains observable/verifiable assertions.
 *
 * Returns true if the text references:
 * - A visible element or display state
 * - A measurable value (numbers, percentages)
 * - A navigation outcome
 * - A UI element state (enabled, disabled, etc.)
 * - A specific UI component (button, dialog, etc.)
 *
 * Returns false if the text is vague (e.g., "works", "is correct", "functions properly").
 *
 * @param expectedResult - The expected result text to analyze
 * @returns true if the assertion is observable, false otherwise
 */
export function isObservableAssertion(expectedResult: string): boolean {
  if (!expectedResult || expectedResult.trim().length === 0) {
    return false;
  }

  const trimmed = expectedResult.trim();

  // Check if it matches known vague patterns first
  for (const vague of VAGUE_PATTERNS) {
    if (vague.test(trimmed)) {
      return false;
    }
  }

  // Check if it contains any observable keyword
  for (const keyword of OBSERVABLE_KEYWORDS) {
    if (keyword.test(trimmed)) {
      return true;
    }
  }

  return false;
}

/**
 * Determines if a scenario covers a given acceptance criterion using word overlap heuristic.
 *
 * Considers a criterion "covered" if more than 30% of its significant words
 * appear in the scenario's steps + expected result.
 *
 * @param scenario - The test plan scenario
 * @param criterion - The acceptance criterion to check coverage for
 * @returns true if the scenario covers the criterion
 */
export function scenarioCoversAcceptanceCriteria(
  scenario: TestPlanScenario,
  criterion: AcceptanceCriterion,
): boolean {
  const criterionWords = extractSignificantWords(criterion.text);
  if (criterionWords.size === 0) {
    return true; // Empty criterion is considered covered
  }

  const scenarioText = `${scenario.steps} ${scenario.expectedResult} ${scenario.title}`;
  const scenarioWords = extractSignificantWords(scenarioText);

  let overlapCount = 0;
  for (const word of criterionWords) {
    if (scenarioWords.has(word)) {
      overlapCount++;
    }
  }

  const overlapRatio = overlapCount / criterionWords.size;
  return overlapRatio > 0.3;
}

/**
 * Extracts significant (non-stop) words from text for comparison.
 *
 * @param text - Input text
 * @returns A Set of lowercased significant words
 */
function extractSignificantWords(text: string): Set<string> {
  const STOP_WORDS = new Set([
    'the',
    'a',
    'an',
    'is',
    'are',
    'was',
    'were',
    'be',
    'been',
    'being',
    'have',
    'has',
    'had',
    'do',
    'does',
    'did',
    'will',
    'would',
    'could',
    'should',
    'may',
    'might',
    'shall',
    'can',
    'to',
    'of',
    'in',
    'for',
    'on',
    'with',
    'at',
    'by',
    'from',
    'as',
    'into',
    'through',
    'during',
    'before',
    'after',
    'above',
    'below',
    'between',
    'and',
    'or',
    'but',
    'if',
    'then',
    'else',
    'when',
    'that',
    'this',
    'these',
    'those',
    'it',
    'its',
    'not',
    'no',
    'nor',
    'so',
    'than',
    'too',
    'very',
    'just',
    'also',
    'only',
    'each',
    'every',
    'all',
    'both',
    'few',
    'more',
    'most',
    'other',
    'some',
    'such',
    'any',
    'own',
    'same',
  ]);

  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/);
  const significant = new Set<string>();

  for (const word of words) {
    if (word.length > 2 && !STOP_WORDS.has(word)) {
      significant.add(word);
    }
  }

  return significant;
}

/**
 * Normalizes scenario steps and expected result for duplicate detection.
 *
 * @param steps - Scenario steps text
 * @param expectedResult - Expected result text
 * @returns A normalized string key for comparison
 */
function normalizeForDuplicateCheck(steps: string, expectedResult: string): string {
  const normalizedSteps = (steps || '').toLowerCase().replace(/\s+/g, ' ').trim();
  const normalizedResult = (expectedResult || '').toLowerCase().replace(/\s+/g, ' ').trim();
  return `${normalizedSteps}|${normalizedResult}`;
}
