/// <reference types="node" />

// Feature: agent-ai-integration-layer, Property 11: Reporter output completeness

import assert from 'node:assert/strict';
import fc from 'fast-check';
import { buildReport } from '../../agents/reporting/report-builder';
import type {
  BuildReportInput,
  PipelineReport,
  ScenarioCoverage,
} from '../../agents/reporting/report-builder';

/**
 * Validates: Requirements 5.3, 5.4
 *
 * Property 11: Reporter output completeness
 * For any set of test execution results and requirement scenarios, the reporter
 * output SHALL contain all required metrics (pass, fail, healed, skipped counts,
 * duration) and a coverage section mapping every scenario to a valid status.
 */

const statusArb = fc.constantFrom(
  'passed',
  'failed',
  'healed',
  'skipped',
  'not-generated',
) as fc.Arbitrary<'passed' | 'failed' | 'healed' | 'skipped' | 'not-generated'>;

const scenarioArb = fc.record({
  id: fc.string({ minLength: 1, maxLength: 10 }),
  name: fc.string({ minLength: 1, maxLength: 50 }),
  status: statusArb,
});

const unresolvedFailureArb = fc.record({
  stage: fc.constantFrom('planner', 'generator', 'healer'),
  errorMessage: fc.string({ minLength: 1, maxLength: 100 }),
});

// For timestamps, ensure completedAt > startedAt
const timestampPairArb = fc.integer({ min: 1000000000000, max: 2000000000000 }).chain((startMs) =>
  fc.integer({ min: startMs + 1, max: startMs + 600000 }).map((endMs) => ({
    startedAt: new Date(startMs).toISOString(),
    completedAt: new Date(endMs).toISOString(),
  })),
);

const buildReportInputArb = fc
  .record({
    runId: fc.uuid(),
    timestamps: timestampPairArb,
    scenariosPlanned: fc.integer({ min: 1, max: 20 }),
    testsGenerated: fc.integer({ min: 0, max: 20 }),
    testResults: fc.record({
      passing: fc.integer({ min: 0, max: 20 }),
      failing: fc.integer({ min: 0, max: 20 }),
      skipped: fc.integer({ min: 0, max: 20 }),
    }),
    healedCount: fc.integer({ min: 0, max: 10 }),
    scenarios: fc.array(scenarioArb, { minLength: 1, maxLength: 10 }),
    unresolvedFailures: fc.option(fc.array(unresolvedFailureArb, { minLength: 0, maxLength: 3 }), {
      nil: undefined,
    }),
  })
  .map((r) => ({
    runId: r.runId,
    startedAt: r.timestamps.startedAt,
    completedAt: r.timestamps.completedAt,
    scenariosPlanned: r.scenariosPlanned,
    testsGenerated: r.testsGenerated,
    testResults: r.testResults,
    healedCount: r.healedCount,
    scenarios: r.scenarios,
    unresolvedFailures: r.unresolvedFailures,
  })) as fc.Arbitrary<BuildReportInput>;

async function main(): Promise<void> {
  await fc.assert(
    fc.asyncProperty(buildReportInputArb, async (input) => {
      const report: PipelineReport = buildReport(input);

      // 1. Has runId matching input
      assert.equal(report.runId, input.runId);

      // 2. Has timestamp (non-empty string)
      assert.ok(typeof report.timestamp === 'string' && report.timestamp.length > 0);

      // 3. Has duration >= 0 (numeric)
      assert.ok(typeof report.duration === 'number');
      assert.ok(report.duration >= 0);

      // 4. Has summary with all required fields
      assert.ok(report.summary !== undefined && report.summary !== null);
      assert.ok('scenariosPlanned' in report.summary);
      assert.ok('testsGenerated' in report.summary);
      assert.ok('testsPassing' in report.summary);
      assert.ok('testsFailing' in report.summary);
      assert.ok('testsHealed' in report.summary);
      assert.ok('testsSkipped' in report.summary);

      // 5. Summary values match the input
      assert.equal(report.summary.scenariosPlanned, input.scenariosPlanned);
      assert.equal(report.summary.testsGenerated, input.testsGenerated);
      assert.equal(report.summary.testsPassing, input.testResults.passing);
      assert.equal(report.summary.testsFailing, input.testResults.failing);
      assert.equal(report.summary.testsHealed, input.healedCount);
      assert.equal(report.summary.testsSkipped, input.testResults.skipped);

      // 6. Has coverage array matching the input scenarios length
      assert.ok(Array.isArray(report.coverage));
      assert.equal(report.coverage.length, input.scenarios.length);

      // 7. Each coverage entry has scenarioId, scenarioName, and valid status
      const validStatuses = ['passed', 'failed', 'healed', 'skipped', 'not-generated'];
      for (let i = 0; i < report.coverage.length; i++) {
        const entry: ScenarioCoverage = report.coverage[i];
        assert.ok(typeof entry.scenarioId === 'string');
        assert.ok(typeof entry.scenarioName === 'string');
        assert.ok(validStatuses.includes(entry.status), `Invalid status: ${entry.status}`);
        // Verify mapping matches input
        assert.equal(entry.scenarioId, input.scenarios[i].id);
        assert.equal(entry.scenarioName, input.scenarios[i].name);
        assert.equal(entry.status, input.scenarios[i].status);
      }

      // 8. Has unresolvedFailures array (may be empty)
      assert.ok(Array.isArray(report.unresolvedFailures));
      if (input.unresolvedFailures) {
        assert.equal(report.unresolvedFailures.length, input.unresolvedFailures.length);
      } else {
        assert.equal(report.unresolvedFailures.length, 0);
      }
    }),
    { numRuns: 100 },
  );

  console.log('✓ Property 11 passed: Reporter output completeness');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
