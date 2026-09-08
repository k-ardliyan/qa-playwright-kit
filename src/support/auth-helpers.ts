/**
 * Auth Setup Helpers — Modular functions for Playwright auth setup.
 *
 * Provides reusable helpers for:
 * 1. Fast session cache validation (avoids repeated logins if cookies/tokens are still alive).
 * 2. Storage state saving with directory creation.
 * 3. Dynamic role credential resolution from environment variables.
 *
 * @module src/support/auth-helpers
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Page } from '@playwright/test';
import { isKnownAppEnv } from '../utils/app-env';
import {
  isPlaceholderCredential,
  isValidRoleName,
  roleCredentialKeys,
  canonicalRoleName,
} from '../shared/utils/role-credentials';
import { authStateFileExpiryVerdict } from '../shared/mcp/auth-probe';
import { pathRoleFromStatePath, runAuthProbeCheck } from './session-guard';

export interface SessionValidationOptions {
  authFile: string;
  checkUrl: string;
  loginUrl: string;
}

/**
 * Check whether an existing saved session file is still valid.
 * First a static TTL scan of the session file itself (JWT exp claims and
 * client expiry records — zero config, see auth-probe's expiry scanner):
 * proven-expired files short-circuit to a fresh login without any navigation.
 * Then a live navigation: if the browser does not redirect to loginUrl, the
 * session is reused.
 * Returns true if session is still valid, false if expired or missing.
 */
export async function isSessionValid(
  page: Page,
  options: SessionValidationOptions,
): Promise<boolean> {
  const { authFile, checkUrl, loginUrl } = options;
  if (!fs.existsSync(authFile)) {
    return false;
  }

  // Static evidence: JWT exp / expiry records in the file prove death without
  // a browser round-trip (SPA apps that never redirect and swallow 401s).
  if (authStateFileExpiryVerdict(authFile) === true) {
    return false;
  }

  const baseUrl = process.env.BASE_URL ?? '';
  const targetUrl = /^https?:\/\//i.test(checkUrl)
    ? checkUrl
    : `${baseUrl.replace(/\/$/, '')}${checkUrl.startsWith('/') ? checkUrl : `/${checkUrl}`}`;

  try {
    await page.goto(targetUrl, { timeout: 15_000 });
    const currentUrl = page.url();
    const currentPath = getUrlPath(currentUrl);
    const loginPath = getUrlPath(loginUrl);
    // Query strings and unrelated paths containing "login" are not redirects.
    if (currentPath !== loginPath) {
      // Layer 3: workspace probe check (if defined for this role) — the last
      // say on session health for silent apps. Timeout is inconclusive.
      const role = pathRoleFromStatePath(authFile) ?? 'user';
      const probe = await runAuthProbeCheck(page, role, {
        successUrl: checkUrl,
        loginUrl,
      });
      if (probe.outcome === 'failed') {
        return false;
      }
      await page.context().storageState({ path: authFile });
      return true;
    }
  } catch {
    // Network or navigation error -> consider expired and trigger fresh login
    return false;
  }

  return false;
}

function getUrlPath(value: string): string {
  try {
    return new URL(value, 'http://auth-helper.invalid').pathname.replace(/\/$/, '') || '/';
  } catch {
    return value.split(/[?#]/, 1)[0].replace(/\/$/, '') || '/';
  }
}

function normalizeConfiguredPath(value: string | undefined, fallback: string): string {
  const candidate = value?.trim() || fallback;
  if (/^https?:\/\//i.test(candidate)) return candidate;

  let decoded = candidate;
  try {
    decoded = decodeURIComponent(candidate);
  } catch {
    return fallback;
  }

  const normalized = `/${candidate.replace(/^\/+/, '')}`;
  const hasTraversal =
    decoded.includes('\\') || decoded.split('/').some((segment) => segment === '..');
  return normalized === '/' || hasTraversal ? fallback : normalized;
}

/**
 * Save browser storage state (cookies, localStorage origins) to the target authFile.
 * Ensures the parent directory exists before writing.
 */
export async function saveSessionState(page: Page, authFile: string): Promise<void> {
  const dir = path.dirname(authFile);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  await page.context().storageState({ path: authFile });
}

export interface ResolvedRoleCredentials {
  loginId: string;
  idKind: 'email' | 'username' | 'phone';
  password: string;
  loginUrl: string;
  successUrl: string;
  authFile: string;
}

/**
 * Resolve credentials and paths for a specific role dynamically from process.env.
 */
export function resolveRoleCredentials(
  roleName: string,
  appEnv = process.env.APP_ENV ?? 'local',
): ResolvedRoleCredentials {
  const requestedRole = canonicalRoleName(roleName);
  const name = isValidRoleName(requestedRole) ? requestedRole : 'user';
  const requestedEnv = appEnv.trim().toLowerCase();
  const safeEnv = isKnownAppEnv(requestedEnv) ? requestedEnv : 'local';
  const ref = roleCredentialKeys(name, safeEnv);

  const pref = (process.env[ref.loginIdPrefKey] ?? '').trim().toLowerCase();
  const email = (process.env[ref.emailKey] ?? '').trim();
  const username = (process.env[ref.usernameKey] ?? '').trim();
  const phone = (process.env[ref.phoneKey] ?? '').trim();
  const password = (process.env[ref.passwordKey] ?? '').trim();

  const roleLoginUrl = normalizeConfiguredPath(
    process.env[ref.loginUrlPathKey] || process.env.AUTH_LOGIN_URL_PATH,
    '/login',
  );
  const roleSuccessUrl = normalizeConfiguredPath(
    process.env[ref.successUrlPathKey] || process.env.AUTH_SUCCESS_URL_PATH,
    '/dashboard',
  );

  const usableEmail = isPlaceholderCredential(email) ? '' : email;
  const usableUsername = isPlaceholderCredential(username) ? '' : username;
  const usablePhone = isPlaceholderCredential(phone) ? '' : phone;
  const preferredLoginId =
    pref === 'email'
      ? usableEmail
      : pref === 'username'
        ? usableUsername
        : pref === 'phone'
          ? usablePhone
          : '';
  const loginId = preferredLoginId || usableEmail || usableUsername || usablePhone;

  const idKind: 'email' | 'username' | 'phone' = preferredLoginId
    ? (pref as 'email' | 'username' | 'phone')
    : usableEmail
      ? 'email'
      : usableUsername
        ? 'username'
        : usablePhone
          ? 'phone'
          : 'email';

  return {
    loginId,
    idKind,
    password,
    loginUrl: roleLoginUrl,
    successUrl: roleSuccessUrl,
    authFile: ref.authFile,
  };
}
