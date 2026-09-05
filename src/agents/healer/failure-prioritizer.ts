/**
 * Healer Failure Prioritization Engine
 *
 * Prioritizes test failures by fix likelihood and impact so the Healer
 * focuses on the most actionable failures first.
 *
 * Priority factors in precedence order:
 * 1. Known pattern match (match score >= 0.7, confidence >= 0.5)
 * 2. Shared fixture scope (file is imported by multiple tests)
 * 3. Root cause healability rank (locator > timing > data_state > network > auth > product_bug)
 * 4. Alphabetical file path (tie-breaker)
 *
 * Output: unique sequential priorities 1..N with no duplicates.
 * All input failures appear in output (no dropping).
 *
 * @module agents/healer/failure-prioritizer
 */

import type {
  TestFailure,
  PrioritizedFailure,
  HealPattern,
  RootCauseCategory,
} from '@/shared/types';
import type { HealPatternDatabase } from '@/shared/types/heal-patterns.schema';
import { lookupPattern } from './pattern-matcher';

// ─── Constants ────────────────────────────────────────────────────────────────

/** Default root cause when none is specified on the failure. */
const DEFAULT_ROOT_CAUSE: RootCauseCategory = 'product_bug';

/**
 * Root cause healability ranking: lower index = more healable = higher priority.
 */
const HEALABILITY_RANK: RootCauseCategory[] = [
  'locator',
  'timing',
  'data_state',
  'network',
  'auth',
  'product_bug',
];

/**
 * Keywords in file paths that indicate a shared fixture / POM file.
 * Files containing these keywords are likely imported by multiple tests.
 */
const SHARED_FIXTURE_INDICATORS = ['fixture', 'page', 'shared'];

// ─── Public Functions ─────────────────────────────────────────────────────────

/**
 * Prioritizes failures by fix likelihood and impact.
 *
 * Priority factors in precedence order:
 * 1. Known pattern match status (has match > no match)
 * 2. Shared fixture scope (shared > isolated)
 * 3. Root cause healability rank (locator > timing > data_state > network > auth > product_bug)
 * 4. Alphabetical file path (ascending, tie-breaker)
 *
 * Postconditions:
 * - Output length === input length (no failures dropped)
 * - Priority values are unique integers from 1 to N
 * - All input failures appear in the output
 *
 * @param failures - Array of test failures to prioritize
 * @param db - The heal pattern database for pattern lookup
 * @returns Array of prioritized failures with sequential priorities 1..N
 */
export function prioritizeFailures(
  failures: TestFailure[],
  db: HealPatternDatabase,
): PrioritizedFailure[] {
  if (failures.length === 0) {
    return [];
  }

  // Step 1: Compute sorting metadata for each failure
  const enriched = failures.map((failure) => {
    const knownPattern = lookupPatternForFailure(failure, db);
    const hasKnownPattern = knownPattern !== null;
    const isSharedFixture = detectSharedFixture(failure.filePath);
    const rootCause = failure.rootCause ?? DEFAULT_ROOT_CAUSE;
    const healabilityIndex = getHealabilityIndex(rootCause);

    return {
      failure,
      knownPattern,
      hasKnownPattern,
      isSharedFixture,
      healabilityIndex,
      rootCause,
    };
  });

  // Step 2: Sort by priority factors in precedence order
  enriched.sort((a, b) => {
    // Factor 1: Known pattern match (true sorts before false)
    if (a.hasKnownPattern !== b.hasKnownPattern) {
      return a.hasKnownPattern ? -1 : 1;
    }

    // Factor 2: Shared fixture scope (shared sorts before isolated)
    if (a.isSharedFixture !== b.isSharedFixture) {
      return a.isSharedFixture ? -1 : 1;
    }

    // Factor 3: Root cause healability rank (lower index = more healable = higher priority)
    if (a.healabilityIndex !== b.healabilityIndex) {
      return a.healabilityIndex - b.healabilityIndex;
    }

    // Factor 4: Alphabetical file path (ascending)
    return a.failure.filePath.localeCompare(b.failure.filePath);
  });

  // Step 3: Assign sequential priorities 1..N
  return enriched.map((item, index) => ({
    failure: item.failure,
    priority: index + 1,
    reason: buildPriorityReason(item.hasKnownPattern, item.isSharedFixture, item.rootCause),
    estimatedFixTime: estimateFixTime(item.knownPattern, item.rootCause),
    knownPattern: item.knownPattern,
  }));
}

// ─── Helper Functions ─────────────────────────────────────────────────────────

/**
 * Looks up a known pattern for a failure by extracting a signature
 * from the failure's error message and file context.
 */
function lookupPatternForFailure(
  failure: TestFailure,
  db: HealPatternDatabase,
): HealPattern | null {
  const rootCause = failure.rootCause ?? DEFAULT_ROOT_CAUSE;
  const signature = {
    errorType: rootCause,
    errorPattern: extractStableErrorPattern(failure.errorMessage),
    selectorType: extractSelectorType(failure.errorMessage),
    pageContext: extractPageContext(failure.filePath),
  };

  return lookupPattern(signature, db);
}

/**
 * Detects whether a file path indicates a shared fixture / POM file.
 *
 * Uses a simple heuristic: filename (lowercased) contains any of the
 * shared fixture indicator keywords.
 */
function detectSharedFixture(filePath: string): boolean {
  const lowerPath = filePath.toLowerCase();
  return SHARED_FIXTURE_INDICATORS.some((indicator) => lowerPath.includes(indicator));
}

/**
 * Gets the healability index for a root cause category.
 * Lower index = more healable = higher priority.
 */
function getHealabilityIndex(rootCause: RootCauseCategory): number {
  const index = HEALABILITY_RANK.indexOf(rootCause);
  // If unknown category, treat as least healable
  return index >= 0 ? index : HEALABILITY_RANK.length;
}

/**
 * Builds a human-readable reason string for the priority assignment.
 */
function buildPriorityReason(
  hasKnownPattern: boolean,
  isSharedFixture: boolean,
  rootCause: RootCauseCategory,
): string {
  const parts: string[] = [];

  if (hasKnownPattern) {
    parts.push('known pattern available');
  }

  if (isSharedFixture) {
    parts.push('shared fixture (high impact)');
  }

  parts.push(`root cause: ${rootCause}`);

  return parts.join('; ');
}

/**
 * Estimates the fix time based on known pattern and root cause category.
 */
function estimateFixTime(
  knownPattern: HealPattern | null,
  rootCause: RootCauseCategory,
): 'fast' | 'medium' | 'slow' {
  if (knownPattern) {
    return 'fast';
  }

  if (rootCause === 'locator' || rootCause === 'timing') {
    return 'medium';
  }

  return 'slow';
}

/**
 * Extracts a stable error pattern from the error message for signature matching.
 * Strips variable parts (numbers, UUIDs, timestamps) to create a stable key.
 */
function extractStableErrorPattern(errorMessage: string): string {
  return errorMessage
    .replace(/\d+/g, '\\d+') // Replace numbers with regex digit matcher
    .replace(/[a-f0-9-]{36}/gi, '[uuid]') // Replace UUIDs
    .slice(0, 200); // Cap length
}

/**
 * Extracts selector type from the error message if present.
 */
function extractSelectorType(errorMessage: string): string | undefined {
  const patterns: Array<[RegExp, string]> = [
    [/getByRole/i, 'getByRole'],
    [/getByTestId/i, 'getByTestId'],
    [/getByText/i, 'getByText'],
    [/getByLabel/i, 'getByLabel'],
    [/getByPlaceholder/i, 'getByPlaceholder'],
    [/locator\([^)]*\)\.visible\(\)/i, 'visible'],
    [/locator\(/i, 'css'],
    [/css=/i, 'css'],
    [/xpath=/i, 'xpath'],
  ];

  for (const [regex, selectorType] of patterns) {
    if (regex.test(errorMessage)) {
      return selectorType;
    }
  }

  return undefined;
}

/**
 * Extracts page context from a file path.
 * Uses the directory/filename structure as a proxy for page context.
 */
function extractPageContext(filePath: string): string | undefined {
  // Use the relative path directory as page context proxy
  const parts = filePath.replace(/\\/g, '/').split('/');
  // Return last two path segments before the filename as context
  if (parts.length >= 2) {
    return parts.slice(-2).join('/');
  }
  return undefined;
}
