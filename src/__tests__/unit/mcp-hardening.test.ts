/**
 * Tests for the MCP hardening pass + pipeline_status tool:
 * - registry exposes pipeline_status under expected profiles
 * - pipelineStatus reads state/summary/auth and reports resume safety
 * - hardened write paths reject out-of-bounds output (synthesize/archive/pages)
 */

import { test, expect } from '@playwright/test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { getToolEntry, TOOL_REGISTRY } from '../../../tools/mcp/src/tools/registry';
import { pipelineStatus } from '../../../tools/mcp/src/tools/pipeline-status';

test.describe('pipeline_status tool', () => {
  test('registered, read-only, and exposed to planner/reporter/all', () => {
    const entry = getToolEntry('pipeline_status');
    expect(entry).toBeDefined();
    expect(entry!.readOnly).toBe(true);
    expect(entry!.profiles).toContain('all');
    expect(entry!.profiles).toContain('planner');
    expect(entry!.profiles).toContain('reporter');
    // unique names across registry
    const names = TOOL_REGISTRY.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });

  test('returns no_state when no state file exists (isolated dir)', () => {
    const isolate = fs.mkdtempSync(path.join(os.tmpdir(), 'pwkit-pstatus-'));
    const prevReport = process.env['QA_REPORT_DIR'];
    const prevCwd = process.cwd();
    process.env['QA_REPORT_DIR'] = path.join(isolate, 'reports');
    process.chdir(isolate);
    try {
      const out = pipelineStatus();
      expect(out.status).toBe('no_state');
      expect(out.environment).toBeDefined();
      expect(out.lastRun).toBeNull();
    } finally {
      process.chdir(prevCwd);
      if (prevReport === undefined) delete process.env['QA_REPORT_DIR'];
      else process.env['QA_REPORT_DIR'] = prevReport;
      fs.rmSync(isolate, { recursive: true, force: true });
    }
  });

  test('reports phase, staleness, missing artifacts, and last run from disk', () => {
    // getRepoRoot() is a singleton (real repo) — isolate only the reports dir
    // via QA_REPORT_DIR, mirroring how agents/integration/state.ts is tested.
    const isolate = fs.mkdtempSync(path.join(os.tmpdir(), 'pwkit-pstatus-'));
    const prevReport = process.env['QA_REPORT_DIR'];
    process.env['QA_REPORT_DIR'] = isolate;

    fs.writeFileSync(
      path.join(isolate, 'pipeline-state.json'),
      JSON.stringify({
        runId: 'run-123',
        status: 'paused',
        currentPhase: null,
        completedPhases: ['plan'],
        artifacts: {
          plan: ['specs/missing-plan.md'],
          generate: [],
          execute: [],
          heal: [],
          report: [],
        },
        timestamp: new Date().toISOString(),
        startedAt: new Date().toISOString(),
        requirementPath: 'requirements/__nonexistent-zz__.md',
        requirementHash: 'not-the-real-hash',
        orchestrationMode: 'automatic',
        errors: [],
      }),
      'utf-8',
    );
    fs.writeFileSync(
      path.join(isolate, 'test-summary.json'),
      JSON.stringify({
        total: 4,
        passed: 3,
        failed: 1,
        skipped: 0,
        passRate: 75,
        timestamp: new Date().toISOString(),
      }),
      'utf-8',
    );

    try {
      const out = pipelineStatus();
      expect(out.status).toBe('success');
      expect(out.state!.runId).toBe('run-123');
      expect(out.state!.completedPhases).toEqual(['plan']);
      expect(out.state!.requirementUpToDate).toBe(false); // requirement file missing
      expect(out.state!.missingArtifacts).toEqual(['specs/missing-plan.md']);
      expect(out.lastRun!.total).toBe(4);
      expect(out.lastRun!.failed).toBe(1);
      expect(out.message).toContain('Resume from phase: generate');
    } finally {
      if (prevReport === undefined) delete process.env['QA_REPORT_DIR'];
      else process.env['QA_REPORT_DIR'] = prevReport;
      fs.rmSync(isolate, { recursive: true, force: true });
    }
  });
});

test.describe('hardened write paths', () => {
  test('synthesize_requirement rejects outputPath outside requirements/', async () => {
    const entry = getToolEntry('synthesize_requirement');
    expect(entry).toBeDefined();
    const out = (await entry!.handler({
      featureName: 'login',
      outputPath: 'src/support/evil.md',
    })) as { status: string; error?: { code: string } };
    expect(out.status).toBe('error');
    expect(out.error?.code).toBe('PATH_NOT_ALLOWED');
  });

  test('generate_page_object rejects outputPath outside tests/pages/', async () => {
    const entry = getToolEntry('generate_page_object');
    expect(entry).toBeDefined();
    // outputPath is validated BEFORE the catalog read: an out-of-pages path
    // must return INVALID_PATH even when featureName/pageName don't resolve.
    const out = (await entry!.handler({
      featureName: 'nonexistent-feature-zz',
      pageName: 'page',
      outputPath: 'src/support/Evil.ts',
    })) as { status: string; error?: { code: string } };
    expect(out.status).toBe('error');
    expect(out.error?.code).toBe('INVALID_PATH');
    const msg = JSON.stringify(out);
    expect(msg).toContain('pages');
  });
});
