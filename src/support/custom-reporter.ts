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
import { generateRunId, listArchivedRunIds } from '../agents/reporter/report-archive';
import type {
  AffectedLayer,
  AttachmentKind,
  CollectedAttachment,
  CollectedError,
  CollectedStep,
  CollectedTestCase,
  CollectedTestData,
  Priority,
  ReportMode,
  RunMeta,
  TestSummary,
} from './custom-dashboard/types';
import { resolveFailureSource } from './custom-dashboard/failure-source';
import { toReportRelativePath } from './custom-dashboard/shared';
import { streamTelemetryEvent } from './streaming/live-telemetry';
import { logger } from '../utils/logger';
import { canonicalRoleName } from '../shared/utils/role-credentials';
import {
  resolveWorkspaceReportDir,
  resolveWorkspaceTestResultsDir,
} from '../shared/workspace-paths';

function resolveReportDir(): string {
  return resolveWorkspaceReportDir();
}

function reportPaths(): {
  reportDir: string;
  dashboardPath: string;
  summaryPath: string;
  htmlReportDir: string;
  attachmentsDir: string;
  testResultsDir: string;
} {
  const reportDir = resolveReportDir();
  return {
    reportDir,
    dashboardPath: path.join(reportDir, 'custom-dashboard.html'),
    summaryPath: path.join(reportDir, 'test-summary.json'),
    htmlReportDir: path.join(reportDir, 'html'),
    attachmentsDir: path.join(reportDir, 'attachments'),
    testResultsDir: resolveWorkspaceTestResultsDir(),
  };
}

function reportDir(): string {
  return reportPaths().reportDir;
}
function dashboardPath(): string {
  return reportPaths().dashboardPath;
}
function summaryPath(): string {
  return reportPaths().summaryPath;
}
function htmlReportDir(): string {
  return reportPaths().htmlReportDir;
}
function attachmentsDir(): string {
  return reportPaths().attachmentsDir;
}

const KIND_SUBDIR: Record<'screenshot' | 'video' | 'trace', string> = {
  screenshot: 'screenshots',
  video: 'videos',
  trace: 'traces',
};

function safeFilePrefix(test: CollectedTestData): string {
  return (
    (test.logicalKey || test.testId || test.title).replace(/[^a-zA-Z0-9-]/g, '_').slice(0, 60) ||
    'test'
  );
}

/**
 * Copy screenshot / video / trace into artifacts/reports/attachments/* and rewrite relativePath
 * so standalone custom-dashboard.html can open evidence next to the report.
 */
function resolveAttachmentSourcePath(relativeOrAbs: string): string | null {
  const normalized = relativeOrAbs.replace(/\\/g, '/');
  const candidates: string[] = [];
  const paths = reportPaths();

  if (path.isAbsolute(relativeOrAbs)) {
    candidates.push(relativeOrAbs);
  } else {
    candidates.push(path.resolve(paths.reportDir, normalized));
    candidates.push(path.resolve(process.cwd(), normalized));
    candidates.push(path.resolve(paths.testResultsDir, path.basename(normalized)));
    // Already-materialized path re-run safety
    if (normalized.startsWith('attachments/')) {
      candidates.push(path.resolve(paths.reportDir, normalized));
    }
  }

  for (const candidate of candidates) {
    try {
      if (candidate && fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        return candidate;
      }
    } catch {
      // ignore stat errors
    }
  }
  return null;
}

function materializeAttachments(tests: CollectedTestData[]): void {
  try {
    for (const sub of Object.values(KIND_SUBDIR)) {
      const dir = path.join(attachmentsDir(), sub);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    }

    for (const test of tests) {
      const prefix = safeFilePrefix(test);
      for (const attachment of test.attachments) {
        if (
          attachment.kind !== 'screenshot' &&
          attachment.kind !== 'video' &&
          attachment.kind !== 'trace'
        ) {
          continue;
        }
        if (!attachment.relativePath) continue;

        // Skip if already under reports/attachments
        if (attachment.relativePath.replace(/\\/g, '/').startsWith('attachments/')) {
          const already = path.resolve(reportDir(), attachment.relativePath);
          if (fs.existsSync(already)) continue;
        }

        const absPath = resolveAttachmentSourcePath(attachment.relativePath);
        if (!absPath) continue;

        const destName = `${prefix}__${path.basename(absPath)}`;
        const sub = KIND_SUBDIR[attachment.kind];
        const uniqueDest = path.join(attachmentsDir(), sub, destName);
        try {
          fs.copyFileSync(absPath, uniqueDest);
          attachment.relativePath = `attachments/${sub}/${destName}`.replace(/\\/g, '/');
        } catch (copyErr) {
          logger.warn('Failed to copy attachment', {
            kind: attachment.kind,
            from: absPath,
            err: String(copyErr),
          });
        }
      }
    }
  } catch (err) {
    logger.warn('Failed to materialize attachments into reports/attachments/', {
      err: String(err),
    });
  }
}

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
// Existing helpers
// ---------------------------------------------------------------------------

function collectSteps(steps: TestStep[]): CollectedStep[] {
  return steps.map((step) => {
    // Playwright v1.63+ exposes subtitle and params on testStep
    const stepAny = step as unknown as {
      subtitle?: string;
      params?: Record<string, unknown>;
    };
    const subtitle =
      typeof stepAny.subtitle === 'string' && stepAny.subtitle.trim()
        ? stepAny.subtitle.trim()
        : undefined;
    const params =
      stepAny.params && typeof stepAny.params === 'object' ? stepAny.params : undefined;

    return {
      title: step.title,
      status: step.error ? 'failed' : 'passed',
      duration: step.duration,
      errorMessage: step.error?.message,
      subtitle,
      params,
      steps: collectSteps(step.steps ?? []),
    };
  });
}

function collectErrors(result: TestResult): CollectedError[] {
  const errors: CollectedError[] = [];

  for (const error of result.errors) {
    const messagePart = error.message ?? '';
    const valuePart = error.value ? String(error.value) : '';
    const message = [messagePart, valuePart].filter((part) => part.trim().length > 0).join('\n');
    const stack = error.stack?.trim() || undefined;

    if (message.trim().length === 0 && !stack) {
      continue;
    }

    const rawContext = (error as unknown as { errorContext?: string }).errorContext;
    const errorContext =
      typeof rawContext === 'string' && rawContext.trim() ? rawContext.trim() : undefined;

    errors.push({
      message: message.trim() || stack || 'Unknown Playwright error',
      stack,
      errorContext,
    });
  }

  return errors;
}

/** Strip ANSI terminal escape codes (color/dim/bold sequences). */
function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[0-9;]*m/g, '');
}

/**
 * Resolve module from annotation value or spec file path.
 * Priority:
 *   1. Explicit annotation value (set by generator from requirement metadata)
 *   2. Subfolder of tests/: tests/auth/foo.spec.ts → 'auth'
 *   3. 'general' fallback
 */
function resolveModuleFromPath(annotationValue: string, filePath: string): string {
  const val = (annotationValue || '').trim().toLowerCase();
  if (val.length > 0) return val;
  // tests/<subfolder>/... or tests\\<subfolder>\\...
  const normalized = filePath.replace(/\\/g, '/');
  const match = normalized.match(/tests\/([^/]+)\/.+\.spec\.ts$/i);
  if (match) {
    const folder = match[1].toLowerCase();
    if (!folder.startsWith('_') && folder !== 'demo') return folder;
  }
  return '-';
}

/**
 * Resolve feature from annotation value or spec file name.
 * Priority:
 *   1. Explicit annotation value (set by generator from requirement metadata)
 *   2. Spec filename stem without role suffix: 'login-empty-fields-finance.spec.ts' → 'login-empty-fields'
 *   3. 'general' fallback
 */
function resolveFeatureFromPath(annotationValue: string, filePath: string): string {
  const val = (annotationValue || '').trim().toLowerCase();
  if (val.length > 0) return val;
  const normalized = filePath.replace(/\\/g, '/');
  const filename = normalized.split('/').pop() ?? '';
  let stem = filename.replace(/\.spec\.ts$/i, '').toLowerCase();
  // Strip known role suffixes
  const knownRoles = ['super-admin', 'finance', 'hrd', 'admin', 'user'];
  for (const role of knownRoles) {
    if (stem.endsWith(`-${role}`)) {
      stem = stem.slice(0, stem.length - role.length - 1);
      break;
    }
  }
  if (stem.length > 0 && !stem.startsWith('_') && stem !== 'demo') return stem;
  return '-';
}

function findDeepestFailingStep(steps: TestStep[]): { title: string; message?: string } | null {
  for (const step of steps) {
    if (step.error) {
      if (step.steps && step.steps.length > 0) {
        const deeper = findDeepestFailingStep(step.steps);
        if (deeper) return deeper;
      }
      return { title: step.title, message: step.error.message };
    }
  }
  return null;
}

/**
 * Format a rich, readable failure reason for the ACTUAL RESULT column.
 * Strips ANSI codes, surfaces the specific failing step, and extracts
 * the root cause (locator timeout, network failure, expectation mismatch, etc.)
 * rather than a bare "Test timeout of 30000ms exceeded".
 */
export function deriveActualFailureMessage(result: TestResult, annotationActual?: string): string {
  if (annotationActual) {
    return stripAnsi(annotationActual).trim();
  }

  const rawMessages: string[] = [];
  if (result.error?.message) rawMessages.push(result.error.message);
  for (const err of result.errors ?? []) {
    if (err.message && !rawMessages.includes(err.message)) {
      rawMessages.push(err.message);
    }
    if (err.stack && !rawMessages.includes(err.stack)) {
      rawMessages.push(err.stack);
    }
  }

  const fullText = stripAnsi(rawMessages.join('\n'));
  const failingStep = findDeepestFailingStep(result.steps ?? []);

  const parts: string[] = [];

  if (
    failingStep &&
    !failingStep.title.startsWith('Worker Cleanup') &&
    !failingStep.title.startsWith('Before Hooks') &&
    !failingStep.title.startsWith('After Hooks')
  ) {
    parts.push(`Gagal pada langkah: "${failingStep.title}"`);
  }

  // 1. Check for Network / Connection errors (e.g. net::ERR_CONNECTION_REFUSED)
  const netMatch = fullText.match(/net::ERR_[A-Z_]+(?:\s+at\s+\S+)?/i);
  if (netMatch) {
    parts.push(`Koneksi gagal: ${netMatch[0].trim()}`);
    return parts.join('\n');
  }

  // 2. Check for Assertion Mismatch (Expected vs Received)
  const expectMatch = fullText.match(
    /Expected (?:string|value|pattern)?:\s*([^\n]+)\s*\n\s*Received (?:string|value)?:\s*([^\n]+)/i,
  );
  if (expectMatch) {
    const exp = expectMatch[1].trim();
    const rec = expectMatch[2].trim();
    parts.push(`Nilai tidak sesuai — Diharapkan: ${exp}, Diterima: ${rec}`);
    return parts.join('\n');
  }

  // 3. Check for Locator wait / Actionability failures
  const locatorMatch = fullText.match(
    /(?:waiting for|Locator:)\s*(?:locator|element|getBy\w+|selector)?\s*\(?((?:locator|getBy\w+|['"][^'"]+['"]|[^)\n\r]+)+)\)?(?:\s+to be\s+\w+)?/i,
  );
  // 4. Check for Navigation / waitForURL failures
  const urlMatch = fullText.match(
    /waiting for (?:navigation|URL)\s*(?:to\s*)?["']?([^"'\n\r]+)["']?/i,
  );
  // 5. Check for Click Interception / Not Clickable
  const interceptMatch = fullText.match(
    /element is not visible|is disabled|another element \S+ obscures it|intercepts pointer events/i,
  );

  if (interceptMatch) {
    parts.push(`Interaksi terhalang: ${interceptMatch[0].trim()}`);
  } else if (locatorMatch && !locatorMatch[0].toLowerCase().includes('navigation')) {
    parts.push(
      `Elemen tidak ditemukan / belum siap: ${locatorMatch[0].trim().replace(/^Locator:\s*/i, '')}`,
    );
  } else if (urlMatch) {
    parts.push(`Menunggu halaman: ${urlMatch[0].trim()}`);
  } else if (/timeout (?:of \d+ms )?exceeded/i.test(fullText)) {
    const timeMatch = fullText.match(/timeout of (\d+)ms exceeded/i);
    const ms = timeMatch ? `${parseInt(timeMatch[1], 10) / 1000}s` : '30s';
    parts.push(`Timeout (${ms}): Operasi melebihi batas waktu tunggu`);
  }

  // If structured reasons were extracted, return them
  if (parts.length > 0) {
    const firstLine = fullText
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find((l) => l.length > 0 && !l.startsWith('Error:') && !l.startsWith('Call log:'));
    if (
      firstLine &&
      !parts.some((p) => p.toLowerCase().includes(firstLine.toLowerCase())) &&
      firstLine.length < 100 &&
      !firstLine.includes('timeout')
    ) {
      parts.push(firstLine);
    }
    return parts.join('\n');
  }

  // Fallback: clean first 2-3 lines of raw error message
  const lines = fullText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('Call log:'))
    .slice(0, 3);

  return lines.length > 0 ? lines.join('\n') : '-';
}

function formatErrorMessage(errors: CollectedError[]): string {
  const seen = new Set<string>();
  return errors
    .map((error) => {
      const parts = [error.message];
      if (error.stack && !error.message.includes(error.stack)) {
        parts.push(error.stack);
      }
      return stripAnsi(parts.filter((part) => part.trim().length > 0).join('\n'));
    })
    .filter((message) => {
      if (!message.trim() || seen.has(message)) return false;
      seen.add(message);
      return true;
    })
    .join('\n\n');
}

function classifyAttachment(name: string, contentType?: string): AttachmentKind {
  const normalizedName = name.toLowerCase();
  const normalizedType = (contentType ?? '').toLowerCase();

  if (normalizedName.includes('trace')) {
    return 'trace';
  }
  if (normalizedName.includes('screenshot') || normalizedType.startsWith('image/')) {
    return 'screenshot';
  }
  if (normalizedName.includes('video') || normalizedType.startsWith('video/')) {
    return 'video';
  }

  return 'other';
}

function collectAttachments(result: TestResult): CollectedAttachment[] {
  const attachments: CollectedAttachment[] = [];

  for (const attachment of result.attachments) {
    if (!attachment.path) {
      continue;
    }

    attachments.push({
      name: attachment.name,
      contentType: attachment.contentType,
      relativePath: toReportRelativePath(attachment.path),
      kind: classifyAttachment(attachment.name, attachment.contentType),
    });
  }

  return attachments;
}

function ensureReportDirectory(): void {
  try {
    fs.mkdirSync(reportDir());
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code !== 'EEXIST') {
      throw error;
    }
  }
}

const HTML_THEME_OVERRIDE_STYLE = `
<style data-dashboard-theme-override="light">
  :root:not(.dark-mode):not(.light-mode) { color-scheme: light; }
  :root { color-scheme: light; }
</style>
<script data-dashboard-theme-override="light">
  (function () {
    function forceLight() {
      try {
        var root = document.documentElement;
        var meta = document.querySelector("meta[name='color-scheme']");
        if (meta) meta.setAttribute('content', 'light');
        if (root.classList.contains('dark-mode')) {
          root.classList.remove('dark-mode');
          root.classList.add('light-mode');
        }
        try { localStorage.setItem('playwright-report-theme', 'light'); } catch (e) { /* ignore */ }
      } catch (e) { /* ignore */ }
    }
    forceLight();
    document.addEventListener('DOMContentLoaded', forceLight);
    new MutationObserver(forceLight).observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    });
  })();
</script>
`;

function forcePlaywrightHtmlToLight(htmlFolder: string): void {
  const indexPath = path.join(htmlFolder, 'index.html');
  if (!fs.existsSync(indexPath)) {
    return;
  }

  let content = fs.readFileSync(indexPath, 'utf-8');
  if (content.includes('data-dashboard-theme-override="light"')) {
    return;
  }

  const injection = `    ${HTML_THEME_OVERRIDE_STYLE.trim()}\n`;
  const headCloseIdx = content.indexOf('</head>');
  if (headCloseIdx === -1) {
    return;
  }

  content = content.slice(0, headCloseIdx) + injection + content.slice(headCloseIdx);
  fs.writeFileSync(indexPath, content, 'utf-8');
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

      const reportMode: ReportMode = this.collectedTests.some((t) => t.role && t.role.length > 0)
        ? 'role-aware'
        : 'general';

      const rolesInScope = [
        ...new Set(this.collectedTests.map((t) => t.role).filter((r): r is string => !!r)),
      ];

      const testCases: CollectedTestCase[] = this.collectedTests.map((t) => ({
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
        retry: t.retry,
        attempts: t.attempts,
        metadataIncomplete: t.metadataIncomplete,
        // Richer runtime data for detail views, exports, and MCP summaries
        errorMessage: t.errorMessage,
        errors: t.errors,
        steps: t.steps,
        attachments: t.attachments,
      }));

      const runMeta = buildRunMeta(this.collectedTests);
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
        ? buildCiHtml(summary, this.collectedTests, reportHistory, dashboardOptions)
        : buildLocalHtml(summary, this.collectedTests, reportHistory, dashboardOptions);

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
