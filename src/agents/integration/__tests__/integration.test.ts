/**
 * Integration tests for end-to-end pipeline flow — Agent AI Integration Layer
 *
 * Tests automatic pipeline run, resume workflow, config generation,
 * agent validation, and protocol handler routing.
 *
 * Validates: Requirements 8.1, 8.2, 8.3, 8.5
 */

import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import { handleProtocolRequest } from '../protocol';
import { Orchestrator, OrchestratorConfig, PhaseExecutor } from '../orchestrator';
import { PipelineHookRegistry } from '../hooks';
import { saveState, resumeState, PipelineState } from '../state';
import { generateConfig, detectDrift, readSourceConfig } from '../mcp-config-generator';
import { validateAgents } from '../validator';
import { PipelinePhase, PhaseResult } from '../types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Each integration test gets an isolated report directory. The production
 * state and hook implementations honor QA_REPORT_DIR at call time.
 */
let isolatedReportDir: string | undefined;
let previousReportDir: string | undefined;

function reportDir(): string {
  if (!isolatedReportDir) throw new Error('Report directory was not initialized');
  return isolatedReportDir;
}

function mockArtifactPath(phase: PipelinePhase): string {
  return path.join(reportDir(), `mock-${phase}-artifact.json`);
}

function createMockExecutor(options?: {
  failPhase?: PipelinePhase;
  retryable?: boolean;
}): PhaseExecutor & { calls: Array<{ phase: PipelinePhase; input: unknown }> } {
  const calls: Array<{ phase: PipelinePhase; input: unknown }> = [];

  return {
    calls,
    async execute(phase: PipelinePhase, input: unknown): Promise<PhaseResult> {
      calls.push({ phase, input });

      if (options?.failPhase === phase) {
        return {
          phase,
          status: 'error',
          error: {
            code: 'MOCK_ERROR',
            message: `Mocked failure in phase '${phase}'`,
            phase,
            retryable: options.retryable ?? false,
          },
        };
      }

      return {
        phase,
        status: 'success',
        output: { mockResult: true, phase },
        artifacts: [mockArtifactPath(phase)],
      };
    },
  };
}

test.beforeEach(() => {
  previousReportDir = process.env['QA_REPORT_DIR'];
  isolatedReportDir = fs.mkdtempSync(path.join(os.tmpdir(), 'integration-reports-'));
  process.env['QA_REPORT_DIR'] = isolatedReportDir;
});

test.afterEach(() => {
  if (previousReportDir === undefined) delete process.env['QA_REPORT_DIR'];
  else process.env['QA_REPORT_DIR'] = previousReportDir;
  if (isolatedReportDir) fs.rmSync(isolatedReportDir, { recursive: true, force: true });
  isolatedReportDir = undefined;
  previousReportDir = undefined;
});

// ---------------------------------------------------------------------------
// 1. Automatic Pipeline Run
// ---------------------------------------------------------------------------

test.describe('Automatic Pipeline Run', () => {
  test('executes all 5 phases in sequence and returns success', async () => {
    const executor = createMockExecutor();
    const hooks = new PipelineHookRegistry();

    const config: OrchestratorConfig = {
      orchestrationMode: 'automatic',
      requirementPath: 'requirements/test-feature.md',
    };

    const orchestrator = new Orchestrator(config, executor, hooks);
    const response = await orchestrator.run();

    // Assert success
    expect(response.status).toBe('success');
    expect(response.phase).toBe('all');

    // Assert all 5 phases were executed in order
    const expectedPhases: PipelinePhase[] = ['plan', 'generate', 'execute', 'heal', 'report'];
    expect(executor.calls).toHaveLength(5);
    for (let i = 0; i < expectedPhases.length; i++) {
      expect(executor.calls[i].phase).toBe(expectedPhases[i]);
    }
  });

  test('emits phase:start and phase:complete events for each phase', async () => {
    const executor = createMockExecutor();
    const hooks = new PipelineHookRegistry();
    const events: Array<{ eventType: string; phase: string }> = [];

    hooks.registerHook('phase:start', (event) => {
      events.push({ eventType: event.eventType, phase: event.phase });
    });
    hooks.registerHook('phase:complete', (event) => {
      events.push({ eventType: event.eventType, phase: event.phase });
    });

    const config: OrchestratorConfig = {
      orchestrationMode: 'automatic',
      requirementPath: 'requirements/test-feature.md',
    };

    const orchestrator = new Orchestrator(config, executor, hooks);
    await orchestrator.run();

    // Should have 5 start + 5 complete events = 10 total
    const startEvents = events.filter((e) => e.eventType === 'phase:start');
    const completeEvents = events.filter((e) => e.eventType === 'phase:complete');
    expect(startEvents).toHaveLength(5);
    expect(completeEvents).toHaveLength(5);
  });
});

// ---------------------------------------------------------------------------
// 2. Resume Workflow
// ---------------------------------------------------------------------------

test.describe('Resume Workflow', () => {
  test('runs 2 phases, saves state, then resumes from phase 3', async () => {
    // Step 1: Run first 2 phases manually and save state
    const state: PipelineState = {
      runId: '550e8400-e29b-41d4-a716-446655440000',
      status: 'paused',
      currentPhase: 'generate',
      completedPhases: ['plan', 'generate'],
      artifacts: {
        plan: [],
        generate: [],
        execute: [],
        heal: [],
        report: [],
      },
      timestamp: new Date().toISOString(),
      startedAt: new Date().toISOString(),
      requirementPath: 'requirements/test-feature.md',
      orchestrationMode: 'automatic',
      errors: [],
    };

    saveState(state);

    // Step 2: Call resumeState and verify it returns phase 3 (execute)
    const resumeResult = resumeState();

    expect('error' in resumeResult).toBe(false);
    if (!('error' in resumeResult)) {
      expect(resumeResult.resumePhase).toBe('execute');
      expect(resumeResult.state.completedPhases).toEqual(['plan', 'generate']);
    }
  });

  test('resume with missing artifacts invalidates affected phases', async () => {
    // Save state with artifact paths that don't exist on disk
    const state: PipelineState = {
      runId: '660e8400-e29b-41d4-a716-446655440001',
      status: 'paused',
      currentPhase: 'execute',
      completedPhases: ['plan', 'generate', 'execute'],
      artifacts: {
        plan: [path.join(reportDir(), 'mock-plan-artifact.json')],
        generate: [path.join(reportDir(), 'nonexistent-artifact.json')], // This file doesn't exist
        execute: [path.join(reportDir(), 'mock-execute-artifact.json')],
        heal: [],
        report: [],
      },
      timestamp: new Date().toISOString(),
      startedAt: new Date().toISOString(),
      requirementPath: 'requirements/test-feature.md',
      orchestrationMode: 'automatic',
      errors: [],
    };

    // Create the plan artifact so only generate's artifact is missing
    const reportsDir = reportDir();
    fs.mkdirSync(reportsDir, { recursive: true });
    fs.writeFileSync(path.join(reportsDir, 'mock-plan-artifact.json'), '{}', 'utf-8');

    saveState(state);

    const resumeResult = resumeState();

    expect('error' in resumeResult).toBe(false);
    if (!('error' in resumeResult)) {
      // Should resume from 'generate' since its artifact is missing
      expect(resumeResult.resumePhase).toBe('generate');
      // Plan should still be in completedPhases, but generate and execute should be invalidated
      expect(resumeResult.state.completedPhases).toContain('plan');
      expect(resumeResult.state.completedPhases).not.toContain('generate');
      expect(resumeResult.state.completedPhases).not.toContain('execute');
    }
  });

  test('resume with no state file returns error', () => {
    // Ensure no state file exists in the isolated report directory.
    const statePath = path.join(reportDir(), 'pipeline-state.json');
    if (fs.existsSync(statePath)) fs.unlinkSync(statePath);

    const resumeResult = resumeState();
    expect('error' in resumeResult).toBe(true);
    if ('error' in resumeResult) {
      expect(resumeResult.error).toContain('No resumable');
    }
  });
});

// ---------------------------------------------------------------------------
// 3. Config Generation from Real .mcp.json
// ---------------------------------------------------------------------------

test.describe('Config Generation', () => {
  let tmpDir: string;

  test.beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-config-test-'));
  });

  test.afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('generates valid platform configs from source .mcp.json', () => {
    // Copy the real .mcp.json to the temp directory
    const sourcePath = path.resolve('.mcp.json');
    const tempSourcePath = path.join(tmpDir, '.mcp.json');
    fs.copyFileSync(sourcePath, tempSourcePath);

    // Generate configs for all platforms
    generateConfig({
      sourceConfigPath: tempSourcePath,
      outputDir: tmpDir,
    });

    // Verify claude config exists and has correct structure
    const claudeConfigPath = path.join(tmpDir, 'claude_desktop_config.json');
    expect(fs.existsSync(claudeConfigPath)).toBe(true);
    const claudeConfig = JSON.parse(fs.readFileSync(claudeConfigPath, 'utf-8'));
    expect(claudeConfig.mcpServers).toBeDefined();
    expect(claudeConfig._sourceHash).toBeDefined();

    // Verify cursor config exists
    const cursorConfigPath = path.join(tmpDir, '.cursor', 'mcp.json');
    expect(fs.existsSync(cursorConfigPath)).toBe(true);
    const cursorConfig = JSON.parse(fs.readFileSync(cursorConfigPath, 'utf-8'));
    expect(cursorConfig.mcpServers).toBeDefined();

    // Verify kiro config exists
    const kiroConfigPath = path.join(tmpDir, '.kiro', 'mcp.json');
    expect(fs.existsSync(kiroConfigPath)).toBe(true);
    const kiroConfig = JSON.parse(fs.readFileSync(kiroConfigPath, 'utf-8'));
    expect(kiroConfig.mcpServers).toBeDefined();

    // Verify codex config exists (TOML format)
    const codexConfigPath = path.join(tmpDir, '.codex', 'config.toml');
    expect(fs.existsSync(codexConfigPath)).toBe(true);
    const codexContent = fs.readFileSync(codexConfigPath, 'utf-8');
    expect(codexContent).toMatch(/^# Auto-generated by qa-playwright-kit/m);
    expect(codexContent).toMatch(/^# _sourceHash = "/m);
    expect(codexContent).toContain('[mcp_servers.playwright]');
    expect(codexContent).toContain('[mcp_servers.qa-playwright-kit]');

    // Verify all servers from source are present in generated configs
    const sourceServers = readSourceConfig(tempSourcePath);
    const serverNames = sourceServers.map((s) => s.name);

    for (const name of serverNames) {
      expect(claudeConfig.mcpServers[name]).toBeDefined();
      expect(cursorConfig.mcpServers[name]).toBeDefined();
      expect(kiroConfig.mcpServers[name]).toBeDefined();
      expect(codexContent).toContain(`[mcp_servers.${name}]`);
    }

    // Verify drift detection shows all up-to-date
    const drift = detectDrift({
      sourceConfigPath: tempSourcePath,
      outputDir: tmpDir,
    });
    // Claude, cursor, kiro, codex should be up-to-date; copilot is always up-to-date
    expect(drift.upToDate).toContain('claude');
    expect(drift.upToDate).toContain('cursor');
    expect(drift.upToDate).toContain('kiro');
    expect(drift.upToDate).toContain('codex');
    expect(drift.upToDate).toContain('copilot');
    expect(drift.outdated).toHaveLength(0);
  });

  test('detects drift when source changes after generation', () => {
    // Copy real .mcp.json to temp
    const sourcePath = path.resolve('.mcp.json');
    const tempSourcePath = path.join(tmpDir, '.mcp.json');
    fs.copyFileSync(sourcePath, tempSourcePath);

    // Generate configs
    generateConfig({
      sourceConfigPath: tempSourcePath,
      outputDir: tmpDir,
    });

    // Modify the source config
    const sourceContent = JSON.parse(fs.readFileSync(tempSourcePath, 'utf-8'));
    sourceContent.servers.push({ name: 'new-server', command: 'node', args: ['new.js'] });
    fs.writeFileSync(tempSourcePath, JSON.stringify(sourceContent, null, 2), 'utf-8');

    // Verify drift is detected
    const drift = detectDrift({
      sourceConfigPath: tempSourcePath,
      outputDir: tmpDir,
    });
    expect(drift.outdated.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 4. Agent Validation against Real Files
// ---------------------------------------------------------------------------

test.describe('Agent Validation', () => {
  test('validates real .github/agents/ files without errors', () => {
    const results = validateAgents({
      agentDir: '.github/agents/',
      mcpConfigPath: '.mcp.json',
      registryPath: 'tools/mcp/src/tools/registry.ts',
      fix: false,
    });

    // At least 1 file was validated (reporter.agent.md exists)
    expect(results.length).toBeGreaterThanOrEqual(1);

    // Check that reporter.agent.md was among validated files
    const reporterResult = results.find((r) => r.file.includes('reporter.agent.md'));
    expect(reporterResult).toBeDefined();

    // Reporter should have no missing-section errors
    if (reporterResult) {
      const missingSectionErrors = reporterResult.errors.filter(
        (e) => e.type === 'missing-section',
      );
      expect(missingSectionErrors).toHaveLength(0);
    }
  });

  test('validates all agent files have required sections', () => {
    const results = validateAgents({
      agentDir: '.github/agents/',
      mcpConfigPath: '.mcp.json',
      registryPath: 'tools/mcp/src/tools/registry.ts',
      fix: false,
    });

    // All files should exist
    expect(results.length).toBeGreaterThan(0);

    // Check no missing-section errors across all agent files
    for (const result of results) {
      const missingSectionErrors = result.errors.filter((e) => e.type === 'missing-section');
      expect(missingSectionErrors).toHaveLength(0);
    }
  });
});

// ---------------------------------------------------------------------------
// 5. Protocol Handler Routing
// ---------------------------------------------------------------------------

test.describe('Protocol Handler Routing', () => {
  test('query action returns manifest', async () => {
    const executor = createMockExecutor();
    const response = await handleProtocolRequest({ action: 'query' }, executor);

    expect(response.status).toBe('success');
    expect(response.manifest).toBeDefined();
    expect(response.manifest!.phases).toBeDefined();

    // Manifest should contain all 5 pipeline phases
    const phases = Object.keys(response.manifest!.phases);
    expect(phases).toContain('plan');
    expect(phases).toContain('generate');
    expect(phases).toContain('execute');
    expect(phases).toContain('heal');
    expect(phases).toContain('report');
    expect(phases).toHaveLength(5);
  });

  test('invoke with automatic mode runs full pipeline', async () => {
    const executor = createMockExecutor();
    const response = await handleProtocolRequest(
      {
        action: 'invoke',
        phase: 'plan',
        requirementPath: 'requirements/test-feature.md',
        options: { orchestrationMode: 'automatic' },
      },
      executor,
    );

    expect(response.status).toBe('success');
    expect(response.phase).toBe('all');
    // All 5 phases should have been executed
    expect(executor.calls).toHaveLength(5);
  });

  test('invoke with manual mode runs single phase', async () => {
    const executor = createMockExecutor();
    const response = await handleProtocolRequest(
      {
        action: 'invoke',
        phase: 'plan',
        requirementPath: 'requirements/test-feature.md',
        options: { orchestrationMode: 'manual' },
      },
      executor,
    );

    expect(response.status).toBe('success');
    expect(response.phase).toBe('plan');
    // Only 1 phase should have been executed
    expect(executor.calls).toHaveLength(1);
    expect(executor.calls[0].phase).toBe('plan');
  });

  test('invalid action returns error with valid actions list', async () => {
    const executor = createMockExecutor();
    const response = await handleProtocolRequest(
      { action: 'invalid' as unknown as 'invoke' },
      executor,
    );

    expect(response.status).toBe('error');
    expect(response.errors).toBeDefined();
    expect(response.errors!.length).toBeGreaterThan(0);
    // Error message should list valid actions
    expect(response.errors![0].message).toContain('invoke');
    expect(response.errors![0].message).toContain('query');
    expect(response.errors![0].message).toContain('resume');
  });

  test('resume without state file returns error', async () => {
    // Ensure no state file exists in the isolated report directory.
    const statePath = path.join(reportDir(), 'pipeline-state.json');
    if (fs.existsSync(statePath)) fs.unlinkSync(statePath);

    const executor = createMockExecutor();
    const response = await handleProtocolRequest(
      {
        action: 'resume',
        options: { runId: '550e8400-e29b-41d4-a716-446655440000' },
      },
      executor,
    );

    expect(response.status).toBe('error');
    expect(response.errors).toBeDefined();
    expect(response.errors![0].code).toBe('NO_RESUMABLE_RUN');
  });
});
