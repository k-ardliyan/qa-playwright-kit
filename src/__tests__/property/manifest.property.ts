/// <reference types="node" />

// Feature: agent-ai-integration-layer, Property 5: Manifest-registry synchronization
//
// **Validates: Requirements 2.2, 2.4**

import assert from 'node:assert/strict';
import fc from 'fast-check';
import { generateManifest } from '../../agents/pipeline/agent-manifest';
import type { CapabilityManifest } from '../../agents/pipeline/agent-manifest';

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * Core registry tools expected in the generated capability manifest phases.
 * Not every MCP tool must appear in a phase (e.g. file helpers are on-demand);
 * this list is the planning/reporting surface that Property 5 checks.
 */
const EXPECTED_REGISTRY_TOOLS: string[] = [
  'health_check',
  'get_test_failures',
  'get_test_summary',
  'list_artifacts',
  'list_requirement_status',
  'normalize_requirements',
  'parse_requirement_scenarios',
  'validate_generated_tests',
  'validate_requirement',
  'discover_pages',
  'snapshot_page',
];

/** The 5 pipeline phases that must be present */
const EXPECTED_PHASES = ['plan', 'generate', 'execute', 'heal', 'report'] as const;

/** Semver regex pattern */
const SEMVER_PATTERN = /^\d+\.\d+\.\d+$/;

/** ISO 8601 date-time pattern (basic check) */
const ISO8601_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

// ─── Property 5: Manifest-registry synchronization ────────────────────────────

async function testProperty5(): Promise<void> {
  // Get the manifest once (deterministic output)
  const manifest: CapabilityManifest = generateManifest();

  // Collect all tool names across all phases
  const allManifestToolNames: string[] = [];
  for (const phase of EXPECTED_PHASES) {
    const phaseCapability = manifest.phases[phase];
    for (const tool of phaseCapability.tools) {
      allManifestToolNames.push(tool.name);
    }
  }

  // Part A: Random subsets of expected tools exist in the manifest
  await fc.assert(
    fc.asyncProperty(fc.subarray(EXPECTED_REGISTRY_TOOLS, { minLength: 1 }), async (toolSubset) => {
      for (const toolName of toolSubset) {
        assert.ok(
          allManifestToolNames.includes(toolName),
          `Expected tool '${toolName}' to appear in at least one phase of the manifest. ` +
            `Found tools: [${allManifestToolNames.join(', ')}]`,
        );
      }
    }),
    { numRuns: 100 },
  );

  // Part B: Every tool descriptor has valid structure (non-empty name, server, description)
  await fc.assert(
    fc.asyncProperty(fc.constantFrom(...EXPECTED_PHASES), async (phase) => {
      const phaseCapability = manifest.phases[phase];
      for (const tool of phaseCapability.tools) {
        assert.ok(
          typeof tool.name === 'string' && tool.name.length > 0,
          `Tool name should be non-empty string in phase '${phase}', got: '${tool.name}'`,
        );
        assert.ok(
          typeof tool.server === 'string' && tool.server.length > 0,
          `Tool server should be non-empty string in phase '${phase}' for tool '${tool.name}', got: '${tool.server}'`,
        );
        assert.ok(
          typeof tool.description === 'string' && tool.description.length > 0,
          `Tool description should be non-empty string in phase '${phase}' for tool '${tool.name}', got: '${tool.description}'`,
        );
      }
    }),
    { numRuns: 100 },
  );

  // Part C: Manifest structure validation
  await fc.assert(
    fc.asyncProperty(fc.constant(null), async () => {
      // version is semver
      assert.ok(
        SEMVER_PATTERN.test(manifest.version),
        `Manifest version should match semver pattern, got: '${manifest.version}'`,
      );

      // generatedAt is ISO 8601
      assert.ok(
        ISO8601_PATTERN.test(manifest.generatedAt),
        `Manifest generatedAt should be ISO 8601 string, got: '${manifest.generatedAt}'`,
      );

      // Exactly 5 phases
      const phaseKeys = Object.keys(manifest.phases);
      assert.equal(
        phaseKeys.length,
        5,
        `Manifest should have exactly 5 phases, got: ${phaseKeys.length} (${phaseKeys.join(', ')})`,
      );

      // Each phase has required fields
      for (const phase of EXPECTED_PHASES) {
        const cap = manifest.phases[phase];
        assert.ok(
          typeof cap.description === 'string' && cap.description.length > 0,
          `Phase '${phase}' should have non-empty description`,
        );
        assert.ok(Array.isArray(cap.mcpServers), `Phase '${phase}' should have mcpServers array`);
        assert.ok(Array.isArray(cap.tools), `Phase '${phase}' should have tools array`);
      }

      // Exactly 2 orchestration modes
      assert.equal(
        manifest.orchestrationModes.length,
        2,
        `Manifest should have exactly 2 orchestration modes, got: ${manifest.orchestrationModes.length}`,
      );

      // Prerequisites has required fields
      assert.ok(
        typeof manifest.prerequisites.nodeVersion === 'string' &&
          manifest.prerequisites.nodeVersion.length > 0,
        'Prerequisites should have non-empty nodeVersion',
      );
      assert.ok(
        Array.isArray(manifest.prerequisites.requiredEnvVars),
        'Prerequisites should have requiredEnvVars array',
      );
      assert.ok(
        Array.isArray(manifest.prerequisites.dependencies),
        'Prerequisites should have dependencies array',
      );
    }),
    { numRuns: 100 },
  );

  // Part D: All expected tools exist in the manifest (full coverage check)
  await fc.assert(
    fc.asyncProperty(fc.constantFrom(...EXPECTED_REGISTRY_TOOLS), async (expectedTool) => {
      assert.ok(
        allManifestToolNames.includes(expectedTool),
        `Expected registry tool '${expectedTool}' must be present in the manifest. ` +
          `Tools found across all phases: [${allManifestToolNames.join(', ')}]`,
      );
    }),
    { numRuns: 100 },
  );

  console.log('✓ Property 5 passed: Manifest-registry synchronization');
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('Manifest Property Tests');
  console.log('──────────────────────────────────────────');

  await testProperty5();

  console.log('──────────────────────────────────────────');
  console.log('✓ All manifest property tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
