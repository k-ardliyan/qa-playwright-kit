import type {
  FullConfig,
  FullResult,
  Reporter,
  Suite,
  TestCase,
  TestResult,
  TestStep,
} from '@playwright/test/reporter';
import fs from 'node:fs';
import path from 'node:path';
import { buildCiHtml } from './custom-dashboard/build-ci-html';
import { buildLocalHtml } from './custom-dashboard/build-local-html';
import { listReportHistory } from '../agents/reporter/report-history';
import {
  generateRunId,
  listArchivedRunIds,
  loadArchivedSummary,
} from '../agents/reporter/report-archive';
import {
  bakeAutoAiNotes,
  buildRunInsights,
  historyKey,
  type RunHistoryContext,
} from '../agents/reporter/ai-notes';
import {
  emptyTestNotesFile,
  isStaleSidecar,
  loadLatestTestNotes,
  mergeTestNotes,
  resetLatestTestNotes,
  stampLatestTestNotesRunId,
} from '../agents/reporter/test-notes';
import { clearPendingRun, readPendingRun } from '../agents/reporter/run-context';
import type {
  AffectedLayer,
  CollectedTestCase,
  CollectedTestData,
  Priority,
  ReportMode,
  RunMeta,
  TestSummary,
} from './custom-dashboard/types';
import { resolveFailureSource } from './custom-dashboard/failure-source';
import { streamTelemetryEvent } from './streaming/live-telemetry';
import { logger } from '../utils/logger';
import { canonicalRoleName } from '../shared/utils/role-credentials';
import { resolveWorkspaceReportDir } from '../shared/workspace-paths';

import {
  collectSteps,
  collectErrors,
  resolveModuleFromPath,
  resolveFeatureFromPath,
  deriveActualFailureMessage,
  formatErrorMessage,
} from './reporter/collect';
import {
  reportDir,
  dashboardPath,
  summaryPath,
  htmlReportDir,
  materializeAttachments,
  collectAttachments,
  ensureReportDirectory,
} from './reporter/attachments';
import { forcePlaywrightHtmlToLight } from './reporter/theme-patch';

function buildRunMeta(tests: CollectedTestData[]): RunMeta {
  const playwrightRunId = process.env.PLAYWRIGHT_RUN_ID?.trim();
  const githubRunId = process.env.GITHUB_RUN_ID?.trim();
  return {
    appEnv: process.env.APP_ENV?.trim() || 'unknown',
    runId: playwrightRunId || githubRunId || undefined,
    requirementPath: process.env.REQUIREMENT_PATH?.trim() || undefined,
    ci: process.env.CI === 'true',
    totalDurationMs: tests.reduce((sum, t) => sum + (t.duration || 0), 0),
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Load the latest archived run (excluding the current one) as trend context —
 * status per scenario key + pass rate. Non-blocking: any failure yields
 * undefined and the run insights simply skip cross-run trend signals.
 */
function loadRunHistory(currentRunId: string): RunHistoryContext | undefined {
  try {
    const prevId = listArchivedRunIds().find((id) => id !== currentRunId);
    if (!prevId) return undefined;
    const prevSummary = loadArchivedSummary(prevId);
    if (!prevSummary || !Array.isArray(prevSummary.testCases)) return undefined;
    const statusByKey: Record<string, string> = {};
    for (const tc of prevSummary.testCases as Array<Record<string, unknown>>) {
      const key = historyKey(
        typeof tc['scenarioId'] === 'string' ? (tc['scenarioId'] as string) : undefined,
        typeof tc['testId'] === 'string' ? (tc['testId'] as string) : undefined,
        typeof tc['role'] === 'string' ? (tc['role'] as string) : undefined,
      );
      if (key.startsWith('::')) continue;
      statusByKey[key] = (tc['status'] as string) || '';
    }
    return {
      previousPassRate: (prevSummary['passRate'] as number) ?? undefined,
      previousStatusByKey: Object.keys(statusByKey).length > 0 ? statusByKey : undefined,
    };
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Annotation extraction helpers
// ---------------------------------------------------------------------------

function getAnnotation(test: TestCase, type: string): string {
  return (test.annotations ?? []).find((a) => a.type === type)?.description ?? '';
}

function safeParseJson<T>(raw: string, fallback: T): T {
  if (!raw || raw.trim() === '') return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/**
 * Derive a testId from the test title when the annotation is absent.
 * Matches the pattern "TC-LOGIN-001: ..." or "TC-AUTH-EXT-002: ..."
 */
function deriveTestId(title: string): string {
  return title.match(/^(TC-[A-Z0-9-]+)/)?.[1] ?? '';
}

function parseAffectedLayer(raw: string): AffectedLayer[] {
  const fromJson = safeParseJson<AffectedLayer[]>(raw, []);
  if (fromJson.length > 0) return fromJson;
  if (!raw) return [];
  if (raw.includes(',')) {
    return raw
      .split(',')
      .map((s) => s.trim().toUpperCase())
      .filter((s): s is AffectedLayer => ['FE', 'BE', 'DB', 'API'].includes(s));
  }
  const one = raw.trim().toUpperCase();
  if (['FE', 'BE', 'DB', 'API'].includes(one)) return [one as AffectedLayer];
  return [];
}

function normalizePriority(raw: string): Priority {
  const p = (raw || 'medium').toLowerCase();
  if (p === 'high' || p === 'medium' || p === 'low') return p;
  return 'medium';
}

/**
 * Keep a single configured role as the default for tests that omit role metadata.
 * Empty roles remain unscoped for true general or genuinely mixed-role runs.
 */
function normalizeCollectedRoles(tests: CollectedTestData[]): void {
  const roles = new Set<string>();

  for (const test of tests) {
    const rawRole = (test.role ?? '').trim();
    test.role = rawRole ? canonicalRoleName(rawRole) : '';
    if (test.role) roles.add(test.role);
  }

  if (roles.size !== 1) return;

  const [singleRole] = roles;
  if (!singleRole) return;

  for (const test of tests) {
    if (!(test.role ?? '').trim()) test.role = singleRole;
  }
}

// ---------------------------------------------------------------------------
// Reporter class
// ---------------------------------------------------------------------------

export default class CustomReporter implements Reporter {
  private totalTests = 0;
  private collectedTests: CollectedTestData[] = [];

  onBegin(_config: FullConfig, suite: Suite): void {
    this.totalTests = suite.allTests().length;
    streamTelemetryEvent({ type: 'RUN_START', status: 'started' });
    logger.info('Custom reporter started.', { totalTests: this.totalTests });
  }

  onStepBegin(test: TestCase, _result: TestResult, step: TestStep): void {
    const rawSubtitle = (step as unknown as { subtitle?: string }).subtitle;
    const stepSubtitle =
      typeof rawSubtitle === 'string' && rawSubtitle.trim() ? rawSubtitle.trim() : undefined;

    streamTelemetryEvent({
      type: 'STEP_START',
      testId: test.id,
      testTitle: test.title,
      stepTitle: step.title,
      stepSubtitle,
    });
  }

  onStepEnd(test: TestCase, _result: TestResult, step: TestStep): void {
    const rawSubtitle = (step as unknown as { subtitle?: string }).subtitle;
    const stepSubtitle =
      typeof rawSubtitle === 'string' && rawSubtitle.trim() ? rawSubtitle.trim() : undefined;

    streamTelemetryEvent({
      type: 'STEP_END',
      testId: test.id,
      testTitle: test.title,
      stepTitle: step.title,
      stepSubtitle,
      durationMs: step.duration,
      error: step.error?.message,
    });
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    streamTelemetryEvent({
      type: 'TEST_END',
      testId: test.id,
      testTitle: test.title,
      status: result.status,
      durationMs: result.duration,
      error: result.error?.message,
    });

    const errors = collectErrors(result);
    const errorMessage = formatErrorMessage(errors);
    const filePath = path.relative(process.cwd(), test.location.file);
    const fullTitle = test.titlePath().join(' > ');
    const logicalKey = test.id || `${filePath}::${fullTitle}`;
    const attachments = collectAttachments(result);

    const testId = getAnnotation(test, 'testId') || deriveTestId(test.title);
    const scenarioId = getAnnotation(test, 'scenarioId');
    const role = getAnnotation(test, 'role');
    const module = resolveModuleFromPath(getAnnotation(test, 'module') || '', filePath);
    const feature = resolveFeatureFromPath(getAnnotation(test, 'feature') || '', filePath);
    const priority = normalizePriority(getAnnotation(test, 'priority') || 'medium');
    const inputData = safeParseJson<Record<string, string>>(getAnnotation(test, 'inputData'), {});
    const expectedResult = getAnnotation(test, 'expectedResult');

    const actualResultAnnotation = getAnnotation(test, 'actualResult');
    const actualResult =
      result.status === 'passed'
        ? actualResultAnnotation || 'Sesuai dengan expected result'
        : deriveActualFailureMessage(result, actualResultAnnotation);

    const failureSource = resolveFailureSource({
      status: result.status,
      errorMessage,
      title: test.title,
      annotation: getAnnotation(test, 'failureSource'),
    });

    const next: CollectedTestData = {
      logicalKey,
      title: test.title,
      fullTitle,
      filePath,
      status: result.status,
      duration: result.duration,
      errorMessage,
      errors,
      steps: collectSteps(result.steps ?? []),
      attachments,
      retry: result.retry,
      attempts: 1,
      metadataIncomplete: !expectedResult || !actualResultAnnotation,
      testId,
      scenarioId,
      role,
      module,
      feature,
      priority,
      inputData,
      expectedResult,
      actualResult,
      affectedLayer: parseAffectedLayer(getAnnotation(test, 'affectedLayer')),
      failureSource,
    };

    const previousIndex = this.collectedTests.findIndex((item) => item.logicalKey === logicalKey);
    if (previousIndex === -1) {
      this.collectedTests.push(next);
      return;
    }

    const previous = this.collectedTests[previousIndex]!;
    next.attempts = (previous.attempts ?? 1) + 1;
    next.retry = Math.max(previous.retry, result.retry);
    this.collectedTests[previousIndex] = next;
  }

  async onEnd(_result: FullResult): Promise<void> {
    const isCiMode = process.env.CI === 'true';

    try {
      ensureReportDirectory();

      materializeAttachments(this.collectedTests);
      normalizeCollectedRoles(this.collectedTests);

      // Bake deterministic AI notes (per-test signals + run-relative context
      // such as slow-passed detection), then overlay sidecar notes (QA
      // free-text + agent AI notes). A stale sidecar — stamped with an older
      // run identity, or holding unattributable content without one — is
      // reset so a fresh run starts clean and notes never leak across runs.
      // A pending pipeline run id (created at pipeline start so Generator/
      // Plan notes bind to THIS run) is adopted here as the canonical id.
      const runMeta = buildRunMeta(this.collectedTests);
      const pendingRun = readPendingRun();
      if (pendingRun) {
        runMeta.generatedAt = pendingRun.ranAt;
      }
      const canonicalRunId = generateRunId(runMeta.generatedAt);
      bakeAutoAiNotes(this.collectedTests);
      let notesFile = emptyTestNotesFile();
      try {
        const sidecar = loadLatestTestNotes();
        if (isStaleSidecar(sidecar, canonicalRunId)) {
          resetLatestTestNotes();
        } else {
          notesFile = sidecar;
          stampLatestTestNotesRunId(canonicalRunId);
        }
      } catch {
        // Non-blocking — render with deterministic notes only
      }
      if (pendingRun && pendingRun.runId === canonicalRunId) {
        clearPendingRun();
      }
      const mergedTests = mergeTestNotes(this.collectedTests, notesFile);

      const reportMode: ReportMode = this.collectedTests.some((t) => t.role && t.role.length > 0)
        ? 'role-aware'
        : 'general';

      const rolesInScope = [
        ...new Set(this.collectedTests.map((t) => t.role).filter((r): r is string => !!r)),
      ];

      const testCases: CollectedTestCase[] = mergedTests.map((t) => ({
        logicalKey: t.logicalKey,
        testId: t.testId,
        scenarioId: t.scenarioId,
        title: t.title,
        role: t.role,
        module: t.module,
        feature: t.feature,
        status: t.status,
        priority: t.priority,
        duration: t.duration,
        inputData: t.inputData,
        expectedResult: t.expectedResult,
        actualResult: t.actualResult,
        affectedLayer: t.affectedLayer,
        attachmentCount: t.attachments.length,
        hasTrace: t.attachments.some((a) => a.kind === 'trace'),
        failureSource: t.failureSource,
        qaNotes: t.qaNotes,
        aiNotes: t.aiNotes,
        retry: t.retry,
        attempts: t.attempts,
        metadataIncomplete: t.metadataIncomplete,
        // Richer runtime data for detail views, exports, and MCP summaries
        errorMessage: t.errorMessage,
        errors: t.errors,
        steps: t.steps,
        attachments: t.attachments,
      }));

      const total = this.collectedTests.length;
      const passed = this.collectedTests.filter((t) => t.status === 'passed').length;
      const skipped = this.collectedTests.filter((t) => t.status === 'skipped').length;
      const failed = total - passed - skipped;
      const summaryByRole: TestSummary['summaryByRole'] = {};
      const summaryByModule: TestSummary['summaryByModule'] = {};
      for (const testCase of this.collectedTests) {
        const role = testCase.role || 'GENERAL / UNSCOPED';
        const roleBreakdown = (summaryByRole[role] ??= { passing: 0, failing: 0, skipped: 0 });
        if (testCase.status === 'passed') roleBreakdown.passing += 1;
        else if (testCase.status === 'skipped') roleBreakdown.skipped += 1;
        else roleBreakdown.failing += 1;

        const module = testCase.module || 'GENERAL';
        const moduleBreakdown = (summaryByModule[module] ??= {
          passing: 0,
          failing: 0,
          skipped: 0,
          features: {},
        });
        if (testCase.status === 'passed') moduleBreakdown.passing += 1;
        else if (testCase.status === 'skipped') moduleBreakdown.skipped += 1;
        else moduleBreakdown.failing += 1;
        const feature = testCase.feature || 'GENERAL';
        const featureBreakdown = (moduleBreakdown.features[feature] ??= {
          passing: 0,
          failing: 0,
          skipped: 0,
        });
        if (testCase.status === 'passed') featureBreakdown.passing += 1;
        else if (testCase.status === 'skipped') featureBreakdown.skipped += 1;
        else featureBreakdown.failing += 1;
      }

      const summary: TestSummary = {
        runId: runMeta.runId,
        requirementPath: runMeta.requirementPath,
        total,
        passed,
        failed,
        skipped,
        passRate: total > 0 ? Math.round((passed / total) * 100) : 0,
        timestamp: runMeta.generatedAt,
        reportMode,
        rolesInScope,
        testCases,
        summaryByRole,
        summaryByModule,
        // Cross-scenario AI insights for the overview panel and MCP summaries
        // — enriched with trend signals vs the latest archived run
        aiInsights: buildRunInsights(this.collectedTests, loadRunHistory(canonicalRunId)),
        // Plain test execution has no Reporter Analyze declaration; the archive
        // path will bridge a pipeline-report JSON declaration when available.
        analysisVerdict: process.env.REQUIREMENT_PATH ? 'unverifiable' : 'not-applicable',
        analysisVerified: false,
        runMeta,
      };

      // Load report history for the dashboard History tab (only saved archives)
      let reportHistory: import('../agents/reporter/report-history').ReportHistoryEntry[] = [];
      try {
        reportHistory = listReportHistory({ sort: 'newest', limit: 20 });
      } catch {
        // Non-blocking — history tab will show empty state
      }

      // Determine archive banner state for the current run.
      // Check archive directly using the current run's timestamp to generate
      // the expected runId — this is correct because .latest-run is written AFTER HTML.
      let latestRunArchived = false;
      try {
        const expectedRunId = generateRunId(summary.timestamp);
        latestRunArchived = listArchivedRunIds().includes(expectedRunId);
      } catch {
        // Non-blocking — default to not archived (show save banner)
      }
      const dashboardOptions = {
        hasLatestRun: true, // We just finished a run — it definitely exists
        latestRunArchived,
      };

      const html = isCiMode
        ? buildCiHtml(summary, mergedTests, reportHistory, dashboardOptions)
        : buildLocalHtml(summary, mergedTests, reportHistory, dashboardOptions);

      fs.writeFileSync(dashboardPath(), html, 'utf-8');
      fs.writeFileSync(summaryPath(), JSON.stringify(summary, null, 2), 'utf-8');

      // Mirror to artifacts/reports/ only when REPORT_DIR is NOT already artifacts/reports
      try {
        const configuredReportDir = resolveWorkspaceReportDir();
        const legacyReportDir = path.resolve(process.cwd(), 'artifacts', 'reports');
        if (configuredReportDir !== legacyReportDir) {
          if (fs.existsSync(legacyReportDir) || fs.existsSync(path.dirname(legacyReportDir))) {
            if (!fs.existsSync(legacyReportDir)) fs.mkdirSync(legacyReportDir, { recursive: true });
            fs.writeFileSync(path.join(legacyReportDir, 'custom-dashboard.html'), html, 'utf-8');
            fs.writeFileSync(
              path.join(legacyReportDir, 'test-summary.json'),
              JSON.stringify(summary, null, 2),
              'utf-8',
            );
          }
        }
      } catch {
        // Non-blocking mirror
      }

      // Write .latest-run marker so archive:save can detect the latest run
      try {
        const latestRunMarker = path.join(reportDir(), '.latest-run');
        const markerPayload = JSON.stringify({
          runId: summary.runId,
          // Canonical archive id for note tooling (record_ai_note etc.)
          archiveRunId: generateRunId(summary.timestamp),
          timestamp: summary.timestamp,
          summaryPath: path.relative(process.cwd(), summaryPath()),
          total: summary.total,
          passed: summary.passed,
          failed: summary.failed,
          skipped: summary.skipped,
          passRate: summary.passRate,
          reportMode,
          // archive:save fallback fields — without these, saves from a shell
          // without APP_ENV set mislabel the env and lose totalDurationMs.
          appEnv: runMeta.appEnv,
          totalDurationMs: runMeta.totalDurationMs,
        });
        fs.writeFileSync(latestRunMarker, markerPayload, 'utf-8');

        // Also mirror .latest-run into artifacts/reports only if REPORT_DIR is different
        const configuredReportDir = resolveWorkspaceReportDir();
        const legacyReportDir = path.resolve(process.cwd(), 'artifacts', 'reports');
        if (configuredReportDir !== legacyReportDir && fs.existsSync(legacyReportDir)) {
          fs.writeFileSync(path.join(legacyReportDir, '.latest-run'), markerPayload, 'utf-8');
        }
      } catch {
        // Non-blocking
      }

      // Opt-in archive banner — never auto-save; QA decides
      console.log('');
      console.log('────────────────────────────────────────────────────────');
      console.log(
        `  📊 Run complete: ${summary.passed}✅ ${summary.failed}❌ ${summary.skipped}⏭️  (${summary.passRate}%)`,
      );
      console.log('  🌐 View & save via dashboard:  npm run dashboard');
      console.log('  💾 Save via CLI:               npm run archive:save');
      console.log('  📋 View history:               npm run archive:view');
      console.log('────────────────────────────────────────────────────────');
      console.log('');

      forcePlaywrightHtmlToLight(htmlReportDir());

      logger.info('Custom reports generated.', {
        mode: isCiMode ? 'ci' : 'local',
        reportMode,
        dashboard: path.relative(process.cwd(), dashboardPath()),
        summary: path.relative(process.cwd(), summaryPath()),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('Failed to generate custom reporter output.', {
        mode: isCiMode ? 'ci' : 'local',
        message,
      });

      if (isCiMode) {
        process.exitCode = 1;
        throw error;
      }
    }
  }
}

export * from './reporter/collect';
export * from './reporter/attachments';
export * from './reporter/theme-patch';
