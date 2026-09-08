import { test, expect } from '@playwright/test';
import { getToolEntry, setActiveMcpProfile } from '../../../tools/mcp/src/tools/registry';
import { loadNotesFile } from '../../../tools/mcp/src/utils/test-notes';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const TMP_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-mcp-note-'));
const TMP_NOTES = path.join(TMP_ROOT, 'test-notes.json');

test.afterAll(() => {
  fs.rmSync(TMP_ROOT, { recursive: true, force: true });
});

/** The registry handler (includes the provenance guard) under test. */
function handler(args: unknown): { status: string; code?: string } {
  const entry = getToolEntry('record_ai_note');
  if (!entry) throw new Error('record_ai_note not registered');
  return entry.handler(args as Record<string, unknown>) as { status: string; code?: string };
}

/**
 * Behavior tests for the record_ai_note MCP handler — REJECTION paths only,
 * so no disk writes happen (success paths are covered by the src twin tests).
 */
test.describe('record_ai_note MCP handler (validation paths)', () => {
  test('rejects invalid enum values with INVALID_ENUM instead of normalizing', () => {
    expect(handler({ message: 'x', scope: 'everything' }).code).toBe('INVALID_ENUM');
    expect(handler({ message: 'x', source: 'qa-bot' }).code).toBe('INVALID_ENUM');
    expect(handler({ message: 'x', priority: 'urgent' }).code).toBe('INVALID_ENUM');
    expect(handler({ message: 'x', confidence: 'maybe' }).code).toBe('INVALID_ENUM');
    expect(handler({ message: 'x', status: 'guessing' }).code).toBe('INVALID_ENUM');
    expect(handler({ message: 'x', kind: 'product-ux' }).code).toBe('INVALID_KIND');
  });

  test('rejects input with neither message nor structured fields', () => {
    const out = handler({ scenarioId: 'SC-01' });
    expect(out.status).toBe('error');
    expect(out.code).toBe('INVALID_INPUT');
  });

  test('rejects affected* fields that are not string arrays', () => {
    const out = handler({
      message: 'x',
      scope: 'run',
      affectedTests: 'TC-001',
    });
    expect(out.status).toBe('error');
    expect(out.code).toBe('INVALID_FIELD');
  });

  test('provenance guard: source must match the active agent-critical profile', () => {
    setActiveMcpProfile('reporter');
    try {
      const forged = handler({ message: 'x', source: 'healer' });
      expect(forged.status).toBe('error');
      expect(forged.code).toBe('INVALID_SOURCE');

      // Matching source passes the guard and reaches the run lookup —
      // RUN_NOT_FOUND proves it got past provenance without writing anything.
      const matching = handler({
        message: 'x',
        source: 'reporter',
        scope: 'run',
        runId: 'run-20990101-000000-000',
      });
      expect(matching.code).toBe('RUN_NOT_FOUND');
    } finally {
      setActiveMcpProfile(undefined);
    }
  });

  test('profile all/debug does not enforce provenance', () => {
    setActiveMcpProfile('debug');
    try {
      const out = handler({
        message: 'dedupe probe unique-marker-xyz',
        source: 'healer',
        scope: 'run',
        runId: 'run-20990101-000000-000',
      });
      // Healer source accepted under a non-agent profile → guard skipped
      expect(out.code).toBe('RUN_NOT_FOUND');
    } finally {
      setActiveMcpProfile(undefined);
    }
  });

  test('MCP sidecar parse round-trip preserves runId', () => {
    fs.writeFileSync(
      TMP_NOTES,
      JSON.stringify({
        version: 1,
        runId: 'run-20260906-000000-001',
        updatedAt: new Date().toISOString(),
        notes: { 'SC-01::general': { qaNotes: 'n', aiNotes: '' } },
      }),
      'utf-8',
    );
    const loaded = loadNotesFile(TMP_NOTES);
    expect(loaded.runId).toBe('run-20260906-000000-001');
  });
});
