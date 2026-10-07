import * as fs from 'node:fs';
import * as path from 'node:path';
import { getRepoRoot, resolveAllowedPath } from '../utils/safety';
import {
  getAdapterFixtureImport,
  getPlaywrightTestRoot,
  isAdapterSpecPath,
} from '../utils/playwright-paths';
import {
  type ValidationViolation,
  isTraceabilityExempt,
  normalizeRelativePath,
} from './rules/rule-helpers';
import { validateCapabilityPowerRules } from './rules/capability-rules';
import {
  validateNoInlineAuth,
  looksLikeClonedRoleName,
  extractAuthRolesFromSpec,
  validateAuthRolesRegistered,
  validateAuthenticatedSpecsDeclareStorageState,
  isLoginSubjectSpec,
  readRequirementAuthState,
} from './rules/auth-rules';

export type { ValidationViolation };
export {
  validateCapabilityPowerRules,
  validateNoInlineAuth,
  looksLikeClonedRoleName,
  extractAuthRolesFromSpec,
  validateAuthRolesRegistered,
  validateAuthenticatedSpecsDeclareStorageState,
  isLoginSubjectSpec,
  readRequirementAuthState,
};

export interface ValidateGeneratedTestsOutput {
  status: 'success' | 'error' | 'warning';
  validatedCount: number;
  violations: ValidationViolation[];
  /** Violations with severity 'warning' only — subset of violations. */
  warnings: ValidationViolation[];
  message: string;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getLineNumberFromIndex(content: string, index: number): number {
  if (index <= 0) {
    return 1;
  }
  return content.slice(0, index).split(/\r?\n/).length;
}

function findSpecFiles(dirPath: string): string[] {
  if (!fs.existsSync(dirPath)) {
    return [];
  }

  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...findSpecFiles(fullPath));
      continue;
    }
    if (entry.isFile() && fullPath.endsWith('.spec.ts')) {
      files.push(fullPath);
    }
  }

  return files;
}

function validateImportRule(
  content: string,
  filePath: string,
  relativePath: string,
): ValidationViolation | null {
  const isAdapterSpec = isAdapterSpecPath(relativePath);
  const adapterImport = getAdapterFixtureImport();
  const importRegex = isAdapterSpec
    ? new RegExp(`import\\s*{([^}]*)}\\s*from\\s*['"]${escapeRegExp(adapterImport)}['"]`, 'g')
    : /import\s*{([^}]*)}\s*from\s*['"](?:@\/fixtures\/base\.fixture|\.\.?\/fixtures|@\/public\/fixtures)['"]/g;
  const match = importRegex.exec(content);

  if (!match) {
    const expected = isAdapterSpec ? adapterImport : './fixtures or @/fixtures/base.fixture';
    return {
      filePath,
      lineNumber: 1,
      ruleName: `Import rule: must import test from ${expected}`,
    };
  }

  const importClause = match[1] ?? '';
  if (!/\btest\b/.test(importClause)) {
    return {
      filePath,
      lineNumber: getLineNumberFromIndex(content, match.index),
      ruleName: 'Import rule: base fixture import must include test',
    };
  }

  return null;
}

function validatePresenceRule(
  content: string,
  filePath: string,
  regex: RegExp,
  ruleName: string,
): ValidationViolation | null {
  if (regex.test(content)) {
    return null;
  }
  return { filePath, lineNumber: 1, ruleName };
}

function validateTraceabilityRule(
  content: string,
  filePath: string,
  relativePath: string,
): ValidationViolation[] {
  if (isTraceabilityExempt(relativePath)) {
    return [];
  }

  const violations: ValidationViolation[] = [];

  if (!/\/\/\s*spec:\s*.+/m.test(content)) {
    violations.push({
      filePath,
      lineNumber: 1,
      ruleName: 'Traceability rule: must include // spec: <path> comment before imports',
    });
  }

  if (!/\/\/\s*seed:\s*.+/m.test(content)) {
    violations.push({
      filePath,
      lineNumber: 1,
      ruleName:
        'Traceability rule: must include // seed: tests/seed.spec.ts comment before imports',
    });
  }

  // Warning: // req: closes the traceability loop back to the source requirement.
  // Severity is 'warning' (not error) so existing specs without it are not broken.
  if (!/\/\/\s*req:\s*.+/m.test(content)) {
    violations.push({
      filePath,
      lineNumber: 1,
      ruleName:
        'Traceability rule: missing // req: <requirements/feature.md> — add to close provenance loop',
      severity: 'warning',
    });
  }

  return violations;
}

/**
 * Assertion rule: a runnable spec must assert something.
 *
 * A spec with `test.describe` + `test.step` but no `expect(...)` runs green
 * while proving nothing — the pseudo-tested-method risk (Vera-Pérez et al.,
 * EMSE 2018) that this kit cites but did not previously enforce.
 *
 * Two precision guards, both learned from real false results:
 * - Comments are stripped before scanning, so a `// TODO: expect(...)` note in
 *   a skeleton does NOT count as an assertion.
 * - The exemption is per-file-runnable, not "any skip anywhere": a spec whose
 *   every declaration is `test.skip`/`test.fixme` is exempt (nothing runs), but
 *   a spec with real tests plus one fixme placeholder is NOT.
 */
export function validateRequiresAssertions(
  content: string,
  filePath: string,
  relativePath: string,
): ValidationViolation[] {
  if (isTraceabilityExempt(relativePath)) {
    return [];
  }
  const code = stripCommentsForAssertionScan(content);

  // expect(...) and its variants — expect.soft(...), expect.poll(...).
  if (/\bexpect\s*[.(]/.test(code)) {
    return [];
  }

  // Does anything in this file actually RUN? `test(`, `test.only(`, `test.fail(`
  // and `test.slow(` execute; `test.skip(`/`test.fixme(` do not. A file where
  // nothing runs has no assertion to make — but a file with even ONE runnable
  // test must assert (the old rule exempted the whole file if any skip appeared
  // anywhere, which let unasserted real tests ride along with a placeholder).
  const runnableCount =
    (code.match(/\btest\s*\(/g) ?? []).length +
    (code.match(/\btest\.(?:only|fail|slow)\s*\(/g) ?? []).length;

  // Whole-file skip: `test.describe.skip(...)` wrapping everything. Counted as
  // non-runnable only when no plain/`.only` describe exists, so a file with a
  // skipped group plus real groups is still checked. (Brace-accurate scoping
  // would be more precise; this stays a regex validator on purpose.)
  const hasPlainDescribe = /\btest\.describe(?:\.only)?\s*\(/.test(code);
  const hasSkippedDescribe = /\btest\.describe\.(?:skip|fixme)\s*\(/.test(code);
  const wholeFileSkipped = hasSkippedDescribe && !hasPlainDescribe;

  if (runnableCount === 0 || wholeFileSkipped) {
    return [];
  }

  return [
    {
      filePath,
      lineNumber: 1,
      ruleName:
        'Assertion rule: spec has runnable tests but no expect(...) call — a test without assertions proves nothing (use test.fixme — never test.skip — for deliberately unbuilt scenarios)',
    },
  ];
}

/**
 * Remove `//` line comments and `/* *\/` block comments so the assertion scan
 * sees code, not prose.
 *
 * The line-comment pattern keeps the character before `//`, which protects the
 * `https://` in a URL string: without that guard a line such as
 * `page.goto('https://x'); await expect(page)...` would be truncated at the
 * scheme and its real assertion lost — turning a passing spec into a false
 * violation.
 */
function stripCommentsForAssertionScan(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/gm, '$1');
}

/**
 * Windowed per-test analysis: slices the spec between consecutive runnable
 * `test(` declarations, the same way `validateMetadataRule` slices between
 * `setTestMetadata(` calls.
 *
 * This is a window approximation, not an AST (this validator stays regex-only
 * on purpose): a window ends at the NEXT runnable declaration, so
 * `test.beforeEach` hook bodies fall into the preceding window. Precise enough
 * for "does this test assert / declare metadata / duplicate another test".
 */
interface RunnableTestWindow {
  /** Index of the `test(` token in the original content. */
  start: number;
  /** Best-effort test title (may be empty for dynamic titles). */
  title: string;
  /** Window text: from this `test(` up to the next runnable `test(` (or EOF). */
  text: string;
}

function enumerateRunnableTestWindows(content: string): RunnableTestWindow[] {
  const anchor = /\btest(?:\.(?:only|fail|slow))?\s*\(/g;
  const starts: number[] = [];
  let match: RegExpExecArray | null;
  while ((match = anchor.exec(content)) !== null) {
    starts.push(match.index);
  }

  const windows: RunnableTestWindow[] = [];
  for (let i = 0; i < starts.length; i += 1) {
    const start = starts[i]!;
    const stop = i + 1 < starts.length ? starts[i + 1]! : content.length;
    const text = content.slice(start, stop);
    const titleMatch = /\btest(?:\.(?:only|fail|slow))?\s*\(\s*(['"`])(.*?)\1/.exec(text);
    windows.push({ start, title: titleMatch?.[2] ?? '', text });
  }
  return windows;
}

/** True when `index` sits on (or after) a comment opener on its own line. */
function isInsideComment(content: string, index: number): boolean {
  const lineStart = content.lastIndexOf('\n', Math.max(0, index - 1)) + 1;
  const prefix = content.slice(lineStart, index);
  if (/^\s*(?:\/\/|\*|\/\*)/.test(prefix)) {
    return true;
  }
  return prefix.includes('//') || prefix.includes('/*');
}

/**
 * `@manual` is the ONLY legitimate home of a permanent `test.skip` (doctrine:
 * references/scenario-tags.md). The marker may sit on the title line itself or
 * in the describe-level tag block above the call; the canonical generator emits
 * the reason "Manual: <alasan>", which is accepted as equivalent evidence.
 */
function hasManualMarkerNear(content: string, index: number): boolean {
  const before = content.slice(Math.max(0, index - 2000), index);
  const lines = before.split(/\r?\n/);
  if (/@manual/.test(lines.slice(-11).join('\n'))) {
    return true;
  }
  const ahead = content.slice(index, index + 240);
  if (/@manual/.test(ahead)) {
    return true;
  }
  return /['"`]\s*Manual\s*[:—-]/.test(ahead);
}

/**
 * Per-test assertion rule (closes the per-file gap): a file-level expect can
 * hide a sibling test that asserts nothing — a real spec shipped copy-pasted
 * header checks in its filter/pagination scenarios and captureActualResult-only
 * bodies elsewhere, and every one of them ran green. Each runnable test must
 * carry its own expect; tests that declare skip/fixme are exempt (they may not
 * run, and validateSkipDoctrine polices their policy separately).
 */
export function validatePerTestAssertions(
  content: string,
  filePath: string,
  relativePath: string,
): ValidationViolation[] {
  if (isTraceabilityExempt(relativePath)) {
    return [];
  }
  const violations: ValidationViolation[] = [];
  for (const window of enumerateRunnableTestWindows(content)) {
    const code = stripCommentsForAssertionScan(window.text);
    if (/\btest\.(?:skip|fixme)\s*\(/.test(code)) {
      continue;
    }
    if (/\bexpect\s*[.(]/.test(code)) {
      continue;
    }
    violations.push({
      filePath,
      lineNumber: getLineNumberFromIndex(content, window.start),
      ruleName: `Assertion rule (per test): "${window.title || 'untitled test'}" has a runnable body but no expect(...) — a test without assertions proves nothing; use test.fixme for deliberately unbuilt work, never a silent pass`,
      severity: 'error',
    });
  }
  return violations;
}

/** `test.skip(true, ...)`, `test.skip(false, ...)`, `test.skip()`, or the
 * declaration form `test.skip('title', body)` — a skip that can never run. */
const PERMANENT_SKIP_PATTERN = /\btest\.skip\s*\(\s*(?:true\b|false\b|['"`]|\))/;

/**
 * Skip-doctrine rule: Playwright reports `skip` and `fixme` with the same
 * status, so `test.skip(true, 'UI belum dieksplorasi')` buries unfinished work
 * in the grey "Skipped" bucket where non-coder QA reads it as "the app is
 * broken". Permanent skips are reserved for @manual scenarios; everything
 * unbuilt is `test.fixme` (surfaced as not-implemented). Conditional skips are
 * not forbidden — they are visible and reason-carrying — but data/precondition
 * gaps should prefer `test.fixme(condition, reason)`.
 */
export function validateSkipDoctrine(
  content: string,
  filePath: string,
  relativePath: string,
): ValidationViolation[] {
  if (isTraceabilityExempt(relativePath)) {
    return [];
  }
  const violations: ValidationViolation[] = [];
  const skipPattern = /\btest\.skip\s*\(/g;
  let match: RegExpExecArray | null;
  while ((match = skipPattern.exec(content)) !== null) {
    if (isInsideComment(content, match.index)) {
      continue;
    }
    const isPermanent = PERMANENT_SKIP_PATTERN.test(content.slice(match.index, match.index + 40));
    if (!isPermanent) {
      violations.push({
        filePath,
        lineNumber: getLineNumberFromIndex(content, match.index),
        ruleName:
          'Skip doctrine rule: conditional test.skip(condition, ...) reports plain "Skipped" — for data/precondition gaps prefer test.fixme(condition, reason) so the run surfaces the scenario as not-implemented ("Belum dibangun"); reserve skip for genuinely non-applicable configurations',
        severity: 'warning',
      });
      continue;
    }
    if (hasManualMarkerNear(content, match.index)) {
      continue;
    }
    violations.push({
      filePath,
      lineNumber: getLineNumberFromIndex(content, match.index),
      ruleName:
        'Skip doctrine rule: permanent test.skip(true/…) is only legitimate for @manual scenarios (canonical reason "Manual: <alasan>") — unbuilt or unexplored work must use test.fixme so the report shows "Belum dibangun", not "Skipped"',
      severity: 'error',
    });
  }
  return violations;
}

/** Drop the declaration header (title + callback signature) so two copies of
 * the same body under different titles still compare equal. */
function stripDeclarationHeader(text: string): string {
  const arrow = text.indexOf('=>');
  if (arrow !== -1) {
    return text.slice(arrow + 2);
  }
  const brace = text.indexOf('{');
  return brace === -1 ? text : text.slice(brace);
}

function normalizeTestBodyForDuplicateScan(text: string): string {
  const stripped = stripCommentsForAssertionScan(text);
  // Metadata (IDs/roles differ per scenario by design), per-test timeouts, and
  // captureActualResult narratives are stripped: two tests whose action
  // skeletons are identical and differ only in capture prose ARE the
  // copy-paste signature (a "filter" test that only re-checks table headers).
  // Exact-match only — similarity scoring is deliberately deferred to keep
  // false positives at zero.
  const withoutMetadata = stripped.replace(
    /\bsetTestMetadata\s*\((?:[^()]|\([^()]*\))*\)\s*;?/g,
    ' ',
  );
  const withoutTimeout = withoutMetadata.replace(/\btest\.setTimeout\s*\(\s*\d+\s*\)\s*;?/g, ' ');
  const withoutCapture = withoutTimeout.replace(
    /\bcaptureActualResult\s*\((?:[^()]|\([^()]*\))*\)\s*;?/g,
    ' ',
  );
  const normalized = withoutCapture.replace(/\s+/g, ' ').trim();
  // Strip structural trailing closers: the LAST test's window additionally
  // contains the describe-level `});` stack, which would otherwise make two
  // identical bodies compare unequal. Trailing closers carry no behavior.
  return normalized.replace(/[\s;)\]}]+$/, '');
}

/**
 * Duplicate-body rule: copy-pasted assertion bodies are the quietest way a
 * generated suite stops testing its own scenarios while staying green. Exact
 * normalized equality is reported; skeleton tests (skip/fixme) are exempt
 * because they are intentionally near-identical.
 */
export function validateDuplicateTestBodies(
  content: string,
  filePath: string,
  relativePath: string,
): ValidationViolation[] {
  if (isTraceabilityExempt(relativePath)) {
    return [];
  }
  const violations: ValidationViolation[] = [];
  const seen = new Map<string, string>();
  for (const window of enumerateRunnableTestWindows(content)) {
    const code = stripCommentsForAssertionScan(window.text);
    if (/\btest\.(?:skip|fixme)\s*\(/.test(code)) {
      continue;
    }
    const body = normalizeTestBodyForDuplicateScan(stripDeclarationHeader(window.text));
    if (body.length < 40) {
      continue;
    }
    const firstOwner = seen.get(body);
    if (firstOwner !== undefined) {
      violations.push({
        filePath,
        lineNumber: getLineNumberFromIndex(content, window.start),
        ruleName: `Duplicate body rule: test "${window.title || 'untitled'}" has a body identical to test "${firstOwner}" — assertions are likely copy-pasted; assert this scenario's own expected behavior`,
        severity: 'warning',
      });
      continue;
    }
    seen.set(body, window.title || 'untitled');
  }
  return violations;
}

export function validateSpecFile(
  filePath: string,
  relativePath?: string,
  repoRoot: string = process.cwd(),
): ValidationViolation[] {
  const content = fs.readFileSync(filePath, 'utf-8');
  const violations: ValidationViolation[] = [];
  const rel = relativePath ?? normalizeRelativePath(filePath);

  const importViolation = validateImportRule(content, filePath, rel);
  if (importViolation) {
    violations.push(importViolation);
  }

  const describeViolation = validatePresenceRule(
    content,
    filePath,
    /test\.describe\s*\(/,
    'Describe rule: must contain at least one test.describe(...) block',
  );
  if (describeViolation) {
    violations.push(describeViolation);
  }

  const stepViolation = validatePresenceRule(
    content,
    filePath,
    /test\.step\s*\(/,
    'Step rule: must contain at least one test.step(...) call',
  );
  if (stepViolation) {
    violations.push(stepViolation);
  }

  violations.push(...validateTraceabilityRule(content, filePath, rel));
  violations.push(...validateRequiresAssertions(content, filePath, rel));
  violations.push(...validatePerTestAssertions(content, filePath, rel));
  violations.push(...validateSkipDoctrine(content, filePath, rel));
  violations.push(...validateDuplicateTestBodies(content, filePath, rel));
  violations.push(...validateCapabilityPowerRules(content, filePath, rel));
  violations.push(...validateNoEphemeralRefs(content, filePath, rel));
  violations.push(...validateNoHardcodedWaits(content, filePath, rel));
  violations.push(...validateNoDataInStepTitles(content, filePath, rel));
  violations.push(...validateMetadataRule(content, filePath, rel));
  violations.push(...validateNoInlineAuth(content, filePath, rel));
  violations.push(...validateAuthRolesRegistered(content, filePath, rel));
  violations.push(
    ...validateAuthenticatedSpecsDeclareStorageState(content, filePath, rel, repoRoot),
  );
  violations.push(...validateNoVisiblePseudoClass(content, filePath, rel));

  return violations;
}

export function validateMetadataRule(
  content: string,
  filePath: string,
  relativePath: string,
): ValidationViolation[] {
  if (isTraceabilityExempt(relativePath)) {
    return [];
  }
  const violations: ValidationViolation[] = [];
  // Row identity: the dashboard keys every row on testId (annotation, with a
  // title-derived fallback). Check PER CALL, not per file — a spec with many
  // tests where only some carry testId silently yields ID-less rows for the
  // rest.
  const callPattern = /\bsetTestMetadata\s*\(/g;
  const callSites: number[] = [];
  let match: RegExpExecArray | null;
  while ((match = callPattern.exec(content)) !== null) {
    callSites.push(match.index);
  }

  if (callSites.length === 0) {
    violations.push({
      filePath,
      lineNumber: 1,
      ruleName:
        'Metadata rule: missing setTestMetadata({ testId, ... }) — add as the first statement inside each test() (or beforeEach) for reporting taxonomy',
      severity: 'warning',
    });
  }

  for (let i = 0; i < callSites.length; i += 1) {
    const start = callSites[i]!;
    const stop = i + 1 < callSites.length ? callSites[i + 1]! : content.length;
    if (!/\btestId\s*:/.test(content.slice(start, stop))) {
      violations.push({
        filePath,
        lineNumber: getLineNumberFromIndex(content, start),
        ruleName:
          "Metadata rule: setTestMetadata(...) call without testId — its dashboard row(s) lose identity; add testId: 'TC-...'",
        severity: 'warning',
      });
    }
  }

  // Per-test completeness: a call inside ONE test does not give the OTHER tests
  // an identity — a real spec shipped 9 metadata-less tests inside a file that
  // had plenty of calls, and those rows silently lost their dashboard identity.
  // A describe-level beforeEach call is the sanctioned alternative, so its
  // presence downgrades this scan.
  const code = stripCommentsForAssertionScan(content);
  const hookIndex = code.search(/\btest\.beforeEach\s*\(/);
  const hookProvidesMetadata =
    hookIndex !== -1 && /\bsetTestMetadata\s*\(/.test(code.slice(hookIndex, hookIndex + 400));
  if (!hookProvidesMetadata) {
    for (const window of enumerateRunnableTestWindows(content)) {
      if (/\bsetTestMetadata\s*\(/.test(window.text)) {
        continue;
      }
      violations.push({
        filePath,
        lineNumber: getLineNumberFromIndex(content, window.start),
        ruleName: `Metadata rule: test "${window.title || 'untitled'}" is missing setTestMetadata({ testId, scenarioId, module, feature }) — its dashboard row has no identity; add the call as the first statement inside each test() (or a describe-level beforeEach)`,
        severity: 'error',
      });
    }
  }
  return violations;
}

/**
 * Detect persisted MCP snapshot refs or debug CLI handles.
 */
export function validateNoEphemeralRefs(
  content: string,
  filePath: string,
  relativePath: string,
): ValidationViolation[] {
  if (isTraceabilityExempt(relativePath)) {
    return [];
  }

  const violations: ValidationViolation[] = [];
  const refPattern =
    /(?:\bref\s*:\s*\d+|\bref_\d+|\bdata-mcp-ref)|"ref"\s*:\s*\d+|\btw-[0-9a-fA-F]{4,}\b|\bplaywright-element-\d+\b/g;
  let match: RegExpExecArray | null;

  while ((match = refPattern.exec(content)) !== null) {
    violations.push({
      filePath,
      lineNumber: getLineNumberFromIndex(content, match.index),
      ruleName: `Ephemeral ref rule: ephemeral MCP ref or CLI handle detected ("${match[0]}"). Use semantic locators (getByRole, getByLabel, etc.) instead.`,
      severity: 'error',
    });
  }

  return violations;
}

/**
 * Flag hardcoded waits/sleeps. Warning severity so existing tests are not
 * rejected outright, but the Generator cannot casually emit them.
 */
export function validateNoHardcodedWaits(
  content: string,
  filePath: string,
  relativePath: string,
): ValidationViolation[] {
  if (isTraceabilityExempt(relativePath)) {
    return [];
  }

  const violations: ValidationViolation[] = [];
  const waitPattern = /\b(?:page\.waitForTimeout|\.waitForTimeout)\s*\(/g;
  let match: RegExpExecArray | null;

  while ((match = waitPattern.exec(content)) !== null) {
    violations.push({
      filePath,
      lineNumber: getLineNumberFromIndex(content, match.index),
      ruleName: `Hardcoded wait rule: avoid hardcoded timeout/sleep ("${match[0]}"). Use observable assertions/states instead.`,
      severity: 'warning',
    });
  }

  return violations;
}

/**
 * Flag raw data literals leaking into test.step titles.
 * Step titles must be UI actions only (e.g. "Isi field email"); test values
 * belong in `setTestMetadata({ inputData })`.
 */
export function validateNoDataInStepTitles(
  content: string,
  filePath: string,
  relativePath: string,
): ValidationViolation[] {
  if (isTraceabilityExempt(relativePath)) {
    return [];
  }

  const violations: ValidationViolation[] = [];
  const stepPattern = /test\.step\s*\(\s*(['"`])(.*?)\1/g;
  let match: RegExpExecArray | null;

  while ((match = stepPattern.exec(content)) !== null) {
    const title = match[2];
    if (!title) continue;

    // Pattern 1: Raw email address in title
    if (/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/.test(title)) {
      violations.push({
        filePath,
        lineNumber: getLineNumberFromIndex(content, match.index),
        ruleName: `Step title rule: email address detected in test.step title ("${title}"). Move data value to setTestMetadata({ inputData }) and use action text only.`,
        severity: 'warning',
      });
      continue;
    }

    // Pattern 2: Raw password phrase or credential leaks in title
    if (
      /\b(?:password|pass|secret)\s*[:=]\s*\S+/i.test(title) ||
      /\b(?:Pass\*\w+|s3cret\w*)\b/.test(title)
    ) {
      violations.push({
        filePath,
        lineNumber: getLineNumberFromIndex(content, match.index),
        ruleName: `Step title rule: credential/secret value detected in test.step title ("${title}"). Move data value to setTestMetadata({ inputData }) and use action text only.`,
        severity: 'warning',
      });
      continue;
    }

    // Pattern 3: Explicit 'with value "..."' or 'with data "..."' pattern leaking into step
    if (/\bwith\s+(?:value|data|input)\s+['"`][^'"`]+['"`]/i.test(title)) {
      violations.push({
        filePath,
        lineNumber: getLineNumberFromIndex(content, match.index),
        ruleName: `Step title rule: data literal syntax detected in test.step title ("${title}"). Step titles must be UI actions only (verbatim from requirement); place test data in setTestMetadata({ inputData }).`,
        severity: 'warning',
      });
    }
  }

  return violations;
}

/**
 * ARCH-014 / Playwright 2026: Discourage deprecated `:visible` pseudo-class.
 * Recommend native `locator.visible()` instead.
 */
export function validateNoVisiblePseudoClass(
  content: string,
  filePath: string,
  relativePath: string,
): ValidationViolation[] {
  if (isTraceabilityExempt(relativePath)) {
    return [];
  }

  const violations: ValidationViolation[] = [];
  const visiblePseudoPattern = /locator\s*\(\s*['"`](?:[^'"`]*?:visible)['"`]\s*\)/g;
  let match: RegExpExecArray | null;

  while ((match = visiblePseudoPattern.exec(content)) !== null) {
    violations.push({
      filePath,
      lineNumber: getLineNumberFromIndex(content, match.index),
      ruleName:
        'Selector rule: deprecated CSS pseudo-class ":visible" detected. Use native Playwright locator.visible() instead.',
      severity: 'warning',
    });
  }

  return violations;
}

export function validateGeneratedTests(filePath?: string): ValidateGeneratedTestsOutput {
  const repoRoot = getRepoRoot();
  const violations: ValidationViolation[] = [];
  let specFiles: string[];

  if (filePath) {
    const resolved = resolveAllowedPath(filePath, 'tests', { mustExist: true });
    if (!resolved.ok) {
      return {
        status: 'error',
        validatedCount: 0,
        violations: [],
        warnings: [],
        message: resolved.error.message,
      };
    }

    if (!resolved.absolutePath.endsWith('.spec.ts')) {
      return {
        status: 'error',
        validatedCount: 0,
        violations: [],
        warnings: [],
        message: 'Only .spec.ts files can be validated.',
      };
    }

    specFiles = [resolved.absolutePath];
  } else {
    specFiles = findSpecFiles(path.join(repoRoot, getPlaywrightTestRoot())).sort((a, b) =>
      a.localeCompare(b),
    );
  }

  for (const specPath of specFiles) {
    const relativeSpecPath = normalizeRelativePath(path.relative(repoRoot, specPath));
    try {
      violations.push(...validateSpecFile(specPath, relativeSpecPath, repoRoot));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to read file';
      violations.push({
        filePath: specPath,
        lineNumber: 1,
        ruleName: `Read error: ${message}`,
      });
    }
  }

  const relativeViolations = violations.map((v) => ({
    ...v,
    filePath: path.relative(repoRoot, v.filePath).replace(/\\/g, '/'),
  }));

  const errorViolations = relativeViolations.filter((v) => (v.severity ?? 'error') === 'error');
  const warnViolations = relativeViolations.filter((v) => v.severity === 'warning');

  if (errorViolations.length > 0) {
    return {
      status: 'error',
      validatedCount: specFiles.length,
      violations: relativeViolations,
      warnings: warnViolations,
      message: `Found ${errorViolations.length} error(s) and ${warnViolations.length} warning(s) across ${specFiles.length} file(s).`,
    };
  }

  if (warnViolations.length > 0) {
    return {
      status: 'warning',
      validatedCount: specFiles.length,
      violations: relativeViolations,
      warnings: warnViolations,
      message: `Validated ${specFiles.length} test file(s); 0 errors, ${warnViolations.length} warning(s).`,
    };
  }

  return {
    status: 'success',
    validatedCount: specFiles.length,
    violations: [],
    warnings: [],
    message: `Validated ${specFiles.length} test file(s); all structural checks passed.`,
  };
}
