#!/usr/bin/env node
/**
 * Architecture & Boundary Validator
 *
 * Enforces QA Playwright Kit Hybrid Architecture rules:
 * 1. Boundary enforcement: src/ (core) MUST NOT import from tests/
 * 2. Public API contract: src/public/ must export fixtures, auth, metadata, workspace
 * 3. File placement: No rogue legacy directories (src/tests, test-fixtures, src/pages)
 * 4. Workspace structure: config/qa-kit.workspace.json matches workspace layout
 * 5. Stale string scan: legacy paths in source/config that affect runtime behavior
 * 6. Config structure: playwright.config.ts points to tests/
 * 7. Import boundary: tests/ must not import protected internals
 *
 * Exit codes:
 *   0 = Valid
 *   1 = Architecture violation detected
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  MCP_GENERATED_PAIRS,
  expectedDestContents,
  normalizeNewlines,
} from '../scripts/sync-mcp-generated';

const ROOT = process.cwd();

interface Violation {
  rule: string;
  file?: string;
  message: string;
}

const violations: Violation[] = [];

function checkFileForForbiddenImports(
  filePath: string,
  forbiddenPattern: RegExp,
  ruleName: string,
  errorMsg: string,
): void {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*(?:import|export)\s+.*from\s+['"].*['"]/.test(line)) {
      if (forbiddenPattern.test(line)) {
        violations.push({
          rule: ruleName,
          file: path.relative(ROOT, filePath).replace(/\\/g, '/'),
          message: `Line ${i + 1}: ${errorMsg} (${line.trim()})`,
        });
      }
    }
  }
}

function scanDir(dir: string, ext: string[], onFile: (filePath: string) => void): void {
  if (!fs.existsSync(dir)) return;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules' && entry.name !== '.git' && entry.name !== 'dist') {
        scanDir(fullPath, ext, onFile);
      }
    } else if (entry.isFile()) {
      if (ext.some((e) => entry.name.endsWith(e))) {
        onFile(fullPath);
      }
    }
  }
}

console.log('\n  🔍 Validating QA Playwright Kit Architecture...\n');

// ─── Rule 1: src/ (core engine) must never import from tests/ ───────────────
const srcDir = path.join(ROOT, 'src');
scanDir(srcDir, ['.ts', '.tsx'], (file) => {
  checkFileForForbiddenImports(
    file,
    /from\s+['"](?:\.\.\/)+tests\/|from\s+['"]@\/tests\//,
    'ARCH-001: Core-to-Test Isolation',
    'Core framework files under src/ must not import from tests/ workspace',
  );
});

// ─── Rule 2: Legacy directories must not exist ──────────────────────────────
const legacyDirs = [
  { dir: path.join(ROOT, 'src', 'tests'), name: 'src/tests' },
  { dir: path.join(ROOT, 'src', 'pages'), name: 'src/pages' },
  { dir: path.join(ROOT, 'test-fixtures'), name: 'test-fixtures' },
  { dir: path.join(ROOT, 'example'), name: 'example (use examples/ instead)' },
  { dir: path.join(ROOT, 'mcp-server'), name: 'mcp-server (use tools/mcp/ instead)' },
  { dir: path.join(ROOT, 'scripts'), name: 'scripts (use tools/scripts/ instead)' },
  { dir: path.join(ROOT, 'environments'), name: 'environments (use config/environments/ instead)' },
];

for (const { dir, name } of legacyDirs) {
  if (fs.existsSync(dir)) {
    violations.push({
      rule: 'ARCH-002: Legacy Directory Cleanup',
      message: `Legacy directory '${name}' should not exist in hybrid architecture.`,
    });
  }
}

const legacyFiles = [
  {
    file: path.join(ROOT, 'tools', 'scripts', 'setup-wizard.ts'),
    name: 'tools/scripts/setup-wizard.ts',
    replacement: 'src/setup/index.ts',
  },
];

for (const { file, name, replacement } of legacyFiles) {
  if (fs.existsSync(file)) {
    violations.push({
      rule: 'ARCH-002: Legacy Directory Cleanup',
      file: name,
      message: `Legacy file '${name}' should not exist. Canonical wizard is ${replacement}.`,
    });
  }
}

// ─── Rule 3: Public API entry points must exist ─────────────────────────────
const publicApiFiles = [
  'src/public/index.ts',
  'src/public/fixtures.ts',
  'src/public/auth.ts',
  'src/public/metadata.ts',
  'src/public/workspace.ts',
];

for (const relPath of publicApiFiles) {
  const fullPath = path.join(ROOT, relPath);
  if (!fs.existsSync(fullPath)) {
    violations.push({
      rule: 'ARCH-003: Public API Contract',
      file: relPath,
      message: `Required public API module '${relPath}' is missing.`,
    });
  }
}

// ─── Rule 4: tests/ root test adapter must exist ────────────────────────────
const requiredTestFiles = ['tests/fixtures.ts', 'tests/auth.setup.ts', 'tests/seed.spec.ts'];

for (const relPath of requiredTestFiles) {
  const fullPath = path.join(ROOT, relPath);
  if (!fs.existsSync(fullPath)) {
    violations.push({
      rule: 'ARCH-004: Test Workspace Contract',
      file: relPath,
      message: `Required test workspace file '${relPath}' is missing.`,
    });
  }
}

// ─── Rule 5: Config & Tools structure must exist ────────────────────────────
const requiredConfigDirs = [
  'config/environments',
  'config/playwright',
  'tools/mcp',
  'tools/scripts',
  'tools/validators',
  'artifacts',
];

for (const relPath of requiredConfigDirs) {
  const fullPath = path.join(ROOT, relPath);
  if (!fs.existsSync(fullPath)) {
    if (relPath.startsWith('artifacts')) {
      try {
        fs.mkdirSync(fullPath, { recursive: true });
      } catch {
        // ignore
      }
    }
  }
  if (!fs.existsSync(fullPath)) {
    violations.push({
      rule: 'ARCH-005: Project Layout',
      message: `Required directory '${relPath}' is missing.`,
    });
  }
}

// ─── Rule 6: Stale legacy string references in runtime code ─────────────
// Only check for functional path strings that affect runtime behavior.
// Allowlist: comments, test fixtures/mocks, error messages with "legacy",
// CHANGELOG, migration docs, .hermes/ plans, migration plan, AND the validator itself.
const legacyRuntimePatterns = [
  // Only flag functional path assignments (not comments, not test mocks)
  {
    pattern:
      /(?:path\.join|path\.resolve|testDir|outputDir|jsonOutput|htmlFolder|outputFile)[^(].*src\/tests/,
    message: 'Legacy path "src/tests" still used in runtime config (PATH001)',
  },
  {
    pattern: /(?:path\.join|path\.resolve)\s*[:(].*['"]mcp-server['"]/,
    message: 'Legacy path "mcp-server" still used in runtime config (PATH004)',
  },
  {
    pattern: /(?:path\.join|path\.resolve)\s*[:(].*['"]test-fixtures['"]/,
    message:
      'Legacy path "test-fixtures" still used in runtime code — use tests/data/ or workspace registry (PATH005)',
  },
  {
    pattern: /(?:path\.join|path\.resolve)\s*[:(].*['"]src['"],\s*['"]pages['"]/,
    message:
      'Legacy path "src/pages" still used in runtime code — use tests/pages/ or workspace registry (PATH006)',
  },
];

function isAllowlistedFile(filePath: string): boolean {
  const rel = path.relative(ROOT, filePath).replace(/\\/g, '/');
  return (
    rel.startsWith('CHANGELOG') ||
    rel.startsWith('.hermes/') ||
    rel.startsWith('docs/architecture/') ||
    rel.startsWith('docs/migration/') ||
    rel.startsWith('docs/history/') ||
    // Negative test examples intentionally contain violations for validation test suites
    rel.includes('_BAD_EXAMPLE') ||
    // Test/mock files use old paths as test data, not runtime config
    rel.includes('/__tests__/') ||
    rel.includes('/__test__/') ||
    // The validator itself references legacy dirs in its check definitions
    rel.endsWith('tools/validators/architecture.ts')
  );
}

function scanForLegacyRuntimePaths(dir: string, ext: string[]): void {
  if (!fs.existsSync(dir)) return;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules' && entry.name !== '.git' && entry.name !== 'dist') {
        scanForLegacyRuntimePaths(fullPath, ext);
      }
    } else if (entry.isFile()) {
      if (ext.some((e) => entry.name.endsWith(e))) {
        if (isAllowlistedFile(fullPath)) return;
        const content = fs.readFileSync(fullPath, 'utf-8');
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          // Skip comment lines
          const trimmed = line.trim();
          if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('#'))
            continue;
          for (const { pattern, message } of legacyRuntimePatterns) {
            if (pattern.test(line)) {
              violations.push({
                rule: 'ARCH-006: Legacy Runtime Path',
                file: path.relative(ROOT, fullPath).replace(/\\/g, '/'),
                message: `Line ${i + 1}: ${message} (${line.trim().slice(0, 120)})`,
              });
            }
          }
        }
      }
    }
  }
}

// Scan source and tools for functional legacy path usage (not comments/tests)
scanForLegacyRuntimePaths(path.join(ROOT, 'src'), ['.ts', '.tsx']);
scanForLegacyRuntimePaths(path.join(ROOT, 'tools'), ['.ts', '.tsx']);

// ─── Rule 7: playwright.config.ts testDir resolves to tests (PATH011) ─────
const mainConfigPath = path.join(ROOT, 'playwright.config.ts');
if (fs.existsSync(mainConfigPath)) {
  const configContent = fs.readFileSync(mainConfigPath, 'utf-8');
  if (!/testDir:\s*['"]\.\/tests['"]/.test(configContent)) {
    violations.push({
      rule: 'ARCH-007: Test Root Config',
      file: 'playwright.config.ts',
      message: 'playwright.config.ts testDir must be "./tests" (PATH011)',
    });
  }
}

// ─── Rule 8: setup project resolves to tests/auth.setup.ts (PATH012) ──────
if (fs.existsSync(mainConfigPath)) {
  const configContent = fs.readFileSync(mainConfigPath, 'utf-8');
  // Check for setup project with testDir: ./tests
  const hasSetupProject = /name:\s*['"]setup['"]/.test(configContent);
  const setupHasCorrectTestDir = /name:\s*['"]setup['"][\s\S]*?testDir:\s*['"]\.\/tests['"]/.test(
    configContent,
  );
  if (!hasSetupProject || !setupHasCorrectTestDir) {
    violations.push({
      rule: 'ARCH-008: Auth Setup Config',
      file: 'playwright.config.ts',
      message: 'Setup project must have testDir: "./tests" and testMatch: auth.setup.ts (PATH012)',
    });
  }
}

// ─── Rule 9: workspace manifest schema valid (PATH013) ────────────────────
const manifestPath = path.join(ROOT, 'config', 'qa-kit.workspace.json');
if (fs.existsSync(manifestPath)) {
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    const requiredKeys = ['schemaVersion', 'paths', 'ownership'];
    for (const key of requiredKeys) {
      if (!manifest[key]) {
        violations.push({
          rule: 'ARCH-009: Workspace Manifest',
          file: 'config/qa-kit.workspace.json',
          message: `Manifest missing required key: ${key} (PATH013)`,
        });
      }
    }
    if (manifest.paths?.tests !== 'tests') {
      violations.push({
        rule: 'ARCH-009: Workspace Manifest',
        file: 'config/qa-kit.workspace.json',
        message: 'Manifest paths.tests must be "tests" (PATH013)',
      });
    }
    if (manifest.paths?.artifacts !== 'artifacts') {
      violations.push({
        rule: 'ARCH-009: Workspace Manifest',
        file: 'config/qa-kit.workspace.json',
        message: 'Manifest paths.artifacts must be "artifacts" (PATH013)',
      });
    }
  } catch (e) {
    violations.push({
      rule: 'ARCH-009: Workspace Manifest',
      file: 'config/qa-kit.workspace.json',
      message: `Manifest invalid JSON: ${e}`,
    });
  }
} else {
  violations.push({
    rule: 'ARCH-009: Workspace Manifest',
    file: 'config/qa-kit.workspace.json',
    message: 'Manifest file missing (PATH013)',
  });
}

// ─── Rule 10: test data resolves under tests/data (PATH014) ───────────────
const testDataDir = path.join(ROOT, 'tests', 'data');
if (!fs.existsSync(testDataDir)) {
  violations.push({
    rule: 'ARCH-010: Test Data Location',
    message: 'tests/data/ directory must exist (PATH014)',
  });
}

// ─── Rule 11: no forbidden test import into protected internals (PATH015) ──
const testDirs = [path.join(ROOT, 'tests'), path.join(ROOT, 'examples')];
for (const testDir of testDirs) {
  if (!fs.existsSync(testDir)) continue;
  scanDir(testDir, ['.ts', '.tsx'], (file) => {
    checkFileForForbiddenImports(
      file,
      /from\s+['"](?:\.\.\/)+src\/(agents|cli|executor|observability|setup|shared\/internal|support\/internal|utils\/internal)/,
      'ARCH-011: Test-to-Protected Import',
      'Tests must not import protected internal framework areas (PATH015)',
    );
  });
}

// ─── Rule 12: Workspace Path Drift Detection (ARCH-012) ─────────────────────
const workspacePathDriftPatterns = [
  {
    pattern: /(?:path\.join|path\.resolve)\s*\([^)]*['"]src['"],\s*['"]pages['"]/,
    message:
      'Forbidden path literal "src/pages" — Page Objects must resolve to tests/pages from workspace manifest',
  },
  {
    pattern: /(?:path\.join|path\.resolve)\s*\([^)]*['"]src\/pages['"]/,
    message:
      'Forbidden path literal "src/pages" — Page Objects must resolve to tests/pages from workspace manifest',
  },
  {
    pattern: /(?:path\.join|path\.resolve)\s*\([^)]*['"]src['"],\s*['"]tests['"]/,
    message:
      'Forbidden path literal "src/tests" — Test specs must resolve to tests/ from workspace manifest',
  },
  {
    pattern: /(?:path\.join|path\.resolve)\s*\([^)]*['"]src\/tests['"]/,
    message:
      'Forbidden path literal "src/tests" — Test specs must resolve to tests/ from workspace manifest',
  },
  {
    pattern: /(?:path\.join|path\.resolve)\s*\([^)]*['"]mcp-server['"]/,
    message:
      'Forbidden path literal "mcp-server" — MCP server must resolve to tools/mcp from workspace manifest',
  },
];

function scanForWorkspacePathDrift(dir: string, ext: string[]): void {
  if (!fs.existsSync(dir)) return;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules' && entry.name !== '.git' && entry.name !== 'dist') {
        scanForWorkspacePathDrift(fullPath, ext);
      }
    } else if (entry.isFile()) {
      if (ext.some((e) => entry.name.endsWith(e))) {
        if (isAllowlistedFile(fullPath)) return;
        const content = fs.readFileSync(fullPath, 'utf-8');
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          const trimmed = line.trim();
          if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('#'))
            continue;
          for (const { pattern, message } of workspacePathDriftPatterns) {
            if (pattern.test(line)) {
              violations.push({
                rule: 'ARCH-012: WORKSPACE_PATH_DRIFT',
                file: path.relative(ROOT, fullPath).replace(/\\/g, '/'),
                message: `Line ${i + 1}: ${message} (${line.trim().slice(0, 120)})`,
              });
            }
          }
        }
      }
    }
  }
}

scanForWorkspacePathDrift(path.join(ROOT, 'src'), ['.ts', '.tsx']);
scanForWorkspacePathDrift(path.join(ROOT, 'tools'), ['.ts', '.tsx']);

// ─── Rule 13: Ephemeral Browser Ref Leak Prevention (ARCH-013) ───────────────
const ephemeralPatterns = [
  {
    pattern: /(?:\bref\s*:\s*\d+|\bref_\d+|\bdata-mcp-ref)|"ref"\s*:\s*\d+/,
    message: 'Ephemeral browser MCP element ref detected in test/spec code',
  },
  {
    pattern: /\btw-[0-9a-fA-F]{4,}\b/,
    message: 'Ephemeral Playwright CLI trace/debug session handle detected in test/spec code',
  },
  {
    pattern: /\bplaywright-element-\d+\b/,
    message: 'Ephemeral internal Playwright DOM locator detected in test/spec code',
  },
];

function scanForEphemeralRefLeaks(dir: string, ext: string[]): void {
  if (!fs.existsSync(dir)) return;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (
        entry.name !== 'node_modules' &&
        entry.name !== '.git' &&
        entry.name !== 'dist' &&
        entry.name !== '__tests__'
      ) {
        scanForEphemeralRefLeaks(fullPath, ext);
      }
    } else if (entry.isFile()) {
      if (ext.some((e) => entry.name.endsWith(e))) {
        if (isAllowlistedFile(fullPath)) return;
        const content = fs.readFileSync(fullPath, 'utf-8');
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          const trimmed = line.trim();
          if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('#'))
            continue;
          for (const { pattern, message } of ephemeralPatterns) {
            if (pattern.test(line)) {
              violations.push({
                rule: 'ARCH-013: EPHEMERAL_REF_LEAK',
                file: path.relative(ROOT, fullPath).replace(/\\/g, '/'),
                message: `Line ${i + 1}: ${message} (${line.trim().slice(0, 120)}) — Use semantic locators (getByRole, getByLabel) instead.`,
              });
            }
          }
        }
      }
    }
  }
}

scanForEphemeralRefLeaks(path.join(ROOT, 'tests'), ['.ts', '.tsx']);
scanForEphemeralRefLeaks(path.join(ROOT, 'specs'), ['.md', '.json']);

// ─── Rule 14: MCP generated copies must match SoT (ARCH-SYNC-001) ────────────
for (const pair of MCP_GENERATED_PAIRS) {
  const srcAbs = path.join(ROOT, pair.source);
  const destAbs = path.join(ROOT, pair.dest);
  const sourcePosix = pair.source.replace(/\\/g, '/');
  const destPosix = pair.dest.replace(/\\/g, '/');

  if (!fs.existsSync(srcAbs)) {
    violations.push({
      rule: 'ARCH-SYNC-001: MCP_GENERATED_DRIFT',
      file: destPosix,
      message: `Source of truth missing: ${sourcePosix}`,
    });
    continue;
  }
  if (!fs.existsSync(destAbs)) {
    violations.push({
      rule: 'ARCH-SYNC-001: MCP_GENERATED_DRIFT',
      file: destPosix,
      message: `Generated copy missing. Run: npm run sync:mcp-generated`,
    });
    continue;
  }

  const sourceBody = fs.readFileSync(srcAbs, 'utf-8');
  const expected = expectedDestContents(sourceBody, sourcePosix);
  const actual = fs.readFileSync(destAbs, 'utf-8');
  if (normalizeNewlines(actual) !== normalizeNewlines(expected)) {
    violations.push({
      rule: 'ARCH-SYNC-001: MCP_GENERATED_DRIFT',
      file: destPosix,
      message: `Copy diverges from ${sourcePosix}. Run: npm run sync:mcp-generated`,
    });
  }
}

// ─── Reporting ──────────────────────────────────────────────────────────────
if (violations.length > 0) {
  console.error(`  ❌ Architecture violations found (${violations.length}):\n`);
  for (const v of violations) {
    const loc = v.file ? ` [${v.file}]` : '';
    console.error(`  • [${v.rule}]${loc}: ${v.message}`);
  }
  console.error('\n  Please resolve architecture violations before proceeding.\n');
  process.exit(1);
} else {
  console.log('  ✅ All architecture and boundary checks passed cleanly!\n');
  process.exit(0);
}
