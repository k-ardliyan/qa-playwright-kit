/**
 * Unit tests for src/support/auth-helpers.ts
 */
import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { isSessionValid, saveSessionState, resolveRoleCredentials } from '@/support/auth-helpers';
import { runAuthProbeCheck } from '@/support/session-guard';
import { authProbeChecks } from '@/support/auth.probe';

/**
 * AUTH_FORCE_LOGIN is NOT observable through the exported helpers: it gates
 * the `isSessionValid` CALL inside loginRole (template-generated, not
 * exported). It is covered at the template level instead —
 * tools/scripts/__tests__/wizard-auth-template.test.ts asserts the
 * `process.env.AUTH_FORCE_LOGIN === 'true'` and `if (!forceLogin)` gates are
 * emitted by generateAuthSetupContent.
 */

/**
 * Minimal Page-like object covering only the surface isSessionValid touches:
 * goto / url / context().storageState. No browser needed — the unit config
 * (config/playwright/unit.ts) does not launch browsers.
 */
function makeMockPage(
  opts: { urlValue?: string; gotoError?: Error } = {},
): Page & { gotoCalls: string[]; storageWrites: string[] } {
  const gotoCalls: string[] = [];
  const storageWrites: string[] = [];
  const page = {
    async goto(url: string): Promise<unknown> {
      gotoCalls.push(url);
      if (opts.gotoError) throw opts.gotoError;
      return null;
    },
    url: () => opts.urlValue ?? '',
    context: () => ({
      async storageState(o: { path: string }): Promise<unknown> {
        storageWrites.push(o.path);
        return {};
      },
    }),
  } as unknown as Page;
  return Object.assign(page, { gotoCalls, storageWrites });
}

function writeAuthFile(dir: string, role: string, payload: unknown): string {
  fs.mkdirSync(path.join(dir, '.auth', 'local'), { recursive: true });
  const authFile = path.join(dir, '.auth', 'local', `${role}.json`);
  fs.writeFileSync(authFile, JSON.stringify(payload), 'utf-8');
  return authFile;
}

/** JWT with a past `exp` — proves static expiry without a browser. */
function expiredJwt(): string {
  const enc = (o: Record<string, unknown>): string =>
    Buffer.from(JSON.stringify(o), 'utf8').toString('base64url');
  return `${enc({ alg: 'none' })}.${enc({ exp: 1_000 })}.`;
}

test.describe('resolveRoleCredentials', () => {
  const savedEnv = { ...process.env };

  test.afterEach(() => {
    process.env = { ...savedEnv };
  });

  test('resolves user default role credentials and fallback paths', () => {
    process.env.TEST_USER_USERNAME = 'user_test';
    process.env.TEST_USER_PASSWORD = 'password123';
    delete process.env.TEST_USER_LOGIN_URL_PATH;
    delete process.env.TEST_USER_SUCCESS_URL_PATH;
    delete process.env.AUTH_LOGIN_URL_PATH;
    delete process.env.AUTH_SUCCESS_URL_PATH;

    const cred = resolveRoleCredentials('user', 'dev');
    expect(cred.loginId).toBe('user_test');
    expect(cred.idKind).toBe('username');
    expect(cred.password).toBe('password123');
    expect(cred.loginUrl).toBe('/login');
    expect(cred.successUrl).toBe('/dashboard');
    expect(cred.authFile).toBe('.auth/dev/user.json');
  });

  test('resolves role-specific custom login and success paths', () => {
    process.env.ADMIN_USERNAME = 'admin_boss';
    process.env.ADMIN_PASSWORD = 'secret-admin';
    process.env.ADMIN_LOGIN_URL_PATH = '/admin/portal/login';
    process.env.ADMIN_SUCCESS_URL_PATH = '/admin/home';

    const cred = resolveRoleCredentials('admin', 'staging');
    expect(cred.loginId).toBe('admin_boss');
    expect(cred.password).toBe('secret-admin');
    expect(cred.loginUrl).toBe('/admin/portal/login');
    expect(cred.successUrl).toBe('/admin/home');
    expect(cred.authFile).toBe('.auth/staging/admin.json');
  });

  test('falls back to global AUTH_LOGIN_URL_PATH if role-specific path unset', () => {
    process.env.GURU_EMAIL = 'guru@sekolah.sch.id';
    process.env.GURU_PASSWORD = 'secret-guru';
    process.env.AUTH_LOGIN_URL_PATH = '/global/login';
    process.env.AUTH_SUCCESS_URL_PATH = '/global/dashboard';
    delete process.env.GURU_LOGIN_URL_PATH;
    delete process.env.GURU_SUCCESS_URL_PATH;

    const cred = resolveRoleCredentials('guru', 'production');
    expect(cred.loginUrl).toBe('/global/login');
    expect(cred.successUrl).toBe('/global/dashboard');
  });

  test('preserves absolute login and success URLs', () => {
    process.env.ADMIN_USERNAME = 'admin_boss';
    process.env.ADMIN_PASSWORD = 'secret-admin';
    process.env.ADMIN_LOGIN_URL_PATH = 'https://auth.example.test/sign-in';
    process.env.ADMIN_SUCCESS_URL_PATH = 'https://app.example.test/overview';

    const cred = resolveRoleCredentials('admin', 'staging');
    expect(cred.loginUrl).toBe('https://auth.example.test/sign-in');
    expect(cred.successUrl).toBe('https://app.example.test/overview');
  });

  test('falls back from placeholder email to username, then phone', () => {
    process.env.TEST_USER_EMAIL = 'test@example.com';
    process.env.TEST_USER_USERNAME = 'user_test';
    process.env.TEST_USER_PHONE = '+628123456789';
    process.env.TEST_USER_LOGIN_ID_PREF = 'email';
    expect(resolveRoleCredentials('user', 'local')).toMatchObject({
      loginId: 'user_test',
      idKind: 'username',
    });

    process.env.TEST_USER_USERNAME = 'your_username_here';
    expect(resolveRoleCredentials('user', 'local')).toMatchObject({
      loginId: '+628123456789',
      idKind: 'phone',
    });
  });

  test('normalizes valid role and environment names and rejects traversal', () => {
    process.env.ADMIN_USERNAME = 'admin_boss';
    process.env.ADMIN_PASSWORD = 'secret-admin';

    expect(resolveRoleCredentials(' ADMIN ', ' STAGING ')).toMatchObject({
      authFile: '.auth/staging/admin.json',
    });
    expect(resolveRoleCredentials('../admin', '../../outside')).toMatchObject({
      authFile: '.auth/local/user.json',
    });
  });
});

test.describe('isSessionValid', () => {
  const savedEnv = { ...process.env };

  test.beforeEach(() => {
    process.env = { ...savedEnv };
    process.env.BASE_URL = 'https://app.test';
  });

  test.afterEach(() => {
    process.env = { ...savedEnv };
  });

  test('missing auth file → invalid, without any navigation', async () => {
    const page = makeMockPage();
    const valid = await isSessionValid(page, {
      authFile: path.join(os.tmpdir(), 'does-not-exist-user.json'),
      checkUrl: '/dashboard',
      loginUrl: '/login',
    });
    expect(valid).toBe(false);
    expect(page.gotoCalls).toEqual([]);
  });

  test('statically expired session file → invalid, no navigation', async () => {
    const authFile = writeAuthFile(fs.mkdtempSync(path.join(os.tmpdir(), 'auth-helper-')), 'user', {
      cookies: [{ name: 'token', value: expiredJwt() }],
      origins: [],
    });
    const page = makeMockPage({ urlValue: 'https://app.test/dashboard' });
    const valid = await isSessionValid(page, {
      authFile,
      checkUrl: '/dashboard',
      loginUrl: '/login',
    });
    expect(valid).toBe(false);
    expect(page.gotoCalls).toEqual([]);
  });

  test('successful navigation (no login redirect, probe skipped) → valid + storage refresh', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'auth-helper-'));
    const authFile = writeAuthFile(dir, 'user', { cookies: [], origins: [] });
    const page = makeMockPage({
      urlValue: 'https://app.test/dashboard',
    });
    const valid = await isSessionValid(page, {
      authFile,
      checkUrl: '/dashboard',
      loginUrl: '/login',
    });
    expect(valid).toBe(true);
    // relative checkUrl joined against BASE_URL
    expect(page.gotoCalls).toEqual(['https://app.test/dashboard']);
    // refresh saves storageState back to the authFile
    expect(page.storageWrites).toEqual([authFile]);
  });

  test('absolute checkUrl passes through untouched (no BASE_URL join)', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'auth-helper-'));
    const authFile = writeAuthFile(dir, 'user', { cookies: [], origins: [] });
    const page = makeMockPage({
      urlValue: 'https://other.host/x/dashboard',
    });
    const valid = await isSessionValid(page, {
      authFile,
      checkUrl: 'https://other.host/x/dashboard',
      loginUrl: '/login',
    });
    expect(valid).toBe(true);
    expect(page.gotoCalls).toEqual(['https://other.host/x/dashboard']);
  });

  test('login redirect → invalid, no storage refresh', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'auth-helper-'));
    const authFile = writeAuthFile(dir, 'user', { cookies: [], origins: [] });
    const page = makeMockPage({
      urlValue: 'https://app.test/login?next=/dashboard',
    });
    const valid = await isSessionValid(page, {
      authFile,
      checkUrl: '/dashboard',
      loginUrl: '/login',
    });
    expect(valid).toBe(false);
    expect(page.storageWrites).toEqual([]);
  });

  test('does not treat /not-login as a login redirect', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'auth-helper-'));
    const authFile = writeAuthFile(dir, 'user', { cookies: [], origins: [] });
    const page = makeMockPage({ urlValue: 'https://app.test/not-login' });
    const valid = await isSessionValid(page, {
      authFile,
      checkUrl: '/dashboard',
      loginUrl: '/login',
    });
    expect(valid).toBe(true);
    expect(page.storageWrites).toEqual([authFile]);
  });

  test('navigation error → invalid (treated as expired)', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'auth-helper-'));
    const authFile = writeAuthFile(dir, 'user', { cookies: [], origins: [] });
    const page = makeMockPage({
      gotoError: new Error('net::ERR_CONNECTION_RESET'),
    });
    const valid = await isSessionValid(page, {
      authFile,
      checkUrl: '/dashboard',
      loginUrl: '/login',
    });
    expect(valid).toBe(false);
    expect(page.storageWrites).toEqual([]);
  });

  test('role probe check failure → invalid, no storage refresh', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'auth-helper-'));
    // pathRoleFromStatePath derives role "user" from the authFile path
    const authFile = writeAuthFile(dir, 'user', { cookies: [], origins: [] });
    authProbeChecks.user = async () => {
      throw new Error('whoami returned 401');
    };
    try {
      const page = makeMockPage({ urlValue: 'https://app.test/dashboard' });
      const valid = await isSessionValid(page, {
        authFile,
        checkUrl: '/dashboard',
        loginUrl: '/login',
      });
      expect(valid).toBe(false);
      expect(page.storageWrites).toEqual([]);
    } finally {
      delete authProbeChecks.user;
    }
  });
});

test.describe('probe timeout / inconclusive', () => {
  test('hung probe check resolves as timeout outcome, not failed', async () => {
    const outcome = await runAuthProbeCheck(
      makeMockPage(),
      'user',
      { successUrl: '/dashboard', loginUrl: '/login' },
      { user: () => new Promise<void>(() => {}) },
      50,
    );
    // isSessionValid only rejects outcome === 'failed'; timeout is
    // inconclusive → benefit of the doubt → session treated as valid.
    expect(outcome.outcome).toBe('timeout');
    expect(outcome.outcome).not.toBe('failed');
  });

  test('absent probe check → skipped (inconclusive, not failed)', async () => {
    const outcome = await runAuthProbeCheck(
      makeMockPage(),
      'user',
      { successUrl: '/dashboard', loginUrl: '/login' },
      {},
      50,
    );
    expect(outcome.outcome).toBe('skipped');
  });
});

test.describe('saveSessionState', () => {
  test('writes storage state and creates missing parent directories', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'auth-helper-'));
    const authFile = path.join(dir, 'deep', 'nested', '.auth', 'local', 'user.json');
    const page = makeMockPage();
    await saveSessionState(page, authFile);
    expect(page.storageWrites).toEqual([authFile]);
    expect(fs.existsSync(path.join(dir, 'deep', 'nested', '.auth', 'local'))).toBe(true);
  });
});
