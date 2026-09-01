/// <reference types="node" />

// Feature: safety.ts, Property: getRepoRoot anchors via mcp-server/ marker
// and resolveAllowedPath rejects cross-repo paths.

import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { findRepoRoot, getRepoRoot, resolveAllowedPath } from '../../../tools/mcp/src/utils/safety';

function runCase(label: string, assertFn: () => void): void {
  try {
    assertFn();
    process.stdout.write(`✓ ${label}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stdout.write(`✗ ${label}\n   ${message}\n`);
    process.exitCode = 1;
  }
}

runCase('findRepoRoot walks up to mcp-server/ marker', () => {
  // Start from a deep child of the repo (the test files themselves live in
  // src/tests/property, which is many directories under the repo root).
  const start = __dirname;
  const root = findRepoRoot(start);
  const mcpServerDir = path.join(root, 'tools/mcp');
  assert.ok(fs.existsSync(mcpServerDir), `mcp-server/ must exist at ${mcpServerDir}`);
  assert.ok(
    fs.existsSync(path.join(root, 'package.json')),
    `package.json must exist at repo root ${root}`,
  );
});

runCase('getRepoRoot returns the same value as findRepoRoot(__dirname)', () => {
  assert.equal(getRepoRoot(), findRepoRoot(__dirname));
});

runCase('resolveAllowedPath accepts repo-relative requirements paths', () => {
  const result = resolveAllowedPath('requirements/auth/login-none.md', 'requirements', {
    mustExist: false,
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.relativePath, 'requirements/auth/login-none.md');
  }
});

runCase('resolveAllowedPath accepts nested requirements paths (domain subfolder support)', () => {
  const result = resolveAllowedPath('requirements/auth/login-flow.md', 'requirements', {
    mustExist: false,
  });
  assert.equal(result.ok, true);
});

runCase('resolveAllowedPath rejects test-results outside the repo (security gate)', () => {
  // The new `get_test_failures` tool gates resultsDir via resolveAllowedPath
  // with kind='test-results'. A request for /etc or C:\Windows\System32 must
  // be rejected as PATH_NOT_ALLOWED or PATH_TRAVERSAL.
  const result = resolveAllowedPath('/etc', 'test-results', { mustExist: false });
  assert.equal(result.ok, false);
});

runCase('resolveAllowedPath rejects parent-traversal paths', () => {
  const result = resolveAllowedPath('../requirements/auth/login-none.md', 'requirements', {
    mustExist: false,
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.code, 'PATH_TRAVERSAL');
  }
});
