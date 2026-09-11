/// <reference types="node" />

// Feature: agent-ai-integration-layer, Property 1: Protocol request schema validation
// Feature: agent-ai-integration-layer, Property 2: Protocol response schema validation
// Feature: agent-ai-integration-layer, Property 4: Invalid action error response
//
// **Validates: Requirements 1.1, 1.2, 1.5**

import assert from 'node:assert/strict';
import fc from 'fast-check';
import {
  validateRequest,
  createSuccessResponse,
  createErrorResponse,
  createInProgressResponse,
  VALID_ACTIONS,
  VALID_PHASES,
} from '../../agents/integration/protocol';

// ─── Arbitraries ──────────────────────────────────────────────────────────────

/** Generate a random valid PipelinePhase */
const phaseArb = fc.constantFrom(...VALID_PHASES);

/** Generate a random valid action */
const actionArb = fc.constantFrom(...VALID_ACTIONS);

/**
 * Generate a random valid requirementPath.
 *
 * The validator enforces `isSafeRequirementPath`: non-empty AFTER trim, no NUL,
 * `requirements/` prefix, `.md` suffix, and NO `..` segment. A raw
 * `fc.string({ minLength: 1 })` emits whitespace-only and traversal input
 * (`requirements/ .md`, `requirements/../.md`), which the validator correctly
 * rejects while this property claims the request is valid — a flaky failure
 * that reddened the CI gate on an unlucky seed. Keep the generated segment a
 * single safe filename so "valid" means the same thing on both sides.
 */
const requirementPathArb = fc
  .stringMatching(/^[A-Za-z0-9._-]+$/)
  .filter((s) => s.trim().length > 0 && !s.split('/').includes('..'))
  .map((s) => `requirements/${s}.md`);

/**
 * Generate a random role name that satisfies `isNonEmptyString`
 * (non-empty after trim) — the contract the validator actually enforces.
 */
const roleArb = fc.stringMatching(/^[A-Za-z0-9._-]+$/).filter((s) => s.trim().length > 0);

/** Generate a random runId */
const runIdArb = fc.uuid();

/** Generate a valid protocol request with proper conditional fields */
const validRequestArb: fc.Arbitrary<Record<string, unknown>> = actionArb.chain((action) => {
  if (action === 'invoke') {
    return fc.record({
      action: fc.constant(action),
      phase: phaseArb,
      requirementPath: requirementPathArb,
      options: fc.option(
        fc.record({
          orchestrationMode: fc.option(fc.constantFrom('manual' as const, 'automatic' as const), {
            nil: undefined,
          }),
          dryRun: fc.option(fc.boolean(), { nil: undefined }),
        }),
        { nil: undefined },
      ),
    }) as fc.Arbitrary<Record<string, unknown>>;
  }
  if (action === 'resume') {
    return fc.record({
      action: fc.constant(action),
      options: fc.record({
        runId: runIdArb,
      }),
    }) as fc.Arbitrary<Record<string, unknown>>;
  }
  if (action === 'run') {
    return fc.record({
      action: fc.constant(action),
      requirementPath: requirementPathArb,
      stage: fc.option(
        fc.constantFrom(
          'explore' as const,
          'model' as const,
          'challenge' as const,
          'generate' as const,
          'validate' as const,
        ),
        { nil: undefined },
      ),
      options: fc.option(
        fc.record({
          orchestrationMode: fc.option(fc.constantFrom('manual' as const, 'automatic' as const), {
            nil: undefined,
          }),
          roleFilter: fc.option(fc.array(roleArb, { minLength: 1 }), {
            nil: undefined,
          }),
        }),
        { nil: undefined },
      ),
    }) as fc.Arbitrary<Record<string, unknown>>;
  }
  // 'query' action — minimal required fields
  return fc.record({ action: fc.constant(action) }) as fc.Arbitrary<Record<string, unknown>>;
});

/** Generate an invalid request (missing required conditional fields, invalid types) */
const invalidRequestArb = fc.oneof(
  // null request
  fc.constant(null),
  // non-object request
  fc.oneof(fc.string(), fc.integer(), fc.boolean()),
  // missing action field
  fc.record({ phase: phaseArb }),
  // invoke without phase
  fc.record({
    action: fc.constant('invoke'),
    requirementPath: requirementPathArb,
  }),
  // invoke without requirementPath
  fc.record({
    action: fc.constant('invoke'),
    phase: phaseArb,
  }),
  // resume without options.runId
  fc.record({
    action: fc.constant('resume'),
    options: fc.record({
      orchestrationMode: fc.constantFrom('manual' as const, 'automatic' as const),
    }),
  }),
  // invalid phase value
  fc.record({
    action: fc.constant('query'),
    phase: fc
      .string({ minLength: 1 })
      .filter((s) => !(VALID_PHASES as readonly string[]).includes(s)),
  }),
);

// ─── Property 1: Protocol request schema validation ───────────────────────────

async function testProperty1(): Promise<void> {
  // Part A: Valid requests are accepted
  await fc.assert(
    fc.asyncProperty(validRequestArb, async (request) => {
      const result = validateRequest(request);
      assert.equal(
        result.valid,
        true,
        `Expected valid request to be accepted: ${JSON.stringify(request)}`,
      );
      if (result.valid) {
        assert.equal(result.request.action, (request as Record<string, unknown>).action);
        // Verify orchestrationMode defaults to 'manual' when not provided
        assert.ok(
          result.request.options?.orchestrationMode === 'manual' ||
            result.request.options?.orchestrationMode === 'automatic',
          'orchestrationMode should be set',
        );
      }
    }),
    { numRuns: 100 },
  );

  // Part B: Invalid requests are rejected with descriptive error
  await fc.assert(
    fc.asyncProperty(invalidRequestArb, async (request) => {
      const result = validateRequest(request);
      assert.equal(
        result.valid,
        false,
        `Expected invalid request to be rejected: ${JSON.stringify(request)}`,
      );
      if (!result.valid) {
        assert.equal(result.error.status, 'error');
        assert.ok(
          result.error.errors !== undefined && result.error.errors.length > 0,
          'Should have error details',
        );
        // Each error should have a code and message
        for (const err of result.error.errors!) {
          assert.ok(
            typeof err.code === 'string' && err.code.length > 0,
            'Error code should be non-empty string',
          );
          assert.ok(
            typeof err.message === 'string' && err.message.length > 0,
            'Error message should be non-empty string',
          );
          assert.equal(typeof err.retryable, 'boolean', 'retryable should be boolean');
        }
      }
    }),
    { numRuns: 100 },
  );

  console.log('✓ Property 1 passed: Protocol request schema validation');
}

// ─── Property 2: Protocol response schema validation ──────────────────────────

async function testProperty2(): Promise<void> {
  const phaseOrAllArb = fc.oneof(phaseArb, fc.constant('all' as const));

  const phaseResultArb = fc.record({
    phase: phaseArb,
    status: fc.constantFrom('success' as const, 'error' as const),
    output: fc.option(fc.string(), { nil: undefined }),
    artifacts: fc.option(fc.array(fc.string(), { minLength: 0, maxLength: 3 }), { nil: undefined }),
  });

  const protocolErrorArb = fc.record({
    code: fc.string({ minLength: 1 }),
    message: fc.string({ minLength: 1 }),
    retryable: fc.boolean(),
  });

  // Test createSuccessResponse
  await fc.assert(
    fc.asyncProperty(
      phaseOrAllArb,
      fc.option(phaseResultArb, { nil: undefined }),
      async (phase, result) => {
        const response = createSuccessResponse(phase, result);
        assert.equal(response.status, 'success');
        assert.equal(response.phase, phase);
        if (result !== undefined) {
          assert.deepEqual(response.result, result);
        } else {
          assert.equal(response.result, undefined);
        }
        assert.equal(response.errors, undefined);
      },
    ),
    { numRuns: 100 },
  );

  // Test createErrorResponse
  await fc.assert(
    fc.asyncProperty(
      fc.array(protocolErrorArb, { minLength: 1, maxLength: 3 }),
      fc.option(phaseOrAllArb, { nil: undefined }),
      async (errors, phase) => {
        const response = createErrorResponse(errors, phase);
        assert.equal(response.status, 'error');
        assert.equal(response.phase, phase ?? 'all');
        assert.ok(response.errors !== undefined);
        assert.equal(response.errors!.length, errors.length);
        for (const err of response.errors!) {
          assert.ok(typeof err.code === 'string');
          assert.ok(typeof err.message === 'string');
          assert.equal(typeof err.retryable, 'boolean');
        }
      },
    ),
    { numRuns: 100 },
  );

  // Test createInProgressResponse
  await fc.assert(
    fc.asyncProperty(phaseOrAllArb, async (phase) => {
      const response = createInProgressResponse(phase);
      assert.equal(response.status, 'in-progress');
      assert.equal(response.phase, phase);
      assert.equal(response.result, undefined);
      assert.equal(response.errors, undefined);
    }),
    { numRuns: 100 },
  );

  console.log('✓ Property 2 passed: Protocol response schema validation');
}

// ─── Property 4: Invalid action error response ───────────────────────────────

async function testProperty4(): Promise<void> {
  // Generate random strings that are NOT valid actions
  const invalidActionArb = fc
    .string({ minLength: 1 })
    .filter((s) => !(VALID_ACTIONS as readonly string[]).includes(s));

  await fc.assert(
    fc.asyncProperty(invalidActionArb, async (invalidAction) => {
      const result = validateRequest({ action: invalidAction });
      assert.equal(
        result.valid,
        false,
        `Expected invalid action '${invalidAction}' to be rejected`,
      );
      if (!result.valid) {
        assert.equal(result.error.status, 'error');
        assert.ok(result.error.errors !== undefined && result.error.errors.length > 0);
        const errorMessage = result.error.errors![0].message;
        // Error message should list all valid actions
        for (const validAction of VALID_ACTIONS) {
          assert.ok(
            errorMessage.includes(validAction),
            `Error message should contain '${validAction}', got: "${errorMessage}"`,
          );
        }
        // Error code should be INVALID_ACTION
        assert.equal(result.error.errors![0].code, 'INVALID_ACTION');
      }
    }),
    { numRuns: 100 },
  );

  console.log('✓ Property 4 passed: Invalid action error response');
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('Protocol Property Tests');
  console.log('──────────────────────────────────────────');

  await testProperty1();
  await testProperty2();
  await testProperty4();

  console.log('──────────────────────────────────────────');
  console.log('✓ All protocol property tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
