/**
 * Unit tests: session guard helpers (CC-AUTH-RECOVERY support).
 * Guard must produce classifier-matching messages, parse roles from
 * storageState paths, and detect login redirects from env config.
 */
import { test, expect } from '@playwright/test';
import {
  isAuthClassifierMessage,
  pathRoleFromStatePath,
  sessionExpiredMessage,
  runAuthProbeCheck,
} from '../../support/session-guard';
import type { AuthProbeCheck } from '../../support/auth.probe';
import {
  decodeExpiryRecordMs,
  decodeJwtExpiryMs,
  authStateExpiryVerdict,
  probeAuthRoles,
  probeAuthStateFile,
} from '../../shared/mcp/auth-probe';

function makeJwt(payload: Record<string, unknown>): string {
  const enc = (obj: unknown) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  return `${enc({ alg: 'HS256', typ: 'JWT' })}.${enc(payload)}.signature`;
}

test.describe('client-token TTL auto-discovery (layer 0)', () => {
  test('decodes JWT exp claims (epoch seconds)', () => {
    const nowSec = Math.floor(Date.now() / 1000);
    expect(decodeJwtExpiryMs(makeJwt({ sub: 'u', exp: nowSec - 60 }))).toBeLessThan(Date.now());
    expect(decodeJwtExpiryMs(makeJwt({ sub: 'u', exp: nowSec + 3600 }))).toBeGreaterThan(
      Date.now(),
    );
    expect(decodeJwtExpiryMs('not-a-jwt')).toBeNull();
    expect(decodeJwtExpiryMs(makeJwt({ sub: 'u' }))).toBeNull();
  });

  test('recognizes expiry record shapes', () => {
    const now = Date.now();
    expect(
      decodeExpiryRecordMs(JSON.stringify({ loginTime: now - 7200_000 - 60_000, expiresIn: 7200 })),
    ).toBeLessThan(now);
    expect(
      decodeExpiryRecordMs(JSON.stringify({ loginTime: now - 60_000, expiresIn: 7200 })),
    ).toBeGreaterThan(now);
    expect(decodeExpiryRecordMs(JSON.stringify({ exp: Math.floor(now / 1000) - 10 }))).toBeLessThan(
      now,
    );
    expect(
      decodeExpiryRecordMs(JSON.stringify({ expiresAt: new Date(now + 3600_000).toISOString() })),
    ).toBeGreaterThan(now);
    expect(decodeExpiryRecordMs('not-json')).toBeNull();
    expect(decodeExpiryRecordMs(JSON.stringify({ theme: 'dark' }))).toBeNull();
  });

  test('verdict: all evidence expired → dead, any alive → alive, none → null', () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const state = (exp: number) => ({
      cookies: [],
      origins: [
        {
          origin: 'https://app.test',
          localStorage: [{ name: 'token_a', value: makeJwt({ exp }) }],
        },
      ],
    });
    expect(authStateExpiryVerdict(state(nowSec - 60))).toBe(true);
    expect(authStateExpiryVerdict(state(nowSec + 3600))).toBe(false);
    expect(
      authStateExpiryVerdict({
        cookies: [],
        origins: [{ origin: 'x', localStorage: [{ name: 'a', value: 'plain' }] }],
      }),
    ).toBeNull();
  });
});

test.describe('session guard message contract', () => {
  test('expired-session message matches the failure-classifier auth regex', () => {
    const msg = sessionExpiredMessage('finance', '/login');
    expect(isAuthClassifierMessage(msg)).toBe(true);
    expect(msg).toContain('npm run auth:setup');
    expect(msg).toContain('finance');
  });

  test('classifier regex still matches canonical auth errors', () => {
    expect(isAuthClassifierMessage('HTTP 401 unauthorized')).toBe(true);
    expect(isAuthClassifierMessage('net::ERR timed out waiting for locator')).toBe(false);
  });
});

test.describe('pathRoleFromStatePath', () => {
  test('extracts role from posix and windows storageState paths', () => {
    expect(pathRoleFromStatePath('.auth/dev/finance.json')).toBe('finance');
    expect(pathRoleFromStatePath('.auth\\local\\super-admin.json')).toBe('super-admin');
    expect(pathRoleFromStatePath('tests/fixtures/user.json')).toBeNull();
  });
});

test.describe('probeAuthRoles', () => {
  test('missing dir → empty, expired cookies → ready:false, localStorage-only → ready:null', async () => {
    const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const path = await import('node:path');

    expect(probeAuthRoles(path.join(tmpdir(), 'pwkit-nope-zz'))).toEqual([]);

    const dir = mkdtempSync(path.join(tmpdir(), 'pwkit-roles-'));
    try {
      const past = Math.floor(Date.now() / 1000) - 3600;
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        path.join(dir, 'finance.json'),
        JSON.stringify({ cookies: [{ name: 'sid', value: 'x', expires: past }], origins: [] }),
      );
      writeFileSync(
        path.join(dir, 'user.json'),
        JSON.stringify({
          cookies: [],
          origins: [{ origin: 'https://app.test', localStorage: [{ name: 't', value: 'v' }] }],
        }),
      );
      const roles = probeAuthRoles(dir);
      expect(roles.find((r) => r.role === 'finance')).toMatchObject({ ready: false });
      expect(roles.find((r) => r.role === 'user')).toMatchObject({ ready: null });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('localStorage-only session with expired JWT evidence → ready:false (auto-detected)', async () => {
    const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const path = await import('node:path');
    const dir = mkdtempSync(path.join(tmpdir(), 'pwkit-jwt-'));
    try {
      mkdirSync(dir, { recursive: true });
      const enc = (obj: unknown) => Buffer.from(JSON.stringify(obj)).toString('base64url');
      const expiredJwt = `${enc({ alg: 'HS256' })}.${enc({ sub: 'u', exp: Math.floor(Date.now() / 1000) - 60 })}.sig`;
      writeFileSync(
        path.join(dir, 'admin.json'),
        JSON.stringify({
          cookies: [],
          origins: [
            {
              origin: 'https://app.test',
              localStorage: [
                { name: 'token_app', value: expiredJwt },
                {
                  name: 'token_exp_app',
                  value: JSON.stringify({
                    loginTime: Date.now() - 7200_000 - 60_000,
                    expiresIn: 7200,
                  }),
                },
              ],
            },
          ],
        }),
      );
      const probe = probeAuthStateFile(path.join(dir, 'admin.json'));
      expect(probe.status).toBe('expired');
      expect(probe.reason).toContain('localStorage');
      expect(probeAuthRoles(dir)[0]).toMatchObject({ role: 'admin', ready: false });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('probeAuthStateFile reports missing files', () => {
    const probe = probeAuthStateFile('no/such/file.json');
    expect(probe.status).toBe('missing');
    expect(probe.valid).toBe(false);
  });
});

test.describe('auth probe hook (layer 3, customizable)', () => {
  const fakePage = {} as Parameters<AuthProbeCheck>[0];
  const ctx = { successUrl: '/dashboard', loginUrl: '/login' };

  test('skipped when no check is defined for the role', async () => {
    const outcome = await runAuthProbeCheck(fakePage, 'nobody', ctx, {});
    expect(outcome).toEqual({ outcome: 'skipped' });
  });

  test('passed when the check resolves', async () => {
    const checks: Record<string, AuthProbeCheck> = {
      user: async () => {},
    };
    const outcome = await runAuthProbeCheck(fakePage, 'user', ctx, checks, 500);
    expect(outcome).toEqual({ outcome: 'passed' });
  });

  test('failed when the check throws — reason captured for the guard message', async () => {
    const checks: Record<string, AuthProbeCheck> = {
      user: async () => {
        throw new Error('user menu not visible');
      },
    };
    const outcome = await runAuthProbeCheck(fakePage, 'user', ctx, checks, 500);
    expect(outcome.outcome).toBe('failed');
    expect(outcome.reason).toContain('user menu not visible');
  });

  test('timeout is inconclusive (no false positive) — hung check does not hang the guard', async () => {
    const checks: Record<string, AuthProbeCheck> = {
      user: async () => {
        await new Promise(() => {});
      },
    };
    const outcome = await runAuthProbeCheck(fakePage, 'user', ctx, checks, 50);
    expect(outcome.outcome).toBe('timeout');
  });
});
