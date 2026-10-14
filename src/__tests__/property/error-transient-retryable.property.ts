/// <reference types="node" />

/**
 * Property 21: Transient Errors Are Always Retryable
 *
 * For any error classified as transient, the retryable flag SHALL be true.
 *
 * **Validates: Requirements 12.5**
 */

import assert from 'node:assert/strict';
import fc from 'fast-check';
import { classifyError } from '../../pipeline-telemetry/error-classifier';

// Known transient error messages
const KNOWN_TRANSIENT_MESSAGES = [
  'ECONNREFUSED localhost:3000',
  'ETIMEDOUT connecting to service',
  'ECONNRESET by peer',
  'timeout waiting for response',
  'timed out after 30s',
  'stale element reference',
  'net::ERR_CONNECTION_REFUSED',
  'flaky test detected',
];

const arbError: fc.Arbitrary<unknown> = fc.oneof(
  fc.string(),
  fc.string().map((msg) => new Error(msg)),
  fc.constantFrom(...KNOWN_TRANSIENT_MESSAGES),
  fc.constantFrom(...KNOWN_TRANSIENT_MESSAGES).map((msg) => new Error(msg)),
  fc.integer(),
  fc.constant(null),
  fc.constant(undefined),
);

async function main(): Promise<void> {
  // Property: whenever classification is transient → retryable must be true
  await fc.assert(
    fc.asyncProperty(arbError, async (error) => {
      const result = classifyError(error);
      if (result.category === 'transient') {
        assert.equal(
          result.retryable,
          true,
          `Transient error must be retryable. Got retryable=${result.retryable} for message="${result.message}"`,
        );
      }
    }),
    { numRuns: 200 },
  );

  // Direct verification with known transient messages
  for (const msg of KNOWN_TRANSIENT_MESSAGES) {
    const result = classifyError(new Error(msg));
    if (result.category === 'transient') {
      assert.equal(result.retryable, true, `Known transient "${msg}" must be retryable`);
    }
  }

  console.log('✓ Property 21 passed: transient errors are always retryable');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
