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
import argumentInventory from '../../../tools/mcp/src/__tests__/fixtures/tool-argument-inventory.json';
import { pipelineStatus } from '../../../tools/mcp/src/tools/pipeline-status';
import { traceRequirement } from '../../../tools/mcp/src/tools/trace-requirement';
import { resolveFileInspectPath } from '../../../tools/mcp/src/tools/_internal/file-inspect-path';
import {
  generateManifest,
  MANIFEST_OMITTED_ON_DEMAND_TOOLS,
} from '../../agents/integration/manifest';

function withProcessEnv(values: Record<string, string | undefined>, run: () => void): void {
  const previous = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    run();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function makeStatusWorkspace(pin?: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pwkit-pstatus-env-'));
  fs.mkdirSync(path.join(root, 'config', 'environments'), { recursive: true });
  if (pin !== undefined) {
    fs.writeFileSync(path.join(root, 'config', 'environments', '.active-env'), pin, 'utf-8');
  }
  return root;
}

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

  test('registry schemas cover every handler argument read', () => {
    for (const item of argumentInventory as Array<{ name: string; reads: string[] }>) {
      const entry = getToolEntry(item.name);
      expect(entry, item.name).toBeDefined();
      const properties = Object.keys(entry!.inputSchema.properties);
      expect(properties.sort(), item.name).toEqual([...item.reads].sort());
    }
  });

  test('trace schema removes unsupported resultsDir', () => {
    const entry = getToolEntry('trace_requirement');
    expect(Object.keys(entry!.inputSchema.properties)).not.toContain('resultsDir');
  });

  test('manifest covers every canonical registry tool with exact metadata', () => {
    const manifest = generateManifest();
    const tools = new Map(
      Object.values(manifest.phases)
        .flatMap((phase) => phase.tools)
        .map((tool) => [tool.name, tool]),
    );
    const omitted = new Set<string>(MANIFEST_OMITTED_ON_DEMAND_TOOLS);
    expect(tools.size + omitted.size).toBe(TOOL_REGISTRY.length);
    for (const entry of TOOL_REGISTRY) {
      if (omitted.has(entry.name)) continue;
      expect(tools.get(entry.name)).toEqual({
        server: 'qa-playwright-kit',
        name: entry.name,
        description: entry.description,
      });
    }
    expect(manifest.phases.plan.tools.map((tool) => tool.name)).toContain('pipeline_status');
  });

  test('returns no_state when no state file exists (isolated dir)', () => {
    const isolate = fs.mkdtempSync(path.join(os.tmpdir(), 'pwkit-pstatus-'));
    const prevReport = process.env['QA_REPORT_DIR'];
    const prevCwd = process.cwd();
    process.env['QA_REPORT_DIR'] = path.join(isolate, 'reports');
    process.chdir(isolate);
    try {
      const out = pipelineStatus({ repoRoot: isolate, pinFileContents: null });
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

  test('resolves auth roles from the pinned environment without reading credentials', () => {
    const isolate = makeStatusWorkspace('staging');
    fs.mkdirSync(path.join(isolate, '.auth', 'staging'), { recursive: true });
    fs.writeFileSync(
      path.join(isolate, '.auth', 'staging', 'finance.json'),
      '{"cookies":[]}',
      'utf-8',
    );
    fs.mkdirSync(path.join(isolate, '.auth', 'local'), { recursive: true });
    fs.writeFileSync(path.join(isolate, '.auth', 'local', 'wrong.json'), '{}', 'utf-8');
    try {
      withProcessEnv({ APP_ENV: undefined, CI: undefined }, () => {
        const out = pipelineStatus({ repoRoot: isolate });
        // finance.json has empty cookies+origins → structurally malformed → unknown readiness
        expect(out.environment).toEqual({
          appEnv: 'staging',
          authDir: '.auth/staging',
          authRoles: ['finance'],
          authRoleStatus: [
            {
              role: 'finance',
              status: 'malformed',
              ready: null,
              reason: 'Storage state contains neither cookies nor origin storage',
            },
          ],
        });
      });
    } finally {
      fs.rmSync(isolate, { recursive: true, force: true });
    }
  });

  test('flags expired session cookies as not-ready and hints re-login', () => {
    const isolate = makeStatusWorkspace('dev');
    fs.mkdirSync(path.join(isolate, '.auth', 'dev'), { recursive: true });
    const past = Math.floor(Date.now() / 1000) - 3600;
    fs.writeFileSync(
      path.join(isolate, '.auth', 'dev', 'finance.json'),
      JSON.stringify({
        cookies: [
          { name: 'sid', value: 'x', expires: past },
          { name: 'csrf', value: 'y', expires: past },
        ],
        origins: [],
      }),
      'utf-8',
    );
    try {
      withProcessEnv({ APP_ENV: undefined, CI: undefined }, () => {
        const out = pipelineStatus({ repoRoot: isolate });
        expect(out.environment?.authRoleStatus[0]).toMatchObject({ role: 'finance', ready: false });
        expect(out.message).toContain('npm run auth:setup');
      });
    } finally {
      fs.rmSync(isolate, { recursive: true, force: true });
    }
  });

  test('reports unknown readiness for localStorage-only sessions', () => {
    const isolate = makeStatusWorkspace('local');
    fs.mkdirSync(path.join(isolate, '.auth', 'local'), { recursive: true });
    fs.writeFileSync(
      path.join(isolate, '.auth', 'local', 'user.json'),
      JSON.stringify({
        cookies: [],
        origins: [{ origin: 'https://app.test', localStorage: [{ name: 'token', value: 't' }] }],
      }),
      'utf-8',
    );
    try {
      withProcessEnv({ APP_ENV: undefined, CI: undefined }, () => {
        const out = pipelineStatus({ repoRoot: isolate });
        expect(out.environment?.authRoleStatus[0]).toMatchObject({ role: 'user', ready: null });
        expect(out.message).toContain('npm run auth:verify');
      });
    } finally {
      fs.rmSync(isolate, { recursive: true, force: true });
    }
  });

  test('uses default local auth directory when pin is absent', () => {
    const isolate = makeStatusWorkspace();
    fs.mkdirSync(path.join(isolate, '.auth', 'local'), { recursive: true });
    fs.writeFileSync(path.join(isolate, '.auth', 'local', 'admin.json'), '{}', 'utf-8');
    try {
      withProcessEnv({ APP_ENV: undefined, CI: undefined }, () => {
        const out = pipelineStatus({ repoRoot: isolate });
        expect(out.environment).toEqual({
          appEnv: 'local',
          authDir: '.auth/local',
          authRoles: ['admin'],
          authRoleStatus: [
            {
              role: 'admin',
              status: 'malformed',
              ready: null,
              reason: 'Storage state contains neither cookies nor origin storage',
            },
          ],
        });
      });
    } finally {
      fs.rmSync(isolate, { recursive: true, force: true });
    }
  });

  test('OS APP_ENV overrides the active pin', () => {
    const isolate = makeStatusWorkspace('dev');
    fs.mkdirSync(path.join(isolate, '.auth', 'production'), { recursive: true });
    fs.writeFileSync(path.join(isolate, '.auth', 'production', 'ops.json'), '{}', 'utf-8');
    try {
      withProcessEnv({ APP_ENV: 'production', CI: undefined }, () => {
        const out = pipelineStatus({ repoRoot: isolate });
        expect(out.environment?.appEnv).toBe('production');
        expect(out.environment?.authRoles).toEqual(['ops']);
        expect(out.environment?.authRoleStatus[0]).toMatchObject({ role: 'ops', ready: null });
      });
    } finally {
      fs.rmSync(isolate, { recursive: true, force: true });
    }
  });

  test('CI ignores the active pin and invalid pins fail closed to local', () => {
    const ciRoot = makeStatusWorkspace('staging');
    const invalidRoot = makeStatusWorkspace('not-a-real-env');
    try {
      withProcessEnv({ APP_ENV: undefined, CI: 'true' }, () => {
        expect(pipelineStatus({ repoRoot: ciRoot }).environment?.appEnv).toBe('local');
      });
      withProcessEnv({ APP_ENV: undefined, CI: undefined }, () => {
        expect(pipelineStatus({ repoRoot: invalidRoot }).environment?.appEnv).toBe('local');
      });
    } finally {
      fs.rmSync(ciRoot, { recursive: true, force: true });
      fs.rmSync(invalidRoot, { recursive: true, force: true });
    }
  });

  test('reports phase, staleness, missing artifacts, and last run from disk', () => {
    const isolate = fs.mkdtempSync(path.join(os.tmpdir(), 'pwkit-pstatus-'));
    const prevReport = process.env['QA_REPORT_DIR'];
    process.env['QA_REPORT_DIR'] = path.join(isolate, 'artifacts', 'reports');
    fs.mkdirSync(path.join(isolate, 'artifacts', 'reports'), { recursive: true });
    fs.writeFileSync(
      path.join(isolate, 'artifacts', 'reports', 'pipeline-state.json'),
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
      path.join(isolate, 'artifacts', 'reports', 'test-summary.json'),
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
      expect(out.state!.requirementUpToDate).toBe(false);
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
    // outputPath is validated BEFORE touching the catalog.
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

  test('trace_requirement rejects removed resultsDir instead of ignoring it', () => {
    const out = traceRequirement({
      requirementsText: '# REQ-TRACE-001: Trace\n\n## Kriteria Penerimaan\n- **AC-01:** Check',
      resultsDir: 'artifacts/test-results',
    } as Record<string, unknown>);
    expect(out.status).toBe('error');
    expect(out.diagnostics?.[0]?.message).toContain('resultsDir');
  });

  test('trace_requirement summaryPath is confined to reports/test-summary.json', () => {
    const out = traceRequirement({
      requirementsText: '# REQ-TRACE-001: Trace\n\n## Kriteria Penerimaan\n- **AC-01:** Check',
      summaryPath: '../package.json',
    });
    expect(out.status).toBe('error');
  });

  test('file inspection paths use the shared workspace safety resolver', () => {
    expect(resolveFileInspectPath('../package.json').ok).toBe(false);
    expect(resolveFileInspectPath('tests/data/../package.json').ok).toBe(false);
  });
});
