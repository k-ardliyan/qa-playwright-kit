import { test, expect } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { PLAYWRIGHT_MCP_BASELINE_VERSION, isValidSemver } from '../../shared/mcp/version';

test.describe('MCP Version Governance (MCP-002)', () => {
  test('defines canonical explicit semver baseline', () => {
    expect(PLAYWRIGHT_MCP_BASELINE_VERSION).toBe('0.0.80');
    expect(isValidSemver(PLAYWRIGHT_MCP_BASELINE_VERSION)).toBe(true);
  });

  test('canonical constant agrees with the pinned package.json dependency', () => {
    const pkg = JSON.parse(
      fs.readFileSync(path.resolve(__dirname, '../../../package.json'), 'utf-8'),
    ) as { devDependencies?: Record<string, string> };
    const dep = pkg.devDependencies?.['@playwright/mcp'] ?? '';
    const pinned = dep.match(/(\d+\.\d+\.\d+)/)?.[1];
    expect(pinned).not.toBeNull();
    expect(PLAYWRIGHT_MCP_BASELINE_VERSION).toBe(pinned);
  });

  test('validates valid semver strings', () => {
    expect(isValidSemver('0.0.79')).toBe(true);
    expect(isValidSemver('1.0.0')).toBe(true);
    expect(isValidSemver('1.56.0-alpha.1')).toBe(true);
  });

  test('rejects invalid semver strings or wildcards', () => {
    expect(isValidSemver('latest')).toBe(false);
    expect(isValidSemver('^0.0.79')).toBe(false);
    expect(isValidSemver('*')).toBe(false);
    expect(isValidSemver('')).toBe(false);
  });
});
