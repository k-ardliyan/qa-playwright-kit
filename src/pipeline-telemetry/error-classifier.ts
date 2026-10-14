/**
 * Error Classification Module
 *
 * Classifies pipeline errors into a standard taxonomy for routing
 * to appropriate handlers (retry, abort, heal, skip).
 *
 * Categories:
 * - infrastructure: Critical severity, not retryable, abort
 * - configuration: High severity, not retryable, skip
 * - application: High severity, retryable, retry
 * - test_logic: Medium severity, not retryable, heal
 * - transient: Low severity, retryable, retry
 *
 * Fallback: unmatched errors → transient, low severity, retryable
 */

import type { ClassifiedError, ErrorCategory, ErrorSeverity } from '../shared/types';

export interface ErrorContext {
  stage?: 'planner' | 'generator' | 'executor' | 'healer' | 'reporter';
  operation?: string;
  filePath?: string;
}

// ─── Classification Pattern Definitions ───────────────────────────────────────

interface CategoryRule {
  category: ErrorCategory;
  severity: ErrorSeverity;
  retryable: boolean;
  suggestedAction: string;
  patterns: RegExp[];
}

const INFRASTRUCTURE_PATTERNS: RegExp[] = [
  /ENOMEM/i,
  /out of memory/i,
  /ENOSPC/i,
  /no space left/i,
  /browser.*crash/i,
  /browser has been closed/i,
  /docker/i,
  /container/i,
  /EACCES/i,
  /permission denied/i,
  /network interface/i,
];

const CONFIGURATION_PATTERNS: RegExp[] = [
  /ENOENT/i,
  /missing.*env/i,
  /undefined.*variable/i,
  /Cannot find module/i,
  /invalid.*config/i,
  /configuration.*error/i,
  /INVALID_URL/i,
];

const APPLICATION_PATTERNS: RegExp[] = [
  /\b5\d{2}\b/,
  /Internal Server Error/i,
  /application.*error/i,
  /server.*error/i,
  /unhandled.*rejection/i,
];

const TEST_LOGIC_PATTERNS: RegExp[] = [
  /expect.*received/i,
  /assertion.*failed/i,
  /locator.*not found/i,
  /element.*not found/i,
  /test.*failed/i,
  /step.*failed/i,
  /AssertionError/i,
];

const TRANSIENT_PATTERNS: RegExp[] = [
  /ECONNREFUSED/i,
  /ETIMEDOUT/i,
  /ECONNRESET/i,
  /timeout/i,
  /timed out/i,
  /stale.*element/i,
  /flak/i,
  /net::ERR_/i,
];

const CATEGORY_RULES: CategoryRule[] = [
  {
    category: 'infrastructure',
    severity: 'critical',
    retryable: false,
    suggestedAction: 'abort',
    patterns: INFRASTRUCTURE_PATTERNS,
  },
  {
    category: 'configuration',
    severity: 'high',
    retryable: false,
    suggestedAction: 'skip',
    patterns: CONFIGURATION_PATTERNS,
  },
  {
    category: 'application',
    severity: 'high',
    retryable: true,
    suggestedAction: 'retry',
    patterns: APPLICATION_PATTERNS,
  },
  {
    category: 'test_logic',
    severity: 'medium',
    retryable: false,
    suggestedAction: 'heal',
    patterns: TEST_LOGIC_PATTERNS,
  },
  {
    category: 'transient',
    severity: 'low',
    retryable: true,
    suggestedAction: 'retry',
    patterns: TRANSIENT_PATTERNS,
  },
];

// ─── Helper Functions ─────────────────────────────────────────────────────────

/**
 * Safely extract a message string from an unknown error value.
 */
function extractMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  if (error === null || error === undefined) {
    return '';
  }
  try {
    return String(error);
  } catch {
    return '';
  }
}

// ─── Main Classification Function ────────────────────────────────────────────

/**
 * Classifies an error into the standard error taxonomy.
 *
 * The function evaluates category rules in precedence order:
 * infrastructure → configuration → application → test_logic → transient
 *
 * If no patterns match, falls back to transient with low severity and retryable=true.
 *
 * @param error - The error to classify (can be Error, string, object, null, undefined)
 * @param _context - Optional context about where the error occurred
 * @returns A fully populated ClassifiedError
 */
export function classifyError(error: unknown, _context?: ErrorContext): ClassifiedError {
  const message = extractMessage(error);

  // Evaluate category rules in precedence order
  for (const rule of CATEGORY_RULES) {
    for (const pattern of rule.patterns) {
      if (pattern.test(message)) {
        return {
          category: rule.category,
          severity: rule.severity,
          retryable: rule.retryable,
          message,
          originalError: error,
          suggestedAction: rule.suggestedAction,
        };
      }
    }
  }

  // Fallback: classify as transient with low severity and retryable
  return {
    category: 'transient',
    severity: 'low',
    retryable: true,
    message,
    originalError: error,
    suggestedAction: 'retry',
  };
}
