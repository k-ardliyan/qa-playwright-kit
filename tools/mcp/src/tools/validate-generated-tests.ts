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
} from './rules/auth-rules';

export type { ValidationViolation };
export {
  validateCapabilityPowerRules,
  validateNoInlineAuth,
  looksLikeClonedRoleName,
  extractAuthRolesFromSpec,
  validateAuthRolesRegistered,
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

export function validateSpecFile(filePath: string, relativePath?: string): ValidationViolation[] {
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
  violations.push(...validateCapabilityPowerRules(content, filePath, rel));
  violations.push(...validateNoEphemeralRefs(content, filePath, rel));
  violations.push(...validateNoHardcodedWaits(content, filePath, rel));
  violations.push(...validateNoDataInStepTitles(content, filePath, rel));
  violations.push(...validateMetadataRule(content, filePath, rel));
  violations.push(...validateNoInlineAuth(content, filePath, rel));
  violations.push(...validateAuthRolesRegistered(content, filePath, rel));
  violations.push(...validateNoVisiblePseudoClass(content, filePath, rel));

  return violations;
}

function validateMetadataRule(
  content: string,
  filePath: string,
  relativePath: string,
): ValidationViolation[] {
  if (isTraceabilityExempt(relativePath)) {
    return [];
  }
  const violations: ValidationViolation[] = [];
  if (!/\bsetTestMetadata\s*\(/.test(content)) {
    violations.push({
      filePath,
      lineNumber: 1,
      ruleName:
        'Metadata rule: missing setTestMetadata({ module, feature }) — add inside test.beforeEach for reporting taxonomy',
      severity: 'warning',
    });
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
      violations.push(...validateSpecFile(specPath, relativeSpecPath));
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
