/// <reference types="node" />

/**
 * Property Tests for Orchestrator Engine
 *
 * Property 3: Phase routing correctness
 * Property 19: Automatic mode sequential execution with events
 * Property 20: Retryable error retry behavior
 * Property 21: Non-retryable error skip-to-report
 * Property 22: Automatic mode report schema conformance
 * Property 23: Dry run produces no side effects
 *
 * **Validates: Requirements 1.4, 9.1, 9.2, 9.3, 9.4, 9.5, 9.6**
 */

import assert from 'node:assert/strict';
import fc from 'fast-check';
import * as fs from 'fs';
import * as path from 'path';
import { Orchestrator } from '../../agents/integration/orchestrator';
import type { OrchestratorConfig, PhaseExecutor } from '../../agents/integration/orchestrator';
import { PipelineHookRegistry } from '../../agents/integration/hooks';
import type { PipelineEvent, HookCallback } from '../../agents/integration/hooks';
import type { PipelinePhase } from '../../agents/integration/types';
import { createIsolatedReportDir } from '../helpers/report-dir-isolation';

const isolate = createIsolatedReportDir();
const STATE_PATH = path.join(isolate.dir, 'pipeline-state.json');
const EVENTS_PATH = path.join(isolate.dir, 'pipeline-events.jsonl');
const PHASE_SEQUENCE: PipelinePhase[] = ['plan', 'generate', 'execute', 'heal', 'report'];

function createSuccessExecutor(): PhaseExecutor {
  return {
    execute: async (phase, input) => ({
      phase,
      status: 'success' as const,
      output: { phase, input },
      artifacts: [],
    }),
  };
}

function createTrackingExecutor(): { executor: PhaseExecutor; calledPhases: PipelinePhase[] } {
  const calledPhases: PipelinePhase[] = [];
  const executor: PhaseExecutor = {
    execute: async (phase, _input) => {
      calledPhases.push(phase);
      return { phase, status: 'success' as const, output: { phase }, artifacts: [] };
    },
  };
  return { executor, calledPhases };
}

function createCountingExecutor(
  failPhase: PipelinePhase,
  retryable: boolean,
): {
  executor: PhaseExecutor;
  getCallCount: (phase: PipelinePhase) => number;
  calledPhases: PipelinePhase[];
} {
  const callCounts: Record<string, number> = {};
  const calledPhases: PipelinePhase[] = [];
  const executor: PhaseExecutor = {
    execute: async (phase, _input) => {
      callCounts[phase] = (callCounts[phase] || 0) + 1;
      calledPhases.push(phase);
      if (phase === failPhase) {
        return {
          phase,
          status: 'error' as const,
          error: {
            code: 'TEST_ERROR',
            message: `Phase ${phase} failed (call ${callCounts[phase]})`,
            phase,
            retryable,
          },
        };
      }
      return { phase, status: 'success' as const, output: { phase }, artifacts: [] };
    },
  };
  return { executor, getCallCount: (p) => callCounts[p] || 0, calledPhases };
}

/** Save existing report files and return restore function */
function backupReportFiles(): () => void {
  const stateBak = fs.existsSync(STATE_PATH) ? fs.readFileSync(STATE_PATH, 'utf-8') : null;
  const eventsBak = fs.existsSync(EVENTS_PATH) ? fs.readFileSync(EVENTS_PATH, 'utf-8') : null;

  return () => {
    if (stateBak !== null) {
      fs.writeFileSync(STATE_PATH, stateBak, 'utf-8');
    } else if (fs.existsSync(STATE_PATH)) {
      fs.unlinkSync(STATE_PATH);
    }
    if (eventsBak !== null) {
      fs.writeFileSync(EVENTS_PATH, eventsBak, 'utf-8');
    } else if (fs.existsSync(EVENTS_PATH)) {
      fs.unlinkSync(EVENTS_PATH);
    }
  };
}

async function main(): Promise<void> {
  const restore = backupReportFiles();

  try {
    // ============================================================
    // Property 3: Phase routing correctness
    // For any valid phase, the executor receives exactly that phase.
    // ============================================================
    await fc.assert(
      fc.asyncProperty(fc.constantFrom(...PHASE_SEQUENCE), fc.json(), async (phase, inputJson) => {
        // Clean files for fresh test
        if (fs.existsSync(EVENTS_PATH)) fs.unlinkSync(EVENTS_PATH);

        const { executor, calledPhases } = createTrackingExecutor();
        const hooks = new PipelineHookRegistry();
        const config: OrchestratorConfig = {
          orchestrationMode: 'manual',
          requirementPath: 'requirements/test.md',
        };

        const orchestrator = new Orchestrator(config, executor, hooks);
        const input = JSON.parse(inputJson);
        await orchestrator.runPhase(phase, input);

        // The executor must have been called exactly once with the specified phase
        assert.equal(calledPhases.length, 1, `Expected 1 call, got ${calledPhases.length}`);
        assert.equal(calledPhases[0], phase, `Expected phase '${phase}', got '${calledPhases[0]}'`);
      }),
      { numRuns: 100 },
    );
    console.log('✓ Property 3 passed: Phase routing correctness');

    // ============================================================
    // Property 19: Automatic mode sequential execution with events
    // All phases execute in order and emit phase:start events.
    // ============================================================
    await fc.assert(
      fc.asyncProperty(fc.constant(null), async () => {
        if (fs.existsSync(EVENTS_PATH)) fs.unlinkSync(EVENTS_PATH);

        const events: PipelineEvent[] = [];
        const hooks = new PipelineHookRegistry();
        const trackHook: HookCallback = (event) => {
          events.push(event);
        };
        hooks.registerHook('phase:start', trackHook);
        hooks.registerHook('phase:complete', trackHook);

        const { executor, calledPhases } = createTrackingExecutor();
        const config: OrchestratorConfig = {
          orchestrationMode: 'automatic',
          requirementPath: 'requirements/test.md',
        };

        const orchestrator = new Orchestrator(config, executor, hooks);
        await orchestrator.run();

        // All 5 phases should have been called
        assert.equal(calledPhases.length, 5, `Expected 5 phases, got ${calledPhases.length}`);

        // Phases execute in the correct order
        for (let i = 0; i < PHASE_SEQUENCE.length; i++) {
          assert.equal(
            calledPhases[i],
            PHASE_SEQUENCE[i],
            `Phase ${i} should be '${PHASE_SEQUENCE[i]}', got '${calledPhases[i]}'`,
          );
        }

        // Number of phase:start events = 5
        const startEvents = events.filter((e) => e.eventType === 'phase:start');
        assert.equal(
          startEvents.length,
          5,
          `Expected 5 phase:start events, got ${startEvents.length}`,
        );

        // phase:start events are in order
        for (let i = 0; i < PHASE_SEQUENCE.length; i++) {
          assert.equal(
            startEvents[i].phase,
            PHASE_SEQUENCE[i],
            `phase:start event ${i} should be '${PHASE_SEQUENCE[i]}', got '${startEvents[i].phase}'`,
          );
        }
      }),
      { numRuns: 10 },
    );
    console.log('✓ Property 19 passed: Automatic mode sequential execution with events');

    // ============================================================
    // Property 20: Retryable error retry behavior
    // For a retryable failure, the executor is called exactly TWICE for the failing phase.
    // Note: 'report' is excluded because skip-to-report calls report again after retry failure.
    // ============================================================
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom<PipelinePhase>('plan', 'generate', 'execute', 'heal'),
        async (failPhase) => {
          if (fs.existsSync(EVENTS_PATH)) fs.unlinkSync(EVENTS_PATH);

          const { executor, getCallCount } = createCountingExecutor(failPhase, true);
          const hooks = new PipelineHookRegistry();
          const config: OrchestratorConfig = {
            orchestrationMode: 'automatic',
            requirementPath: 'requirements/test.md',
          };

          const orchestrator = new Orchestrator(config, executor, hooks);
          await orchestrator.run();

          // The failing phase should have been called exactly 2 times (original + 1 retry)
          const count = getCallCount(failPhase);
          assert.equal(
            count,
            2,
            `Phase '${failPhase}' should be called exactly 2 times (retryable), got ${count}`,
          );
        },
      ),
      { numRuns: 100 },
    );
    console.log('✓ Property 20 passed: Retryable error retry behavior');

    // ============================================================
    // Property 21: Non-retryable error skip-to-report
    // For a non-retryable failure, phases between the failing phase and 'report' are NOT executed,
    // but 'report' phase IS executed (skip-to-report).
    // ============================================================
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom<PipelinePhase>('plan', 'generate', 'execute', 'heal'),
        async (failPhase) => {
          if (fs.existsSync(EVENTS_PATH)) fs.unlinkSync(EVENTS_PATH);

          const { executor, calledPhases } = createCountingExecutor(failPhase, false);
          const hooks = new PipelineHookRegistry();
          const config: OrchestratorConfig = {
            orchestrationMode: 'automatic',
            requirementPath: 'requirements/test.md',
          };

          const orchestrator = new Orchestrator(config, executor, hooks);
          await orchestrator.run();

          const failIndex = PHASE_SEQUENCE.indexOf(failPhase);

          // Phases between failPhase and 'report' should NOT have been called
          const skippedPhases = PHASE_SEQUENCE.slice(failIndex + 1, PHASE_SEQUENCE.length - 1);
          for (const skipped of skippedPhases) {
            assert.ok(
              !calledPhases.includes(skipped),
              `Phase '${skipped}' should have been skipped after non-retryable error in '${failPhase}'`,
            );
          }

          // 'report' phase MUST have been executed (skip-to-report)
          assert.ok(
            calledPhases.includes('report'),
            `'report' phase must be executed after non-retryable error in '${failPhase}'`,
          );
        },
      ),
      { numRuns: 100 },
    );
    console.log('✓ Property 21 passed: Non-retryable error skip-to-report');

    // ============================================================
    // Property 22: Automatic mode report schema conformance
    // A completed automatic pipeline run returns status='success' and phase='all'.
    // ============================================================
    await fc.assert(
      fc.asyncProperty(fc.constant(null), async () => {
        if (fs.existsSync(EVENTS_PATH)) fs.unlinkSync(EVENTS_PATH);

        const executor = createSuccessExecutor();
        const hooks = new PipelineHookRegistry();
        const config: OrchestratorConfig = {
          orchestrationMode: 'automatic',
          requirementPath: 'requirements/test.md',
        };

        const orchestrator = new Orchestrator(config, executor, hooks);
        const response = await orchestrator.run();

        // Response must have status: 'success'
        assert.equal(
          response.status,
          'success',
          `Expected status 'success', got '${response.status}'`,
        );

        // Response must have phase: 'all'
        assert.equal(response.phase, 'all', `Expected phase 'all', got '${response.phase}'`);

        // Response must have result field
        assert.ok(response.result !== undefined, 'Response must have a result field');
      }),
      { numRuns: 10 },
    );
    console.log('✓ Property 22 passed: Automatic mode report schema conformance');

    // ============================================================
    // Property 23: Dry run produces no side effects
    // With dryRun: true, the executor is NEVER called, but events are still emitted.
    // ============================================================
    await fc.assert(
      fc.asyncProperty(fc.constant(null), async () => {
        if (fs.existsSync(EVENTS_PATH)) fs.unlinkSync(EVENTS_PATH);

        const events: PipelineEvent[] = [];
        const hooks = new PipelineHookRegistry();
        const trackHook: HookCallback = (event) => {
          events.push(event);
        };
        hooks.registerHook('phase:start', trackHook);
        hooks.registerHook('phase:complete', trackHook);

        const { executor, calledPhases } = createTrackingExecutor();
        const config: OrchestratorConfig = {
          orchestrationMode: 'automatic',
          requirementPath: 'requirements/test.md',
          dryRun: true,
        };

        const orchestrator = new Orchestrator(config, executor, hooks);
        const response = await orchestrator.run();

        // Executor should NEVER be called (zero executions)
        assert.equal(
          calledPhases.length,
          0,
          `Dry run: executor should not be called, got ${calledPhases.length} calls`,
        );

        // phase:start events should still be emitted for all 5 phases
        const startEvents = events.filter((e) => e.eventType === 'phase:start');
        assert.equal(
          startEvents.length,
          5,
          `Dry run: expected 5 phase:start events, got ${startEvents.length}`,
        );

        // phase:complete events should still be emitted for all 5 phases
        const completeEvents = events.filter((e) => e.eventType === 'phase:complete');
        assert.equal(
          completeEvents.length,
          5,
          `Dry run: expected 5 phase:complete events, got ${completeEvents.length}`,
        );

        // Response should contain dryRun information
        assert.equal(response.status, 'success', `Dry run response should have status 'success'`);
        assert.ok(response.result !== undefined, 'Dry run response must have a result field');
        assert.ok(
          response.result?.output &&
            typeof response.result.output === 'object' &&
            (response.result.output as Record<string, unknown>).dryRun === true,
          'Dry run response result.output should contain dryRun: true',
        );
      }),
      { numRuns: 10 },
    );
    console.log('✓ Property 23 passed: Dry run produces no side effects');
  } finally {
    restore();
    isolate.teardown();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
