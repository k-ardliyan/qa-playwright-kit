import type { TestResult, TestStep } from '@playwright/test/reporter';
import type { CollectedError, CollectedStep } from '../custom-dashboard/types';

export function collectSteps(steps: TestStep[]): CollectedStep[] {
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

export function collectErrors(result: TestResult): CollectedError[] {
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
export function stripAnsi(str: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escape stripping requires ESC
  return str.replace(/\x1b\[[0-9;]*m/g, '');
}

/**
 * Resolve module from annotation value or spec file path.
 * Priority:
 *   1. Explicit annotation value (set by generator from requirement metadata)
 *   2. Subfolder of tests/: tests/auth/foo.spec.ts → 'auth'
 *   3. 'general' fallback
 */
export function resolveModuleFromPath(annotationValue: string, filePath: string): string {
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
export function resolveFeatureFromPath(annotationValue: string, filePath: string): string {
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

export function findDeepestFailingStep(
  steps: TestStep[],
): { title: string; message?: string } | null {
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

export function formatErrorMessage(errors: CollectedError[]): string {
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
