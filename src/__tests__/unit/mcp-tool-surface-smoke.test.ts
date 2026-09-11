/**
 * Contract smoke test for the qa-playwright-kit MCP tool surface.
 *
 * Why this exists: root-level tests assert the registry *shape* (names,
 * schemas, profiles) but nothing ever CALLS every handler. That blind spot is
 * how `list_requirement_status` shipped reporting `hasPlan: false` for plans
 * the runtime actually writes (flat `specs/<feature>-test-plan.json`).
 *
 * Rules for this file:
 * - Read-only tools are called with no args; a structured error is acceptable
 *   (missing input, no state on disk) — a THROW or a malformed payload is not.
 * - Write tools are never called with valid args. They are probed with `{}`,
 *   which every write tool rejects before touching disk (verified: the guard
 *   clauses all run before any fs write). They must return the envelope with
 *   `status: 'error'`, never throw.
 * - Every tool must return a plain object (or array) — never `undefined`.
 */

import { test, expect } from '@playwright/test';
import { TOOL_REGISTRY, getToolEntry } from '../../../tools/mcp/src/tools/registry';
import { dispatchTool } from '../../../tools/mcp/src/tools/dispatch';

const WRITE_TOOLS = TOOL_REGISTRY.filter((t) => t.readOnly === false).map((t) => t.name);
const READ_TOOLS = TOOL_REGISTRY.filter((t) => t.readOnly !== false).map((t) => t.name);

test.describe('MCP tool surface — contract smoke', () => {
  test('registry exposes the canonical 25-tool surface', () => {
    expect(TOOL_REGISTRY.length).toBe(25);
    expect(new Set(TOOL_REGISTRY.map((t) => t.name)).size).toBe(25);
  });

  test('every read-only tool answers without throwing', async () => {
    const failures: string[] = [];

    for (const name of READ_TOOLS) {
      const { payload } = await dispatchTool(name, undefined, 'all');
      if (payload === undefined || payload === null) {
        failures.push(`${name}: returned ${String(payload)}`);
        continue;
      }
      if (typeof payload !== 'object') {
        failures.push(`${name}: payload is ${typeof payload}`);
        continue;
      }
      const record = payload as Record<string, unknown>;
      // Tools that fail on missing input must still use the error envelope.
      const hasEnvelope =
        typeof record.status === 'string' || Array.isArray(payload) || 'error' in record;
      if (!hasEnvelope) {
        failures.push(`${name}: payload has no status/array envelope`);
      }
    }

    expect(failures, `read-only tools with malformed payloads:\n${failures.join('\n')}`).toEqual(
      [],
    );
  });

  test('every write tool rejects empty args instead of writing', async () => {
    const failures: string[] = [];

    for (const name of WRITE_TOOLS) {
      const { payload } = await dispatchTool(name, {}, 'all');
      const record = (payload ?? {}) as Record<string, unknown>;
      if (record.status !== 'error') {
        failures.push(`${name}: accepted {} with status=${String(record.status)}`);
      }
      if (payload === undefined || payload === null) {
        failures.push(`${name}: returned ${String(payload)}`);
      }
    }

    expect(
      failures,
      `write tools that did not fail closed on empty args:\n${failures.join('\n')}`,
    ).toEqual([]);
  });

  test('unknown tool returns UNKNOWN_TOOL instead of throwing', async () => {
    const { payload, isError } = await dispatchTool('not_a_real_tool', undefined, 'all');
    expect(isError).toBe(true);
    expect(payload).toMatchObject({
      status: 'error',
      error: { code: 'UNKNOWN_TOOL' },
    });
  });

  test('profile gating blocks tools outside the active profile', async () => {
    // `health_check` is an admin/planner tool; the `minimal` profile must not
    // reach it. This is the enforcement that keeps QA from calling maintainer
    // surfaces by accident.
    const { isError, payload } = await dispatchTool('health_check', undefined, 'minimal');
    expect(isError).toBe(true);
    expect(payload).toMatchObject({
      status: 'error',
      error: { code: 'MCP_TOOL_NOT_ALLOWED_FOR_PROFILE' },
    });
  });

  test('every registry entry has the fields the MCP boundary needs', () => {
    const problems: string[] = [];

    for (const tool of TOOL_REGISTRY) {
      if (!tool.name || !tool.description) problems.push(`${tool.name}: missing name/description`);
      if (!tool.handler) problems.push(`${tool.name}: missing handler`);
      if (!tool.inputSchema || tool.inputSchema.type !== 'object') {
        problems.push(`${tool.name}: inputSchema is not an object schema`);
      }
      if (!tool.stability) problems.push(`${tool.name}: missing stability`);
      if (tool.stability === 'deprecated' && !tool.replacement) {
        problems.push(`${tool.name}: deprecated without replacement`);
      }
      if (typeof tool.readOnly !== 'boolean') problems.push(`${tool.name}: readOnly not boolean`);
    }

    expect(problems, `registry entries missing contract fields:\n${problems.join('\n')}`).toEqual(
      [],
    );
  });

  test('every registry entry is reachable by name through getToolEntry', () => {
    const unreachable = TOOL_REGISTRY.map((t) => t.name).filter((name) => !getToolEntry(name));
    expect(unreachable).toEqual([]);
  });
});
