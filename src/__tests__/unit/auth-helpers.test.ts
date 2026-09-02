/**
 * Unit tests for src/support/auth-helpers.ts
 */
import { test, expect } from '@playwright/test';
import { resolveRoleCredentials } from '@/support/auth-helpers';

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
});
