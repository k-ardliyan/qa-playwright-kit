import { test, expect } from '@playwright/test';
import {
  assessPlaywrightMcp,
  normalizePinnedVersion,
  healthCheck,
} from '../../../tools/mcp/src/tools/health-check';

test.describe('MCP Health Check expected-vs-installed (MCP-005)', () => {
  test('reports ok when installed matches the expected baseline', () => {
    const r = assessPlaywrightMcp('0.0.80', '0.0.80');
    expect(r.status).toBe('ok');
    expect(r.message).toContain('expected: 0.0.80');
  });

  test('reports warn (not hard fail) when installed mismatches', () => {
    const r = assessPlaywrightMcp('0.0.79', '0.0.80');
    expect(r.status).toBe('warn');
    expect(r.message).toContain('0.0.79');
    expect(r.message).toContain('expected baseline is 0.0.80');
  });

  test('reports fail when MCP is missing entirely', () => {
    const r = assessPlaywrightMcp(null, '0.0.80');
    expect(r.status).toBe('fail');
    expect(r.message).toContain('npm install');
  });

  test('tolerates an unknown expected baseline', () => {
    const r = assessPlaywrightMcp('0.0.80', null);
    expect(r.status).toBe('ok');
    expect(r.name).toBe('playwright_mcp');
  });
});

test.describe('Pinned baseline parser (health check)', () => {
  test('extracts the exact version from caret, tilde, and bare specs', () => {
    expect(normalizePinnedVersion('^0.0.80')).toBe('0.0.80');
    expect(normalizePinnedVersion('~0.0.80')).toBe('0.0.80');
    expect(normalizePinnedVersion('0.0.80')).toBe('0.0.80');
  });

  test('returns null for missing or unpinnable specs', () => {
    expect(normalizePinnedVersion(undefined)).toBeNull();
    expect(normalizePinnedVersion('')).toBeNull();
    expect(normalizePinnedVersion('latest')).toBeNull();
    expect(normalizePinnedVersion('*')).toBeNull();
  });
});

test.describe('Health check auth strictness (code gate vs pipeline pre-flight)', () => {
  test('default is strict: an expired/missing session may fail the pre-flight', () => {
    const output = healthCheck();
    expect(output.checks.map((c) => c.name)).toContain('auth_storage');
    // Default call is the MCP pre-flight contract (strictAuth defaults true).
    // Whether it fails depends on this machine's .auth state — assert the
    // contract, not the environment: strict mode never returns the
    // non-strict marker text.
    const authCheck = output.checks.find((c) => c.name === 'auth_storage')!;
    expect(authCheck.message).not.toContain('[strict mode:');
  });

  test('non-strict mode keeps an expired session out of the failure set', () => {
    const output = healthCheck({ strictAuth: false });
    const authCheck = output.checks.find((c) => c.name === 'auth_storage')!;
    // Code-quality contract: session readiness is a warning at most.
    expect(['ok', 'warn']).toContain(authCheck.status);
    if (authCheck.status === 'warn') {
      expect(authCheck.message).toContain('[strict mode: npm run health:check:strict]');
    }
  });
});
