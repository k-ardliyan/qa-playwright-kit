/// <reference types="node" />

/**
 * Workflow Runner — production caller for the native semantic engine.
 *
 * Runs the Explore → Model → Challenge → Generate → Validate workflow through
 * the real MCP tool functions. This is the wiring the audit demanded: the
 * WorkflowController is invoked from a real runtime path, not only from tests.
 *
 * Usage:
 *   npx tsx tools/scripts/workflow-run.ts requirements/<feature>.md            # full run (manual mode)
 *   npx tsx tools/scripts/workflow-run.ts requirements/<feature>.md --automatic
 *   npx tsx tools/scripts/workflow-run.ts requirements/<feature>.md --stage explore
 *   npx tsx tools/scripts/workflow-run.ts requirements/<feature>.md --evidence <path> [-e <path> ...]
 *   npx tsx tools/scripts/workflow-run.ts --help
 *
 * Exit codes: 0 = success / in-progress, 1 = blocked/failed, 2 = usage error.
 *
 * The MCP `workflow_run` tool shells this driver; the driver itself is the
 * single place that wires real tools into the adapters.
 *
 * @module scripts/workflow-run
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';

import { loadEnvironment } from '../../src/utils/env-loader';
import { WorkflowController } from '../../src/agents/integration/workflow-controller';
import { createMcpAdapters } from '../../src/agents/integration/mcp-adapters';
import {
  parsePlaywrightJsonReport,
  type PlaywrightRunCounters,
} from '../../src/agents/integration/playwright-counters';
import { loadState, type PipelineState } from '../../src/agents/integration/state';
import { resolveAllowedPath } from '../mcp/src/utils/safety';

/* eslint-disable @typescript-eslint/require-await */

// ─── MCP tool functions (real implementations) ──────────────────────────────

const TOOLS = {
  snapshotPage: async (args: Record<string, unknown>) => {
    const { snapshotPage } = await import('../mcp/src/tools/snapshot-page');
    return snapshotPage(args);
  },
  discoverPages: async (args: Record<string, unknown>) => {
    const { discoverPages } = await import('../mcp/src/tools/discover-pages');
    return discoverPages(args);
  },
  compileRequirement: async (args: Record<string, unknown>) => {
    const { compileRequirement } = await import('../mcp/src/tools/compile-requirement');
    return compileRequirement(args);
  },
  compileTestPlan: async (args: Record<string, unknown>) => {
    const { compileTestPlan } = await import('../mcp/src/tools/compile-test-plan');
    return compileTestPlan(args);
  },
  validatePlan: async (args: Record<string, unknown>) => {
    const { validatePlan } = await import('../mcp/src/tools/validate-plan');
    return validatePlan(args as Parameters<typeof validatePlan>[0]);
  },
  validateGeneratedTests: async (args: Record<string, unknown>) => {
    const { validateGeneratedTests } = await import('../mcp/src/tools/validate-generated-tests');
    const filePath = typeof args?.filePath === 'string' ? args.filePath : undefined;
    return validateGeneratedTests(filePath);
  },
  getTestFailures: async (args: Record<string, unknown>) => {
    const { getTestFailures } = await import('../mcp/src/tools/get-test-failures');
    const resultsDir = typeof args.resultsDir === 'string' ? args.resultsDir : undefined;
    return getTestFailures(resultsDir);
  },
  getTestSummary: async () => {
    const { getTestSummary } = await import('../mcp/src/tools/get-test-summary');
    return getTestSummary();
  },
  traceRequirement: async (args: Record<string, unknown>) => {
    const { traceRequirement } = await import('../mcp/src/tools/trace-requirement');
    return traceRequirement(args);
  },
  recordAiNote: async (args: Record<string, unknown>) => {
    const { recordAiNote } = await import('../mcp/src/tools/record-ai-note');
    return recordAiNote(args);
  },
  runPlaywrightTests: async (args: {
    testFiles: string[];
    resultsDir: string;
    requirementPath?: string;
  }) => {
    if (args.testFiles.length === 0) {
      return { ok: false, passed: 0, failed: 0, skipped: 0, message: 'No generated files to run.' };
    }
    fs.mkdirSync(args.resultsDir, { recursive: true });
    const resultsJsonPath = path.join(args.resultsDir, 'results.json');
    // Multi-reporter: CustomReporter must stay attached so the run updates
    // artifacts/reports/{custom-dashboard.html,test-summary.json} like any
    // other run. Playwright's `--reporter` OVERWRITES instead of appending
    // (repeating the flag keeps only the last one), so the JSON reporter is
    // added with `--add-reporter` on top of the custom one. Order matters:
    // custom FIRST, `--add-reporter=json` second.
    const customReporterPath = path.join(process.cwd(), 'src', 'support', 'custom-reporter.ts');
    const result = spawnSync(
      process.execPath,
      [
        path.join(process.cwd(), 'node_modules', '@playwright', 'test', 'cli.js'),
        'test',
        ...args.testFiles,
        '--output',
        args.resultsDir,
        `--reporter=${customReporterPath}`,
        '--add-reporter=json',
      ],
      {
        cwd: process.cwd(),
        encoding: 'utf-8',
        shell: false,
        timeout: 600_000,
        env: {
          ...process.env,
          PLAYWRIGHT_JSON_OUTPUT_FILE: resultsJsonPath,
          REQUIREMENT_PATH: args.requirementPath ?? process.env.REQUIREMENT_PATH ?? '',
          // Bind the CustomReporter summary to the SEMANTIC run identity so the
          // archive gate's sidecar-runId check matches `--run-id` (semantic run
          // ids are not run-YYYYMMDD-…; PLAYWRIGHT_RUN_ID flows through runMeta
          // into the summary and the sidecar stamp).
          PLAYWRIGHT_RUN_ID: process.env.PLAYWRIGHT_RUN_ID ?? process.env.SEMANTIC_RUN_ID ?? '',
        },
      },
    );
    // Fallback for Playwright versions/configs that emit JSON to stdout.
    if (!fs.existsSync(resultsJsonPath) && result.stdout?.trim().startsWith('{')) {
      fs.writeFileSync(resultsJsonPath, result.stdout.trim() + '\n', 'utf-8');
    }
    let counters: PlaywrightRunCounters = {
      total: 0,
      passed: 0,
      failed: 0,
      skipped: 0,
      timedOut: 0,
      interrupted: 0,
      resultsJsonPath,
    };
    if (fs.existsSync(resultsJsonPath)) {
      try {
        counters = parsePlaywrightJsonReport(
          JSON.parse(fs.readFileSync(resultsJsonPath, 'utf-8')),
          resultsJsonPath,
        );
      } catch {
        // Invalid/missing JSON is not current-run proof; return a failed run.
      }
    }
    const runnerFailed = result.status !== 0;
    const hasCurrentEvidence = counters.total > 0;
    return {
      // A nonzero Playwright exit is a current test failure, not an adapter
      // crash. Continue to failure inspection when JSON evidence exists.
      ok: hasCurrentEvidence,
      total: counters.total,
      passed: counters.passed,
      failed:
        counters.failed +
        counters.timedOut +
        counters.interrupted +
        (runnerFailed && hasCurrentEvidence ? 0 : 0),
      skipped: counters.skipped,
      timedOut: counters.timedOut,
      interrupted: counters.interrupted,
      resultsJsonPath,
      message:
        hasCurrentEvidence && runnerFailed
          ? 'Playwright completed with failing tests.'
          : hasCurrentEvidence
            ? undefined
            : (result.stderr ?? result.stdout ?? '').slice(0, 500),
    };
  },
};

// ─── Arg parsing ─────────────────────────────────────────────────────────────

interface WorkflowRunArgs {
  requirementPath: string | null;
  stage: 'explore' | 'model' | 'challenge' | 'generate' | 'validate' | null;
  automatic: boolean;
  evidence: string[];
  runId: string | null;
  resume: boolean;
  roleFilter: string[];
  help: boolean;
}

const USAGE = `Usage:
  npx tsx tools/scripts/workflow-run.ts <requirements/feature.md> [options]

Options:
  --automatic      Run all stages without pausing (orchestrationMode automatic)
  --stage <name>   Run a single semantic stage only (explore|model|challenge|generate|validate)
  --evidence <p>   Durable Explore evidence path (repeatable). When omitted the
                   Explore policy auto-discovers artifacts/selector-catalog/<feature>/
  --run-id <uuid>  Explicit run identity. Fresh runs print their runId; pass it
                   back with --resume to continue after a process exit.
  --resume         Continue the persisted run (requires --run-id).
  -h, --help       Show this message

Exit codes: 0 = success, 1 = blocked/failed, 2 = usage error.
`;

function parseArgs(argv: string[]): WorkflowRunArgs {
  const args: WorkflowRunArgs = {
    requirementPath: null,
    stage: null,
    automatic: false,
    evidence: [],
    runId: null,
    resume: false,
    roleFilter: [],
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--automatic') args.automatic = true;
    else if (arg === '--stage') {
      const value = argv[++i];
      if (!value || !['explore', 'model', 'challenge', 'generate', 'validate'].includes(value)) {
        throw new Error(
          `Invalid --stage '${String(value)}'. Expected explore|model|challenge|generate|validate.`,
        );
      }
      args.stage = value as WorkflowRunArgs['stage'];
    } else if (arg === '--evidence' || arg === '-e') {
      const value = argv[++i];
      if (!value) throw new Error('--evidence requires a path argument.');
      args.evidence.push(value);
    } else if (arg === '--run-id') {
      const value = argv[++i];
      if (!value) throw new Error('--run-id requires a value.');
      args.runId = value;
    } else if (arg === '--resume') {
      args.resume = true;
    } else if (arg === '--role') {
      const value = argv[++i];
      if (!value) throw new Error('--role requires a value.');
      args.roleFilter.push(value);
    } else if (arg === '-h' || arg === '--help') args.help = true;
    else if (!arg.startsWith('--') && !args.requirementPath) args.requirementPath = arg;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

// ─── Driver ──────────────────────────────────────────────────────────────────

async function main(): Promise<number> {
  let args: WorkflowRunArgs;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    process.stderr.write(`Error: ${err instanceof Error ? err.message : String(err)}\n\n${USAGE}`);
    return 2;
  }

  if (args.help) {
    process.stdout.write(USAGE);
    return 0;
  }

  if (!args.requirementPath) {
    process.stderr.write(`Error: requirement file is required.\n\n${USAGE}`);
    return 2;
  }

  const repoRoot = path.resolve(__dirname, '..', '..');
  const reqAbs = path.resolve(repoRoot, args.requirementPath);
  if (!fs.existsSync(reqAbs)) {
    process.stderr.write(`Error: requirement file not found: ${args.requirementPath}\n`);
    return 2;
  }

  // Load the pinned environment (BASE_URL, role credentials) so live Explore
  // and auth-aware stages work the same as every other CLI in the repo.
  try {
    loadEnvironment();
  } catch (err) {
    process.stderr.write(
      `Warning: could not load environment: ${err instanceof Error ? err.message : String(err)}\n`,
    );
  }

  // Resolve evidence paths against the repo root.
  const evidence = args.evidence.map((e) => {
    const resolved = resolveAllowedPath(e, 'selector-catalog', { mustExist: true });
    if (!resolved.ok) {
      throw new Error(`Invalid --evidence path '${e}': ${resolved.error.message}`);
    }
    return { path: resolved.relativePath.replace(/\\/g, '/') };
  });

  // Resume: load the persisted semantic state and validate the run identity.
  let initialState: PipelineState | undefined;
  if (args.resume) {
    if (!args.runId) {
      process.stderr.write('Error: --resume requires --run-id <uuid>.\n');
      return 2;
    }
    const loaded = loadState();
    if (!loaded) {
      process.stderr.write('Error: no persisted pipeline state found to resume.\n');
      return 2;
    }
    if (loaded.runId !== args.runId) {
      process.stderr.write(
        `Error: requested runId '${args.runId}' does not match the persisted run '${loaded.runId}'.\n`,
      );
      return 2;
    }
    if (!loaded.workflow || loaded.workflow.schemaVersion !== 'qa.workflow/v1') {
      process.stderr.write(
        'Error: persisted state is not a native semantic run (qa.workflow/v1). Start fresh.\n',
      );
      return 2;
    }
    initialState = loaded;
  }

  // Expose the semantic runId to reporter processes spawned by the Validate
  // adapter (PLAYWRIGHT_RUN_ID → runMeta.runId → summary + sidecar stamp) so
  // the archive gate can match evidence against this exact run.
  if (args.runId) {
    process.env.PLAYWRIGHT_RUN_ID = args.runId;
  }

  const adapters = createMcpAdapters({ tools: TOOLS, repoRoot });
  const controller = new WorkflowController(
    {
      orchestrationMode: args.automatic ? 'automatic' : 'manual',
      requirementPath: args.requirementPath,
      runId: args.runId ?? undefined,
      repoRoot,
    },
    adapters,
    initialState,
  );

  // New runs generate their runId inside the controller — publish it now so
  // the Validate adapter's reporter subprocess carries the same identity.
  if (!process.env.PLAYWRIGHT_RUN_ID) {
    process.env.PLAYWRIGHT_RUN_ID = controller.getState().runId;
  }

  const runInput = {
    requirementPath: args.requirementPath,
    orchestrationMode: (args.automatic ? 'automatic' : 'manual') as 'manual' | 'automatic',
    ...(evidence.length > 0 ? { evidence } : {}),
    ...(args.roleFilter.length > 0 ? { roleFilter: args.roleFilter } : {}),
    ...(args.resume ? { resume: true } : {}),
  };

  let response;
  try {
    response = args.stage
      ? await controller.runStage(args.stage, runInput)
      : await controller.run(runInput);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    response = {
      status: 'error',
      runId: controller.getState().runId,
      workflowStage: null,
      workflowStatus: 'failed',
      phase: 'all',
      errors: [{ code: 'WORKFLOW_DRIVER_ERROR', message, retryable: false }],
    };
  }

  // Every response carries the run identity; blocked/paused responses also
  // print the exact resume command so continuation is one copy-paste away.
  const runId = controller.getState().runId;
  const resumeCommand = `npx tsx tools/scripts/workflow-run.ts ${args.requirementPath} --resume --run-id ${runId}`;
  const enriched = {
    ...response,
    runId,
    ...(response.workflowStatus === 'blocked' ||
    response.workflowStatus === 'failed' ||
    response.workflowStatus === 'needs-review'
      ? { resumeCommand }
      : {}),
  };

  // Human-readable guidance on stderr for blocked semantic runs: the AI-agent
  // path (Hermes) is the default, but the manual no-AI path is first-class.
  if (response.workflowStatus === 'blocked' || response.workflowStatus === 'needs-review') {
    const handoff = (response as { result?: { handoff?: { handoffType?: string } } }).result
      ?.handoff;
    if (handoff?.handoffType === 'awaiting-generator') {
      process.stderr.write(
        [
          '',
          '─'.repeat(66),
          '⏸  Pipeline dijeda: Generate menunggu test spec (awaiting-generator).',
          '',
          '  Jalur 1 — AI agent (default & direkomendasikan):',
          '    Jalankan Generator agent (Hermes) untuk menulis spec,',
          '    lalu resume dengan perintah di resumeCommand.',
          '',
          '  Jalur 2 — Manual tanpa AI (first-class):',
          `    1. Tulis spec sesuai nextRequiredAction (lihat`,
          `       .github/agents/generator.agent.md untuk konvensi lengkap).`,
          `    2. Verifikasi: validate_generated_tests (atau biarkan resume`,
          `       yang memvalidasi otomatis).`,
          `    3. Resume: ${resumeCommand}`,
          '─'.repeat(66),
          '',
        ].join('\n') + '\n',
      );
    }
  }

  // NDJSON contract: stdout carries EXACTLY ONE line — the JSON response.
  // All logs go to stderr (the MCP tool parses only the last stdout line).
  process.stdout.write(JSON.stringify(enriched) + '\n');
  return response.status === 'error' ? 1 : 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    process.stderr.write(`Fatal: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(2);
  });
