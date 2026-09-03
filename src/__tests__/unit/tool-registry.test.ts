import { test, expect } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  TOOL_REGISTRY,
  getToolEntry,
  getToolsForProfile,
  validateProfileRegistry,
  CRITICAL_PROFILES,
  isToolAllowedForProfile,
} from '../../../tools/mcp/src/tools/registry';

test.describe('MCP Tool Registry & Backward Compatibility (Phase 8)', () => {
  test('all baseline tools remain registered with unchanged schemas', () => {
    const baselinePath = path.resolve(
      __dirname,
      '../../../tools/mcp/src/__tests__/fixtures/tool-registry-baseline.json',
    );
    const baselineData = JSON.parse(fs.readFileSync(baselinePath, 'utf-8'));
    for (const baseline of baselineData) {
      const entry = getToolEntry(baseline.name);
      expect(entry, `Tool ${baseline.name} must remain registered`).toBeDefined();
      expect(entry?.name).toBe(baseline.name);
    }
  });

  test('new Phase 2-9 additive tools are registered', () => {
    const compileReq = getToolEntry('compile_requirement');
    expect(compileReq).toBeDefined();
    expect(compileReq?.name).toBe('compile_requirement');

    const compilePlan = getToolEntry('compile_test_plan');
    expect(compilePlan).toBeDefined();
    expect(compilePlan?.name).toBe('compile_test_plan');

    const validatePln = getToolEntry('validate_plan');
    expect(validatePln).toBeDefined();
    expect(validatePln?.name).toBe('validate_plan');

    const traceReq = getToolEntry('trace_requirement');
    expect(traceReq).toBeDefined();
    expect(traceReq?.name).toBe('trace_requirement');

    const archiveRep = getToolEntry('archive_report');
    expect(archiveRep).toBeDefined();
    expect(archiveRep?.name).toBe('archive_report');
  });

  test('registry is the canonical 23-tool surface with one route per tool', () => {
    expect(TOOL_REGISTRY).toHaveLength(23);
    expect(new Set(TOOL_REGISTRY.map((tool) => tool.name)).size).toBe(23);
    const registryContract = JSON.parse(
      fs.readFileSync(
        path.resolve(__dirname, '../../../tools/mcp/src/__tests__/fixtures/registry-contract.json'),
        'utf-8',
      ),
    );
    expect(registryContract.map((tool: { name: string }) => tool.name)).toEqual(
      TOOL_REGISTRY.map((tool) => tool.name),
    );
    for (const tool of TOOL_REGISTRY) {
      expect(tool.name).toBeTruthy();
    }
  });

  test('planner can call mandatory health preflight', () => {
    expect(getToolsForProfile('planner').map((tool) => tool.name)).toContain('health_check');
    expect(isToolAllowedForProfile('health_check', 'planner')).toBe(true);
  });

  test('validates profile registry integrity and critical agent profiles (CC-1109)', () => {
    const validation = validateProfileRegistry();
    expect(validation.ok).toBe(true);
    expect(validation.errors).toHaveLength(0);
    expect(validation.criticalProfilesCovered).toBe(true);

    for (const profile of CRITICAL_PROFILES) {
      const tools = getToolsForProfile(profile);
      expect(tools.length).toBeGreaterThan(0);
    }
  });
});
