/// <reference types="node" />

/**
 * Property 20: Error Classification Completeness
 *
 * For ANY error input, the classifyError function SHALL produce a ClassifiedError with:
 * - category: one of 'infrastructure', 'configuration', 'application', 'test_logic', 'transient'
 * - severity: one of 'critical', 'high', 'medium', 'low'
 * - retryable: a boolean
 * - suggestedAction: a non-empty string
 * - message: a string (may be empty for null/undefined inputs)
 *
 * **Validates: Requirements 12.1, 12.2, 12.3, 12.4**
 */

import assert from 'node:assert/strict';
import fc from 'fast-check';
import { classifyError } from '../../pipeline-telemetry/error-classifier';

const VALID_CATEGORIES = new Set([
  'infrastructure',
  'configuration',
  'application',
  'test_logic',
  'transient',
]);

const VALID_SEVERITIES = new Set(['critical', 'high', 'medium', 'low']);

const arbError: fc.Arbitrary<unknown> = fc.oneof(
  fc.string(),
  fc.string().map((msg) => new Error(msg)),
  fc.integer(),
  fc.constant(null),
  fc.constant(undefined),
  fc.dictionary(fc.string(), fc.string()),
  fc.array(fc.string()),
);

async function main(): Promise<void> {
  await fc.assert(
    fc.asyncProperty(arbError, async (error) => {
      const result = classifyError(error);

      assert(VALID_CATEGORIES.has(result.category), `Invalid category: ${result.category}`);
      assert(VALID_SEVERITIES.has(result.severity), `Invalid severity: ${result.severity}`);
      assert(typeof result.retryable === 'boolean', 'retryable must be boolean');
      assert(
        typeof result.suggestedAction === 'string' && result.suggestedAction.length > 0,
        'suggestedAction must be non-empty string',
      );
      assert(typeof result.message === 'string', 'message must be a string');
    }),
    { numRuns: 200 },
  );

  console.log(
    '✓ Property 20 passed: error classification completeness — all inputs produce valid ClassifiedError',
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
