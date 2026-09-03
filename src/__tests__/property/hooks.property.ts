/// <reference types="node" />

// Feature: agent-ai-integration-layer, Property 15: Event hook emission for phase lifecycle
// Feature: agent-ai-integration-layer, Property 16: Registered hook invocation
// Feature: agent-ai-integration-layer, Property 17: File logger hook persistence
//
// **Validates: Requirements 7.1, 7.2, 7.3, 7.4, 7.5**

import assert from 'node:assert/strict';
import fc from 'fast-check';
import * as fs from 'fs';
import * as path from 'path';
import { PipelineHookRegistry, fileLoggerHook } from '../../agents/integration/hooks';
import type { PipelineEvent, EventType, HookCallback } from '../../agents/integration/hooks';

// ─── Arbitraries ──────────────────────────────────────────────────────────────

const eventTypeArb = fc.constantFrom(
  'phase:start',
  'phase:complete',
  'phase:error',
) as fc.Arbitrary<EventType>;

const phaseArb = fc.constantFrom('plan', 'generate', 'execute', 'heal', 'report');

const timestampArb = fc
  .integer({ min: 946684800000, max: 4102444799000 }) // 2000-01-01 to 2099-12-31 in ms
  .map((ms) => new Date(ms).toISOString());

const pipelineEventArb = fc.record({
  eventType: eventTypeArb,
  runId: fc.uuid(),
  phase: phaseArb,
  timestamp: timestampArb,
}) as fc.Arbitrary<PipelineEvent>;

// ─── Property 15: Event hook emission for phase lifecycle ─────────────────────

async function testProperty15(): Promise<void> {
  await fc.assert(
    fc.asyncProperty(pipelineEventArb, async (event) => {
      const registry = new PipelineHookRegistry();
      const received: PipelineEvent[] = [];

      const trackingCallback: HookCallback = (e) => {
        received.push(e);
      };

      registry.registerHook(event.eventType, trackingCallback);
      await registry.emit(event);

      // The tracking callback should have received exactly one event
      assert.equal(received.length, 1, 'Callback should receive exactly one event');

      // Verify all required fields are present and match
      const receivedEvent = received[0];
      assert.equal(receivedEvent.eventType, event.eventType);
      assert.equal(receivedEvent.runId, event.runId);
      assert.equal(receivedEvent.phase, event.phase);
      assert.equal(receivedEvent.timestamp, event.timestamp);
    }),
    { numRuns: 100 },
  );

  console.log('  ✓ Property 15 passed: event hook emission for phase lifecycle');
}

// ─── Property 16: Registered hook invocation ──────────────────────────────────

async function testProperty16(): Promise<void> {
  // Generate a pair: one event type for matching, one different event type for non-matching
  const distinctEventTypePairArb = eventTypeArb.chain((matchType) => {
    const otherTypes = (['phase:start', 'phase:complete', 'phase:error'] as EventType[]).filter(
      (t) => t !== matchType,
    );
    return fc.constantFrom(...otherTypes).map((nonMatchType) => ({ matchType, nonMatchType }));
  });

  await fc.assert(
    fc.asyncProperty(
      distinctEventTypePairArb,
      pipelineEventArb,
      async ({ matchType, nonMatchType }, baseEvent) => {
        // Override the event's eventType to be the matchType
        const event: PipelineEvent = { ...baseEvent, eventType: matchType };

        const registry = new PipelineHookRegistry();
        let matchingCalled = false;
        let nonMatchingCalled = false;

        const matchingHook: HookCallback = () => {
          matchingCalled = true;
        };
        const nonMatchingHook: HookCallback = () => {
          nonMatchingCalled = true;
        };

        registry.registerHook(matchType, matchingHook);
        registry.registerHook(nonMatchType, nonMatchingHook);

        await registry.emit(event);

        // Only the matching hook should be called
        assert.equal(matchingCalled, true, 'Matching hook should be called');
        assert.equal(nonMatchingCalled, false, 'Non-matching hook should NOT be called');
      },
    ),
    { numRuns: 100 },
  );

  console.log('  ✓ Property 16 passed: registered hook invocation');
}

// ─── Property 17: File logger hook persistence ────────────────────────────────

async function testProperty17(): Promise<void> {
  const eventsFilePath = path.resolve('artifacts', 'reports', 'pipeline-events.jsonl');
  const reportsDir = path.dirname(eventsFilePath);

  // Ensure reports directory exists
  if (!fs.existsSync(reportsDir)) {
    fs.mkdirSync(reportsDir, { recursive: true });
  }

  // Save existing content (if any) to restore later
  const existingContent = fs.existsSync(eventsFilePath)
    ? fs.readFileSync(eventsFilePath, 'utf-8')
    : null;

  try {
    await fc.assert(
      fc.asyncProperty(pipelineEventArb, async (event) => {
        // Get the file size before writing (to read only the new line)
        const sizeBefore = fs.existsSync(eventsFilePath) ? fs.statSync(eventsFilePath).size : 0;

        // Call fileLoggerHook directly with the event
        fileLoggerHook(event);

        // Read the file content that was appended
        const fullContent = fs.readFileSync(eventsFilePath, 'utf-8');
        const newContent = fullContent.slice(sizeBefore);

        // The new content should be a single JSON line
        const trimmed = newContent.trim();
        assert.ok(trimmed.length > 0, 'Should have written content');

        // Parse the last written line
        const parsed = JSON.parse(trimmed) as PipelineEvent;

        // Verify all fields match the original event
        assert.equal(parsed.eventType, event.eventType);
        assert.equal(parsed.runId, event.runId);
        assert.equal(parsed.phase, event.phase);
        assert.equal(parsed.timestamp, event.timestamp);
      }),
      { numRuns: 100 },
    );
  } finally {
    // Clean up: restore original content or remove the file
    if (existingContent !== null) {
      fs.writeFileSync(eventsFilePath, existingContent, 'utf-8');
    } else if (fs.existsSync(eventsFilePath)) {
      fs.unlinkSync(eventsFilePath);
    }
  }

  console.log('  ✓ Property 17 passed: file logger hook persistence');
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('Event Hook System Property Tests');
  console.log('──────────────────────────────────────────');

  await testProperty15();
  await testProperty16();
  await testProperty17();

  console.log('──────────────────────────────────────────');
  console.log('✓ All event hook property tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
