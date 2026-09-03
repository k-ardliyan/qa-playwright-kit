/// <reference types="node" />

// Feature: agent-ai-integration-layer, Property 8: Pipeline state persistence completeness
// Feature: agent-ai-integration-layer, Property 9: Pipeline resume correctness
// Feature: agent-ai-integration-layer, Property 10: Pipeline resume with missing artifacts
// Feature: agent-ai-integration-layer, Property 18: Pipeline_State serialization round-trip
//
// **Validates: Requirements 4.1, 4.2, 4.4, 4.5, 8.4, 8.6**

import assert from 'node:assert/strict';
import fc from 'fast-check';
import { saveState, loadState, resumeState } from '../../agents/integration/state';
import type { PipelineState } from '../../agents/integration/state';
import type { PipelinePhase } from '../../agents/integration/types';
import * as fs from 'fs';
import * as path from 'path';
import { createIsolatedReportDir } from '../helpers/report-dir-isolation';

// ─── Constants ────────────────────────────────────────────────────────────────

const PHASE_SEQUENCE: PipelinePhase[] = ['plan', 'generate', 'execute', 'heal', 'report'];

// ─── Test isolation ───────────────────────────────────────────────────────────
// All state writes go to a temp dir via QA_REPORT_DIR; nothing touches the
// production artifacts/reports or reports directories.

const isolate = createIsolatedReportDir();
const STATE_PATH = path.join(isolate.dir, 'pipeline-state.json');

// ─── Arbitraries ──────────────────────────────────────────────────────────────

const phaseArb = fc.constantFrom(
  'plan',
  'generate',
  'execute',
  'heal',
  'report',
) as fc.Arbitrary<PipelinePhase>;

// Use integer timestamps to avoid Invalid Date issues during shrinking
const isoDateArb = fc
  .integer({ min: 946684800000, max: 1924905600000 }) // 2000-01-01 to 2030-12-31
  .map((ms) => new Date(ms).toISOString());

const pipelineStateArb = fc.record({
  runId: fc.uuid(),
  status: fc.constantFrom('running', 'completed', 'failed', 'paused'),
  currentPhase: fc.option(phaseArb, { nil: null }),
  completedPhases: fc.subarray(PHASE_SEQUENCE),
  artifacts: fc.constant({ plan: [], generate: [], execute: [], heal: [], report: [] }),
  timestamp: isoDateArb,
  startedAt: isoDateArb,
  requirementPath: fc.string({ minLength: 1 }).map((s) => `requirements/${s}.md`),
  orchestrationMode: fc.constantFrom('manual', 'automatic'),
  errors: fc.constant([]),
}) as fc.Arbitrary<PipelineState>;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function backupState(): string | null {
  if (fs.existsSync(STATE_PATH)) {
    return fs.readFileSync(STATE_PATH, 'utf-8');
  }
  return null;
}

function restoreState(backup: string | null): void {
  if (backup !== null) {
    fs.writeFileSync(STATE_PATH, backup, 'utf-8');
  } else if (fs.existsSync(STATE_PATH)) {
    fs.unlinkSync(STATE_PATH);
  }
}

// ─── Property 8: Pipeline state persistence completeness ──────────────────────

async function testProperty8(): Promise<void> {
  const backup = backupState();

  try {
    await fc.assert(
      fc.asyncProperty(pipelineStateArb, async (state) => {
        // Save the state
        saveState(state);

        // Load the state back
        const loaded = loadState();

        // Loaded state must not be null
        assert.ok(loaded !== null, 'Loaded state should not be null after saveState');

        // Assert all required fields exist
        assert.ok(
          typeof loaded!.runId === 'string' && loaded!.runId.length > 0,
          'runId should exist',
        );
        assert.ok(
          loaded!.currentPhase === null || PHASE_SEQUENCE.includes(loaded!.currentPhase),
          'currentPhase should be null or a valid phase',
        );
        assert.ok(Array.isArray(loaded!.completedPhases), 'completedPhases should be an array');
        assert.ok(
          typeof loaded!.artifacts === 'object' && loaded!.artifacts !== null,
          'artifacts should be an object',
        );
        assert.ok(
          typeof loaded!.timestamp === 'string' && loaded!.timestamp.length > 0,
          'timestamp should exist',
        );

        // Assert loaded state matches original (except timestamp which gets updated by saveState)
        assert.equal(loaded!.runId, state.runId);
        assert.equal(loaded!.status, state.status);
        assert.equal(loaded!.currentPhase, state.currentPhase);
        assert.deepEqual(loaded!.completedPhases, state.completedPhases);
        assert.deepEqual(loaded!.artifacts, state.artifacts);
        assert.equal(loaded!.startedAt, state.startedAt);
        assert.equal(loaded!.requirementPath, state.requirementPath);
        assert.equal(loaded!.orchestrationMode, state.orchestrationMode);
        assert.deepEqual(loaded!.errors, state.errors);
      }),
      { numRuns: 100 },
    );
  } finally {
    restoreState(backup);
  }

  console.log('  ✓ Property 8 passed: pipeline state persistence completeness');
}

// ─── Property 9: Pipeline resume correctness ──────────────────────────────────

async function testProperty9(): Promise<void> {
  const backup = backupState();

  try {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 0, max: 4 }), fc.uuid(), async (n, runId) => {
        const completedPhases = PHASE_SEQUENCE.slice(0, n);

        const state: PipelineState = {
          runId,
          status: 'paused',
          currentPhase: n > 0 ? PHASE_SEQUENCE[n - 1] : null,
          completedPhases,
          artifacts: { plan: [], generate: [], execute: [], heal: [], report: [] },
          timestamp: new Date().toISOString(),
          startedAt: new Date().toISOString(),
          requirementPath: 'requirements/test.md',
          orchestrationMode: 'manual',
          errors: [],
        };

        // Save the state
        saveState(state);

        // Resume and check the resume point
        const result = resumeState();

        // Should not be an error
        assert.ok(
          !('error' in result),
          `Expected successful resume, got error: ${JSON.stringify(result)}`,
        );

        if (!('error' in result)) {
          // The resume phase should be the first incomplete phase
          const expectedResumePhase = PHASE_SEQUENCE[n];
          assert.equal(
            result.resumePhase,
            expectedResumePhase,
            `With ${n} completed phases, resume should start at '${expectedResumePhase}' but got '${result.resumePhase}'`,
          );
        }
      }),
      { numRuns: 100 },
    );
  } finally {
    restoreState(backup);
  }

  console.log('  ✓ Property 9 passed: pipeline resume correctness');
}

// ─── Property 10: Pipeline resume with missing artifacts ──────────────────────

async function testProperty10(): Promise<void> {
  const backup = backupState();
  const tempDir = path.join(isolate.dir, 'test-artifacts-temp');

  try {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 4 }),
        fc.integer({ min: 0, max: 3 }),
        fc.uuid(),
        async (completedCount, deleteOffset, runId) => {
          // Ensure the offset is within valid range for completed phases
          const deleteIndex = Math.min(deleteOffset, completedCount - 1);

          // Create temp directory for artifacts
          if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
          }

          const completedPhases = PHASE_SEQUENCE.slice(0, completedCount);
          const artifacts: Record<PipelinePhase, string[]> = {
            plan: [],
            generate: [],
            execute: [],
            heal: [],
            report: [],
          };

          // Create real temp artifact files for each completed phase
          for (const phase of completedPhases) {
            const artifactPath = path.join(tempDir, `${runId}-${phase}.json`);
            fs.writeFileSync(artifactPath, JSON.stringify({ phase }), 'utf-8');
            artifacts[phase] = [artifactPath];
          }

          const state: PipelineState = {
            runId,
            status: 'paused',
            currentPhase: completedPhases[completedPhases.length - 1],
            completedPhases: [...completedPhases],
            artifacts,
            timestamp: new Date().toISOString(),
            startedAt: new Date().toISOString(),
            requirementPath: 'requirements/test.md',
            orchestrationMode: 'manual',
            errors: [],
          };

          // Save the state
          saveState(state);

          // Delete one artifact file to simulate missing artifact
          const phaseToInvalidate = completedPhases[deleteIndex];
          const fileToDelete = artifacts[phaseToInvalidate][0];
          if (fs.existsSync(fileToDelete)) {
            fs.unlinkSync(fileToDelete);
          }

          // Resume state
          const result = resumeState();

          // Should not return an error
          assert.ok(
            !('error' in result),
            `Expected successful resume, got error: ${JSON.stringify(result)}`,
          );

          if (!('error' in result)) {
            // The phase with the missing artifact should have been invalidated
            assert.ok(
              !result.state.completedPhases.includes(phaseToInvalidate),
              `Phase '${phaseToInvalidate}' should have been invalidated (removed from completedPhases)`,
            );

            // Resume phase should be at or before the invalidated phase
            const resumePhaseIndex = PHASE_SEQUENCE.indexOf(result.resumePhase);
            const invalidatedPhaseIndex = PHASE_SEQUENCE.indexOf(phaseToInvalidate);
            assert.ok(
              resumePhaseIndex <= invalidatedPhaseIndex,
              `Resume phase '${result.resumePhase}' (index ${resumePhaseIndex}) should be at or before invalidated phase '${phaseToInvalidate}' (index ${invalidatedPhaseIndex})`,
            );
          }

          // Cleanup temp artifact files for this run
          for (const phase of PHASE_SEQUENCE) {
            const artifactPath = path.join(tempDir, `${runId}-${phase}.json`);
            if (fs.existsSync(artifactPath)) {
              fs.unlinkSync(artifactPath);
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  } finally {
    restoreState(backup);
    // Clean up temp directory
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }

  console.log('  ✓ Property 10 passed: pipeline resume with missing artifacts');
}

// ─── Property 18: Pipeline_State serialization round-trip ─────────────────────

async function testProperty18(): Promise<void> {
  await fc.assert(
    fc.asyncProperty(pipelineStateArb, async (state) => {
      // Serialize to JSON string
      const json1 = JSON.stringify(state);

      // Deserialize back
      const deserialized = JSON.parse(json1) as PipelineState;

      // Serialize again
      const json2 = JSON.stringify(deserialized);

      // The two JSON strings should be identical
      assert.equal(json1, json2, 'Round-trip serialization should produce identical JSON');
    }),
    { numRuns: 100 },
  );

  console.log('  ✓ Property 18 passed: Pipeline_State serialization round-trip');
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('Pipeline State Property Tests');
  console.log('──────────────────────────────────────────');

  try {
    await testProperty8();
    await testProperty9();
    await testProperty10();
    await testProperty18();
  } finally {
    isolate.teardown();
  }

  console.log('──────────────────────────────────────────');
  console.log('✓ All pipeline state property tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
