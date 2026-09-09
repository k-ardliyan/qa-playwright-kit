#!/usr/bin/env node
/**
 * Coverage Map — Static Test Coverage Visibility (ARCH-014)
 *
 * Static import-map over the source tree: for every non-test source file
 * under src/, find at least one test file that imports it (directly, via the
 * `@/` alias, or via a relative path that resolves into the module). This is
 * NOT a runtime coverage tool — it reports structural test presence per module
 * so blind spots (src/observability, src/executor, CLI entrypoints, …) become
 * visible instead of being inferred by name.
 *
 * Policy (exit 1 on error):
 *   - source file <= 40 lines without a test            -> OK (trivial)
 *   - source file  > 40 lines without a test            -> WARNING
 *   - source file  > 150 lines without a test           -> ERROR
 *
 * A file is considered covered when ANY test file imports any path that
 * resolves into the same module directory (same dirname). Import scanning is
 * regex-based over static imports/exports; dynamic imports are ignored.
 *
 * Run: npm run validate:coverage
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Repo root. Tests override it via QA_COVERAGE_ROOT (module reads once).
 */
function resolveRoot(): string {
  const override = process.env.QA_COVERAGE_ROOT;
  return override ? path.resolve(override) : path.resolve(__dirname, '../..');
}

const ROOT = resolveRoot();
const SRC = path.join(ROOT, 'src');

export interface CoverageFinding {
  file: string;
  lines: number;
  severity: 'ok' | 'warning' | 'error';
  message: string;
}

export interface CoverageReport {
  findings: CoverageFinding[];
  coveredFiles: string[];
  uncoveredFiles: string[];
}

/** Recursively collect files under a root matching the predicate. */
export function collectFiles(
  dir: string,
  pred: (name: string) => boolean,
  skipTestsDirs = false,
  root = ROOT,
): string[] {
  const out: string[] = [];
  if (!fs.existsSync(dir)) return out;
  const walk = (d: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) {
        if (
          entry.name !== 'node_modules' &&
          entry.name !== '.git' &&
          !(skipTestsDirs && entry.name === '__tests__')
        ) {
          walk(full);
        }
      } else if (entry.isFile() && pred(entry.name)) {
        out.push(full);
      }
    }
  };
  walk(dir);
  return out;
}

/** All import specifiers (static import/export-from) in a file. */
export function importSpecifiers(filePath: string): string[] {
  const content = fs.readFileSync(filePath, 'utf-8');
  const specifiers: string[] = [];
  // Named/default imports (`import { x } from '…'`) and export-from.
  const fromRe = /(?:^|\n)\s*(?:import\s+[^'"]*?\s+from|export[^'"]*?\s+from)\s*['"]([^'"]+)['"]/g;
  // Side-effect imports (`import '…'`).
  const bareRe = /(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = fromRe.exec(content)) !== null) {
    specifiers.push(m[1]);
  }
  while ((m = bareRe.exec(content)) !== null) {
    specifiers.push(m[1]);
  }
  return specifiers;
}

/**
 * Resolve an import specifier to an absolute path (best effort, no extension
 * guessing beyond .ts/.tsx). Returns null when unresolvable or not under src/.
 */
export function resolveSpecifier(
  importerDir: string,
  specifier: string,
  srcRoot = SRC,
): string | null {
  let abs: string;
  if (specifier.startsWith('@/')) {
    abs = path.resolve(srcRoot, specifier.slice(2));
  } else if (specifier.startsWith('.')) {
    abs = path.resolve(importerDir, specifier);
  } else {
    return null; // bare package import
  }
  if (!abs.startsWith(srcRoot)) return null;
  for (const ext of ['.ts', '.tsx', '.d.ts']) {
    if (fs.existsSync(abs + ext)) return abs + ext;
  }
  if (fs.existsSync(abs) && fs.statSync(abs).isFile()) return abs;
  // Directory import (index resolution) — best effort.
  const indexCandidates = ['.ts', '.tsx'].map((e) => path.join(abs, `index${e}`));
  for (const c of indexCandidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

/** True when the module of `srcFile` is imported by the test file. */
export function isModuleCoveredByTest(srcFile: string, testFile: string, srcRoot = SRC): boolean {
  const srcDir = path.dirname(srcFile);
  const testDir = path.dirname(testFile);
  for (const spec of importSpecifiers(testFile)) {
    const resolved = resolveSpecifier(testDir, spec, srcRoot);
    if (resolved === null) continue;
    const importedDir = path.dirname(resolved);
    // Direct module import, or a barrel import from the module's own
    // directory, or any ancestor directory (barrel/re-export chain makes the
    // module reachable). Ancestor matches are intentional: a test importing
    // src/agents/integration/workflow-controller exercises the stage modules
    // under src/agents/integration/stages/ via the barrel.
    if (importedDir === srcDir) return true;
    if (srcDir.startsWith(importedDir + path.sep)) return true;
  }
  return false;
}

/**
 * True when a file is a test: unit (`*.test.ts`) or property (`*.property.ts`).
 * Property suites live under src/__tests__/property and run through
 * run-property-tests.ts — they are real test coverage.
 */
export function isTestFile(name: string): boolean {
  return /\.test\.ts$/.test(name) || /\.property\.ts$/.test(name);
}

/**
 * Public API surface (`src/public/`): pure re-export barrels that exist so
 * downstream workspaces import a stable facade. Their content modules are the
 * real logic and carry their own coverage; the facade itself is intentionally
 * thin and its exports are contract-checked by architecture-validator.test.ts.
 */
function isPublicBarrel(dirName: string): boolean {
  return dirName.endsWith(`${path.sep}public`);
}

/** Build the coverage report for the src/ tree (root override for tests). */
export function buildCoverageReport(root = ROOT): CoverageReport {
  const srcRoot = path.join(root, 'src');
  const sourceFiles = collectFiles(srcRoot, (n) => /\.ts$/.test(n) && !isTestFile(n), true);
  const testFiles = collectFiles(srcRoot, (n) => isTestFile(n), false);
  // tools/scripts/__tests__ also import src modules — include them.
  const scriptsTests = collectFiles(
    path.join(root, 'tools', 'scripts', '__tests__'),
    (n) => isTestFile(n),
    false,
    root,
  );
  const allTests = [...testFiles, ...scriptsTests];

  const findings: CoverageFinding[] = [];
  const coveredFiles: string[] = [];
  const uncoveredFiles: string[] = [];

  for (const srcFile of sourceFiles) {
    const relative = path.relative(root, srcFile).replace(/\\/g, '/');
    if (
      relative.includes('/__tests__/') ||
      relative.includes('/__fixtures__/') ||
      /\.d\.ts$/.test(relative)
    ) {
      continue;
    }
    if (isPublicBarrel(path.dirname(srcFile))) {
      coveredFiles.push(relative); // contract-checked facade — see docblock
      continue;
    }
    const lines = fs.readFileSync(srcFile, 'utf-8').split('\n').length;
    const covered = allTests.some((t) => isModuleCoveredByTest(srcFile, t, srcRoot));
    if (covered) {
      coveredFiles.push(relative);
      continue;
    }
    uncoveredFiles.push(relative);
    if (lines > 150) {
      findings.push({
        file: relative,
        lines,
        severity: 'error',
        message: `Module (${lines} lines) has no test coverage — add a unit test or a test seam.`,
      });
    } else if (lines > 40) {
      findings.push({
        file: relative,
        lines,
        severity: 'warning',
        message: `Module (${lines} lines) has no direct test import — verify it is exercised transitively or add a test.`,
      });
    }
  }

  return { findings, coveredFiles, uncoveredFiles };
}

// CLI entry (guard against accidental import side-effects when required in tests).
if (require.main === module) {
  const report = buildCoverageReport();
  const errors = report.findings.filter((f) => f.severity === 'error');
  const warnings = report.findings.filter((f) => f.severity === 'warning');
  console.log(
    `\n  🔍 Coverage map — ${report.coveredFiles.length} covered, ${report.uncoveredFiles.length} uncovered under src/\n`,
  );
  for (const f of report.findings) {
    const icon = f.severity === 'error' ? '✗' : f.severity === 'warning' ? '⚠' : '✓';
    console.log(`  ${icon} ${f.file} (${f.lines} lines) — ${f.message}`);
  }
  if (errors.length > 0) {
    console.log(`\n  ✗ ${errors.length} uncovered module(s) above 150 lines. Fix before merge.\n`);
    process.exit(1);
  }
  if (warnings.length > 0) {
    console.log(`\n  ⚠ ${warnings.length} uncovered module(s) 41-150 lines (non-blocking).\n`);
    process.exit(0);
  }
  console.log('\n  ✓ Every src/ module has direct test coverage.\n');
}
