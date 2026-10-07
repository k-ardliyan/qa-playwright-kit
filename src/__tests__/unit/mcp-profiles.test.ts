import { test, expect } from '@playwright/test';
import {
  TOOL_REGISTRY,
  getToolsForProfile,
  getActiveMcpProfile,
  setActiveMcpProfile,
  isToolAllowedForProfile,
} from '../../../tools/mcp/src/tools/registry';
import { dispatchTool } from '../../../tools/mcp/src/tools/dispatch';

test.describe('Custom MCP Profiles & Runtime Enforcement (CF-101 - CF-105)', () => {
  test.afterEach(() => {
    setActiveMcpProfile('all');
    delete process.env.MCP_PROFILE;
  });

  test('CF-104: all sees complete tool set (20+ tools)', () => {
    const allTools = getToolsForProfile('all');
    expect(allTools.length).toBe(TOOL_REGISTRY.length);
    expect(allTools.length).toBeGreaterThanOrEqual(20);
  });

  test('CF-102: planner only sees planner tools', () => {
    const plannerTools = getToolsForProfile('planner');
    const names = plannerTools.map((t) => t.name);

    expect(names).toContain('compile_requirement');
    expect(names).toContain('compile_test_plan');
    expect(names).toContain('validate_plan');
    expect(names).toContain('validate_requirement');
    expect(names).toContain('trace_requirement');
    expect(names).toContain('snapshot_page');
    expect(names).toContain('discover_pages');
    expect(names).toContain('list_seeds');

    // Planner should not see execution/reporter-exclusive tools
    expect(names).not.toContain('archive_report');
    expect(names).not.toContain('get_test_summary');
  });

  test('CF-102: generator only sees generator tools', () => {
    const genTools = getToolsForProfile('generator');
    const names = genTools.map((t) => t.name);

    expect(names).toContain('compile_requirement');
    expect(names).toContain('compile_test_plan');
    expect(names).toContain('validate_generated_tests');
    expect(names).toContain('list_test_fixtures');
    expect(names).toContain('list_seeds');
    expect(names).toContain('inspect_file');

    expect(names).not.toContain('archive_report');
    expect(names).not.toContain('validate_requirement');
  });

  test('CF-102: healer only sees healer tools', () => {
    const healerTools = getToolsForProfile('healer');
    const names = healerTools.map((t) => t.name);

    expect(names).toContain('get_test_failures');
    expect(names).toContain('validate_generated_tests');
    expect(names).toContain('trace_requirement');
    expect(names).toContain('snapshot_page');

    expect(names).not.toContain('discover_pages');
    expect(names).not.toContain('archive_report');
  });

  test('CF-102: reporter only sees reporter tools', () => {
    const reporterTools = getToolsForProfile('reporter');
    const names = reporterTools.map((t) => t.name);

    expect(names).toContain('get_test_summary');
    expect(names).toContain('get_test_failures');
    expect(names).toContain('list_artifacts');
    expect(names).toContain('archive_report');
    expect(names).toContain('trace_requirement');

    expect(names).not.toContain('discover_pages');
    expect(names).not.toContain('generate_page_object');
  });

  test('CF-103: blocked tool invocation returns MCP_TOOL_NOT_ALLOWED_FOR_PROFILE', async () => {
    setActiveMcpProfile('planner');
    expect(isToolAllowedForProfile('archive_report', 'planner')).toBe(false);

    const result = await dispatchTool(
      'archive_report',
      {
        runId: 'test-run',
        reportPath: 'artifacts/reports/pipeline-report-test.md',
      },
      'planner',
    );

    expect(result.isError).toBe(true);
    const payload = result.payload as { status: string; error?: { code: string; message: string } };
    expect(payload.status).toBe('error');
    expect(payload.error?.code).toBe('MCP_TOOL_NOT_ALLOWED_FOR_PROFILE');
    expect(payload.error?.message).toContain('archive_report');
  });

  test('CF-101: resolves active profile from MCP_PROFILE env var', () => {
    setActiveMcpProfile(undefined);
    process.env.MCP_PROFILE = 'reporter';
    expect(getActiveMcpProfile()).toBe('reporter');

    process.env.MCP_PROFILE = 'generator';
    expect(getActiveMcpProfile()).toBe('generator');

    delete process.env.MCP_PROFILE;
    expect(getActiveMcpProfile()).toBe('all');
  });

  test('CF-101: unknown profile throws config error', () => {
    setActiveMcpProfile(undefined);
    process.env.MCP_PROFILE = 'unknown_super_agent';
    expect(() => getActiveMcpProfile()).toThrow(/Unknown MCP_PROFILE/);

    expect(() => getToolsForProfile('non_existent_profile')).toThrow(/Unknown profile/);
  });
});
