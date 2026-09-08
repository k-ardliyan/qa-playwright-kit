/**
 * MCP Runtime Adapters — Native Semantic Workflow
 *
 * Production wiring of the semantic workflow engine into the MCP runtime.
 * Each adapter maps one semantic stage to the existing MCP tool functions
 * (snapshot_page / discover_pages / compile_requirement / compile_test_plan /
 * validate_plan / validate_generated_tests / run_tests / get_test_failures /
 * get_test_summary / trace_requirement / archive_report).
 *
 * The adapters return durable references and hashes only — never raw browser
 * refs, credentials, or full payloads. The controller (WorkflowController)
 * owns stage transitions; this file owns the tool calls.
 *
 * @module agents/integration/mcp-adapters
 */

import * as fs from 'fs';
import * as path from 'path';
import { computeSourceHash } from '@/contracts';
import { discoverExploreEvidence, deriveFeatureSlug } from './explore-evidence';
import {
  writeValidateRunManifest,
  readValidateRunManifest,
  assertCurrentValidateManifest,
} from './validate-manifest';
import type {
  WorkflowAdapters,
  ExploreAdapterInput,
  ModelAdapterInput,
  ModelAdapterResult,
  ChallengeAdapterInput,
  ChallengeAdapterResult,
  GenerateAdapterInput,
  GenerateAdapterResult,
  ValidateAdapterInput,
  ValidateAdapterResult,
} from './workflow-controller';
import type { EvidenceReference } from './explore-policy';
import { buildReport, writeReportMarkdown, writeReportJson } from '../reporter/report-builder';

/**
 * Raised by the Model adapter when the Planner handoff artifact (the test
 * plan) is missing. The controller treats this as a PAUSED run waiting for
 * external Planner output — never as a terminal failure.
 */
export class ModelHandoffError extends Error {
  constructor(
    public readonly requiredArtifactPath: string,
    public readonly handoffType: 'planner-required' | 'adapter-failed' = 'planner-required',
  ) {
    super(
      `[mcp-adapters] Test plan not found at ${requiredArtifactPath}. Run the Planner (Model stage) to produce the plan before Challenge.`,
    );
    this.name = 'ModelHandoffError';
  }
}

/**
 * Tool-function seam. The MCP package cannot import root TS, so the runtime
 * injects the actual tool functions; tests inject fakes. Each function is
 * optional — a missing function makes its stage fail closed with an
 * actionable error instead of silently skipping the gate.
 */
export interface McpToolFunctions {
  snapshotPage?: (args: Record<string, unknown>) => Promise<unknown>;
  discoverPages?: (args: Record<string, unknown>) => Promise<unknown>;
  compileRequirement?: (args: Record<string, unknown>) => Promise<unknown>;
  compileTestPlan?: (args: Record<string, unknown>) => Promise<unknown>;
  validatePlan?: (args: Record<string, unknown>) => Promise<unknown>;
  validateGeneratedTests?: (args: Record<string, unknown>) => Promise<unknown>;
  getTestFailures?: (args: Record<string, unknown>) => Promise<unknown>;
  getTestSummary?: (args: Record<string, unknown>) => Promise<unknown>;
  traceRequirement?: (args: Record<string, unknown>) => Promise<unknown>;
  recordAiNote?: (args: Record<string, unknown>) => Promise<unknown>;
  /** Real Playwright runner invocation scoped to this run (driver implements it). */
  runPlaywrightTests?: (args: { testFiles: string[]; resultsDir: string }) => Promise<{
    ok: boolean;
    total?: number;
    passed: number;
    failed: number;
    skipped: number;
    timedOut?: number;
    interrupted?: number;
    resultsJsonPath?: string;
    message?: string;
  }>;
}

export interface McpAdapterOptions {
  tools: McpToolFunctions;
  /** Repo root for resolving requirement/plan paths. Defaults to cwd. */
  repoRoot?: string;
}

function repoRootOf(options: McpAdapterOptions): string {
  return options.repoRoot ?? process.cwd();
}

function requireTool<K extends keyof McpToolFunctions>(
  tools: McpToolFunctions,
  name: K,
): NonNullable<McpToolFunctions[K]> {
  const fn = tools[name];
  if (!fn) {
    throw new Error(
      `[mcp-adapters] Tool function '${name}' is not wired into the MCP runtime. The semantic workflow cannot run without it.`,
    );
  }
  return fn as NonNullable<McpToolFunctions[K]>;
}

function asRecord(value: unknown): Record<string, unknown> {
  return (value ?? {}) as Record<string, unknown>;
}

function firstString(record: Record<string, unknown>, key: string): string | undefined {
  const v = record[key];
  return typeof v === 'string' ? v : undefined;
}

function firstNumber(record: Record<string, unknown>, key: string): number | undefined {
  const v = record[key];
  return typeof v === 'number' ? v : undefined;
}

function readHash(absPath: string): string | null {
  try {
    return computeSourceHash(fs.readFileSync(absPath, 'utf-8'));
  } catch {
    return null;
  }
}

function isContainedFile(root: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return (
    relative !== '' &&
    relative !== '..' &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

function inspectExplicitGeneratedFile(
  repoRoot: string,
  file: string,
):
  | { ok: true; absolutePath: string; relativePath: string }
  | { ok: false; mode: 'blocked' | 'awaiting-generator'; reason: string } {
  const testsRoot = path.join(repoRoot, 'tests');
  if (typeof file !== 'string' || file.trim() === '') {
    return { ok: false, mode: 'blocked', reason: 'Generated file must be a non-empty path.' };
  }
  const absolutePath = path.resolve(repoRoot, file);
  const relativePath = path.relative(repoRoot, absolutePath).replace(/\\/g, '/');
  if (
    !isContainedFile(testsRoot, absolutePath) ||
    !relativePath.startsWith('tests/') ||
    !relativePath.endsWith('.spec.ts')
  ) {
    return {
      ok: false,
      mode: 'blocked',
      reason: `Generated file must be a regular tests/**/*.spec.ts file: ${file}`,
    };
  }
  if (!fs.existsSync(absolutePath)) {
    return {
      ok: false,
      mode: 'awaiting-generator',
      reason: `Expected generated file is missing: ${file}`,
    };
  }
  let stat: fs.Stats;
  try {
    stat = fs.statSync(absolutePath);
  } catch {
    return { ok: false, mode: 'blocked', reason: `Unable to inspect generated file: ${file}` };
  }
  if (!stat.isFile()) {
    return { ok: false, mode: 'blocked', reason: `Generated path is not a regular file: ${file}` };
  }
  try {
    const realTestsRoot = fs.realpathSync(testsRoot);
    const realFile = fs.realpathSync(absolutePath);
    if (!isContainedFile(realTestsRoot, realFile)) {
      return {
        ok: false,
        mode: 'blocked',
        reason: `Generated file resolves outside tests/: ${file}`,
      };
    }
  } catch {
    return {
      ok: false,
      mode: 'blocked',
      reason: `Unable to resolve generated file safely: ${file}`,
    };
  }
  return { ok: true, absolutePath, relativePath };
}

/** Recursively list .spec.ts files under a directory (repo-relative paths). */
function listSpecFiles(dirAbs: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (/\.spec\.ts$/.test(entry.name)) {
        out.push(path.relative(process.cwd(), full).replace(/\\/g, '/'));
      }
    }
  };
  walk(dirAbs);
  return out.sort();
}

/**
 * Resolve a per-run results directory. Validate refuses a missing/unsafe runId
 * rather than falling back to the shared workflow directory (PC-B1/B2).
 */
export function resolveValidateResultsDir(repoRoot: string, runId: string | undefined): string {
  if (!runId || !/^[A-Za-z0-9._-]+$/.test(runId)) {
    throw new Error('VALIDATE_RUN_ID_REQUIRED: semantic Validate requires a safe runId.');
  }
  return path.join(repoRoot, 'artifacts', 'test-results', 'workflow', runId);
}

/**
 * Build the production adapter set from injected MCP tool functions.
 */
export function createMcpAdapters(options: McpAdapterOptions): WorkflowAdapters {
  const root = repoRootOf(options);
  const tools = options.tools;

  return {
    async explore(input: ExploreAdapterInput): Promise<{ evidence: EvidenceReference[] }> {
      const discovered = discoverExploreEvidence(input.requirementPath, input.role, root);
      if (discovered.evidence.length > 0) {
        return { evidence: discovered.evidence };
      }
      // No durable evidence (or only role-mismatched catalogs) — run live
      // exploration via the MCP tools.
      const feature = discovered.feature;
      const startPage = input.startPage ?? '/';
      const baseUrl = process.env.BASE_URL?.replace(/\/+$/, '') ?? '';
      if (!baseUrl) {
        throw new Error(
          '[mcp-adapters] Explore requires BASE_URL (set in config/environments/{APP_ENV}.env) to run live snapshot_page/discover_pages.',
        );
      }
      const url = `${baseUrl}${startPage.startsWith('/') ? startPage : '/' + startPage}`;
      const pageName = startPage.replace(/^\//, '') || 'home';

      if (input.role) {
        await requireTool(
          tools,
          'snapshotPage',
        )({
          url,
          featureName: feature,
          pageName,
          role: input.role,
        });
      } else {
        await requireTool(
          tools,
          'snapshotPage',
        )({
          url,
          featureName: feature,
          pageName,
        });
      }
      return {
        evidence: discoverExploreEvidence(input.requirementPath, input.role, root).evidence,
      };
    },

    async model(input: ModelAdapterInput): Promise<ModelAdapterResult> {
      const compileRequirement = requireTool(tools, 'compileRequirement');
      const compileTestPlan = requireTool(tools, 'compileTestPlan');

      const reqResult = asRecord(
        await compileRequirement({ requirementPath: input.requirementPath }),
      );
      const reqData = asRecord(reqResult.data);
      const sourceHash = firstString(reqData, 'sourceHash') ?? firstString(reqResult, 'sourceHash');
      if (!sourceHash) {
        throw new Error(
          '[mcp-adapters] compile_requirement did not return a sourceHash — cannot link Model to the requirement.',
        );
      }

      const feature = deriveFeatureSlug(input.requirementPath);
      const planPath = path.join('specs', `${feature}-test-plan.md`).replace(/\\/g, '/');
      const planAbs = path.join(root, planPath);
      if (!fs.existsSync(planAbs)) {
        throw new ModelHandoffError(planPath);
      }
      const planHash = readHash(planAbs);
      if (!planHash) {
        throw new Error(`[mcp-adapters] Cannot hash test plan at ${planPath}.`);
      }

      const planResult = asRecord(
        await compileTestPlan({ testPlanPath: planPath, requirementPath: input.requirementPath }),
      );
      const planData = asRecord(planResult.data);
      const scenarios = Array.isArray(planData.scenarios) ? planData.scenarios : [];
      const coverageGaps = Array.isArray(planData.coverageGaps) ? planData.coverageGaps : [];

      return {
        planPath,
        planHash,
        scenarioCount: scenarios.length,
        coverageGapCount: coverageGaps.length,
        requirementHash: sourceHash,
      };
    },

    async challenge(input: ChallengeAdapterInput): Promise<ChallengeAdapterResult> {
      const validatePlan = requireTool(tools, 'validatePlan');
      const compileTestPlan = requireTool(tools, 'compileTestPlan');

      const result = asRecord(
        await validatePlan({
          testPlanPath: input.planPath,
          requirementPath: input.requirementPath,
        }),
      );
      const diagnostics = Array.isArray(result.diagnostics)
        ? (result.diagnostics as Array<{ code: string; severity: 'error' | 'warning' | 'info' }>)
        : [];
      const data = asRecord(result.data);
      const assumptionCount = firstNumber(data, 'assumptionsCount') ?? 0;
      const coverageGapCount = firstNumber(data, 'coverageGapsCount') ?? 0;

      // PC-03 (Task 3.1): fail closed on the validator RESULT STATUS, not just
      // on diagnostics. A result with status=error but no diagnostics (or a
      // malformed result) must never allow Generate.
      const validatorStatus = firstString(result, 'status');
      if (validatorStatus === 'error') {
        throw new Error(
          `[mcp-adapters] validate_plan returned status=error: ${String(result.message ?? 'validation failed')}. Challenge is blocked.`,
        );
      }
      if (validatorStatus !== 'success' && validatorStatus !== 'warning') {
        throw new Error(
          `[mcp-adapters] validate_plan returned unexpected status '${String(validatorStatus)}'. Challenge fails closed.`,
        );
      }

      // Assertion count comes from the compiled plan (sum of scenario assertions).
      const planResult = asRecord(
        await compileTestPlan({
          testPlanPath: input.planPath,
          requirementPath: input.requirementPath,
        }),
      );
      const planData = asRecord(planResult.data);
      const scenarios = Array.isArray(planData.scenarios) ? planData.scenarios : [];
      const assertionCount = scenarios.reduce(
        (n, s) =>
          n +
          (Array.isArray((s as Record<string, unknown>).assertions)
            ? ((s as Record<string, unknown>).assertions as unknown[]).length
            : 0),
        0,
      );

      return {
        diagnostics,
        assumptions: [],
        coverageGaps: [],
        assertionCount,
        assumptionCount,
        coverageGapCount,
        validatorStatus,
      };
    },

    async generate(input: GenerateAdapterInput): Promise<GenerateAdapterResult> {
      const validateGeneratedTests = requireTool(tools, 'validateGeneratedTests');
      // Resume path: validate ONLY explicit files supplied by the external
      // Generator, never scan all of tests/ and treat unrelated specs as output.
      if (input.generatedFiles && input.generatedFiles.length > 0) {
        for (const file of input.generatedFiles) {
          const inspected = inspectExplicitGeneratedFile(root, file);
          if (!inspected.ok) {
            return {
              mode: inspected.mode,
              generatedFiles: input.generatedFiles,
              testCount: 0,
              reason: inspected.reason,
            };
          }
        }
        for (const file of input.generatedFiles) {
          const result = asRecord(await validateGeneratedTests({ filePath: file }));
          if (result.status === 'error') {
            return {
              mode: 'failed',
              generatedFiles: input.generatedFiles,
              testCount: 0,
              reason: `Generated test validation failed for ${file}: ${String(result.message ?? 'structural violations found')}`,
            };
          }
        }
        return {
          mode: 'completed',
          generatedFiles: input.generatedFiles,
          testCount: input.generatedFiles.length,
          reason: 'External generated files exist and validate successfully.',
        };
      }

      const result = asRecord(await validateGeneratedTests({}));
      if (result.status === 'error') {
        const count = firstNumber(result, 'validatedCount') ?? 0;
        throw new Error(
          `[mcp-adapters] validate_generated_tests failed: ${String(result.message ?? 'structural violations found')} (${count} file(s) checked). Fix the generated specs and re-run Generate.`,
        );
      }
      // PC-02: this adapter has no real generator wired yet. Validating
      // pre-existing specs must NEVER claim a Generate pass — report an
      // explicit awaiting-generator handoff so the run pauses truthfully.
      const testsDir = path.join(root, 'tests');
      const feature = deriveFeatureSlug(input.requirementPath);
      const featurePattern = new RegExp(`^tests[\\/]${feature}(-[^\\/]+)?\\.spec\\.ts$`);
      const allFiles = fs.existsSync(testsDir) ? listSpecFiles(testsDir) : [];
      const existingFiles = allFiles.filter((f) => featurePattern.test(f.replace(/\\/g, '/')));
      return {
        mode: 'awaiting-generator',
        generatedFiles: existingFiles,
        testCount: existingFiles.length,
        reason:
          'No generator is wired into the semantic runtime yet. Run the Generator agent to produce tests/<feature>[-<role>].spec.ts, then resume.',
      };
    },

    async validate(input: ValidateAdapterInput): Promise<ValidateAdapterResult> {
      const getTestFailures = requireTool(tools, 'getTestFailures');
      const traceRequirement = requireTool(tools, 'traceRequirement');
      const runPlaywrightTests = requireTool(tools, 'runPlaywrightTests');

      // Task B1/B2: every semantic Validate run gets its own isolated result
      // directory derived solely from the controller runId.
      const resultsDir = resolveValidateResultsDir(root, input.runId);
      const startedAt = new Date().toISOString();
      const summaryPath = path.join(resultsDir, 'results.json');
      const manifestPath = writeValidateRunManifest(root, {
        runId: input.runId as string,
        requirementPath: input.requirementPath,
        generatedFiles: input.generatedFiles,
        resultsDir,
        summaryPath,
        startedAt,
      });
      const run = await runPlaywrightTests({
        testFiles: input.generatedFiles,
        resultsDir,
      });
      if (!run.ok) {
        throw new Error(
          `[mcp-adapters] Playwright produced no current-run JSON evidence: ${run.message ?? 'unknown runner error'}.`,
        );
      }

      // B4/B5: failures and summaries must be attributed to THIS run's
      // manifest — write the completed manifest after runner execution
      // (Playwright wipes --output on launch), then verify it.
      const completedAt = new Date().toISOString();
      writeValidateRunManifest(root, {
        runId: input.runId as string,
        requirementPath: input.requirementPath,
        generatedFiles: input.generatedFiles,
        resultsDir,
        summaryPath,
        startedAt,
        completedAt,
      });

      const currentManifest = readValidateRunManifest(manifestPath);
      assertCurrentValidateManifest(currentManifest, {
        runId: input.runId as string,
        requirementPath: input.requirementPath,
        resultsDir,
      });
      const failures = asRecord(await getTestFailures({ resultsDir }));
      const failureList = Array.isArray(failures.failures) ? failures.failures : [];
      const unresolvedFailures = failureList.length;
      const summary: Record<string, unknown> = {
        runId: input.runId,
        requirementPath: input.requirementPath,
        resultsDir,
        summaryPath,
        startedAt,
        completedAt,
        total: run.total ?? run.passed + run.failed + run.skipped,
        passed: run.passed,
        failed: run.failed,
        skipped: run.skipped,
        timedOut: run.timedOut ?? 0,
        interrupted: run.interrupted ?? 0,
        testCases: failureList,
      };
      await traceRequirement({ requirementPath: input.requirementPath });

      // Production Analyze seam: record one run-level reporter insight and
      // build the canonical report artifacts. If the note/report seam is not
      // wired, return explicit incomplete proof; never fabricate completion.
      let analysisCompleted = false;
      let analysisVerified = false;
      let analysisVerdict: ValidateAdapterResult['analysisVerdict'] = 'unverifiable';
      const recordAiNote = tools.recordAiNote;
      if (recordAiNote) {
        const note = asRecord(
          await recordAiNote({
            scope: 'run',
            source: 'reporter',
            kind: 'stability',
            observation: `Current run executed ${summary.total} test(s): ${summary.passed} passed, ${summary.failed} failed.`,
            evidence: resultsDir,
            impact:
              unresolvedFailures > 0
                ? 'Unresolved current-run failure remains.'
                : 'No current-run failure detected.',
            recommendation:
              unresolvedFailures > 0
                ? 'Review current-run failure evidence before QA decision.'
                : 'Proceed to explicit QA review.',
            priority: unresolvedFailures > 0 ? 'high' : 'medium',
            confidence: 'high',
            status: 'observed',
          }),
        );
        if (note.status === 'success') {
          const total = typeof summary.total === 'number' ? summary.total : 0;
          const passed = typeof summary.passed === 'number' ? summary.passed : 0;
          const failed = typeof summary.failed === 'number' ? summary.failed : 0;
          const skipped = typeof summary.skipped === 'number' ? summary.skipped : 0;
          const report = buildReport({
            runId: input.runId as string,
            startedAt,
            completedAt,
            requirementPath: input.requirementPath,
            scenariosPlanned: total,
            testsGenerated: input.generatedFiles.length,
            testResults: { passing: passed, failing: failed, skipped },
            healedCount: 0,
            scenarios: [],
            unresolvedFailures: [],
            analysis: {
              completed: true,
              runInsightsRecorded: 1,
              passedScenariosReviewed: passed,
              skippedForInsufficientEvidence: 0,
            },
          });
          writeReportMarkdown(report);
          writeReportJson(report);
          analysisCompleted = true;
          analysisVerified = true;
          analysisVerdict = 'complete';
        }
      }

      return {
        runId: input.runId,
        startedAt,
        resultsDir,
        generatedFiles: input.generatedFiles,
        executionCommand: `playwright test ${input.generatedFiles.join(' ')}`,
        unresolvedFailures,
        substage: unresolvedFailures > 0 ? 'heal' : 'qa-review',
        passed: run.passed,
        failed: run.failed,
        skipped: run.skipped,
        failureList,
        testSummary: summary,
        analysisCompleted,
        analysisVerified,
        analysisVerdict,
      };
    },
  };
}
