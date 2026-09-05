/**
 * Session Guard — fast-fail when the provisioned session is dead.
 *
 * A session that expires mid-run surfaces as locator timeouts against the
 * login page (30s per test), which the healer misclassifies as `locator` and
 * "fixes" by patching locators on the wrong page. This guard fails fast with
 * an error message that matches the failure-classifier auth regex
 * (`redirected to login`) so every test in the file reports
 * `failureSource: 'env'` and the Auth Recovery Protocol applies
 * (re-run `npm run auth:setup` — real UI login; never inject storage state).
 *
 * Wired as an auto fixture in `framework.fixture.ts` that depends on the
 * resolved `storageState` option. Unauthenticated specs (empty/default
 * storageState) are skipped — login-page scenarios are legitimate there.
 *
 * @module src/support/session-guard
 */
import * as path from 'node:path';
import type { Page } from '@playwright/test';
import { authStateFileExpiryVerdict } from '../shared/mcp/auth-probe';
import { authProbeChecks, type AuthProbeCheck } from './auth.probe';

const GUARD_NAV_TIMEOUT_MS = 10_000;
const SETTLE_WAIT_MS = 3_000;
const PROBE_TIMEOUT_MS = 10_000;

/** True when the failure-classifier auth regex will match this message. */
export function isAuthClassifierMessage(message: string): boolean {
  return /storage.?state|unauthorized|401|403|login required|session expired|redirected to login|sign in required|credentials expired/i.test(
    message,
  );
}

/** Deterministic failure message consumed by the healer + classifier. */
export function sessionExpiredMessage(role: string, loginUrl: string): string {
  return `SESSION EXPIRED for role "${role}" — redirected to login (${loginUrl}). Re-run: npm run auth:setup (real UI login; never inject storage state).`;
}

/**
 * Navigate to `checkUrl` with the spec's storageState already applied, and
 * watch for 401/403 responses while the app boots.
 *
 * Detection layers (in order, conservative — fires only on evidence):
 * 0. Static TTL scan of the session file (auto-discovered JWT `exp` claims and
 *    client expiry records — zero app-specific config; runs before any
 *    navigation, immune to apps rewriting localStorage at boot).
 * 1. Redirect to the login path (classic server-side/session-cookie apps).
 * 2. Any 401/403 API response during the check window (SPA that stays on the
 *    same URL but gets rejected on data fetches).
 * 3. Custom per-role probe hook (`src/support/auth.probe.ts`) — real Playwright
 *    assertions written by the workspace (DOM / API / storage) for apps that
 *    give no automatic signal at all.
 */
export async function checkSessionRedirect(
  page: Page,
  checkUrl: string,
): Promise<{ redirectedToLogin: boolean; finalUrl: string }> {
  const baseUrl = (process.env.BASE_URL ?? '').replace(/\/$/, '');
  const target = /^https?:\/\//i.test(checkUrl)
    ? checkUrl
    : `${baseUrl}${checkUrl.startsWith('/') ? checkUrl : `/${checkUrl}`}`;

  const authRejections: string[] = [];
  const onResponse = (response: { status: () => number; url: () => string }): void => {
    if (response.status() === 401 || response.status() === 403) {
      authRejections.push(`${response.status()} ${response.url()}`);
    }
  };
  page.on('response', onResponse);

  try {
    await page.goto(target, { timeout: GUARD_NAV_TIMEOUT_MS, waitUntil: 'domcontentloaded' });
  } catch {
    // Unreachable app: let the test's own asserts fail naturally.
    page.off('response', onResponse);
    return { redirectedToLogin: false, finalUrl: page.url() || target };
  }

  const finalUrl = page.url();
  const loginPath = (process.env.AUTH_LOGIN_URL_PATH || '/login').replace(/\/$/, '');
  const redirectedToLogin =
    finalUrl.includes(loginPath) || /(^|\/)(login|signin|sign-in|masuk)([/?#]|$)/i.test(finalUrl);

  if (!redirectedToLogin) {
    // Give client-side routers a beat to issue their auth calls/redirect.
    await page.waitForTimeout(SETTLE_WAIT_MS);
  }

  const rejected = authRejections.length > 0;
  page.off('response', onResponse);
  return { redirectedToLogin: redirectedToLogin || rejected, finalUrl: page.url() };
}

/** Result of running the per-role auth probe check (CC-AUTH-RECOVERY layer 3). */
export type AuthProbeOutcome = {
  outcome: 'passed' | 'failed' | 'skipped' | 'timeout';
  reason?: string;
};

class ProbeTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`auth probe check exceeded ${timeoutMs}ms`);
  }
}

/**
 * Run the workspace-defined probe check for `role` (src/support/auth.probe.ts).
 * Any error thrown by the check marks the session expired; a hung check is
 * treated as INCONCLUSIVE (timeout) to keep the framework's no-false-positive
 * guarantee. No check for the role → skipped.
 */
export async function runAuthProbeCheck(
  page: Page,
  role: string,
  ctx: { successUrl: string; loginUrl: string },
  checks: Record<string, AuthProbeCheck> = authProbeChecks,
  timeoutMs = PROBE_TIMEOUT_MS,
): Promise<AuthProbeOutcome> {
  const check = checks?.[role];
  if (!check) {
    return { outcome: 'skipped' };
  }
  try {
    await Promise.race([
      check(page, { role, ...ctx }),
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new ProbeTimeoutError(timeoutMs)), timeoutMs);
      }),
    ]);
    return { outcome: 'passed' };
  } catch (error) {
    if (error instanceof ProbeTimeoutError) {
      return { outcome: 'timeout', reason: error.message };
    }
    return {
      outcome: 'failed',
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Auto-fixture body: throws the classifier-matching session-expired error when
 * an authenticated spec shows auth rejection (redirect, 401/403, or missing
 * success marker). Best-effort — internal failure is swallowed so the suite
 * never breaks because of the guard itself.
 *
 * `storageState` MUST come from the fixture dependency (resolved option), NOT
 * `testInfo.project.use.storageState` — the latter reflects the project config
 * only and ignores describe-level `test.use({ storageState })` overrides
 * (verified empirically against Playwright 1.62).
 */
export async function sessionGuardFixture(
  page: Page,
  storageState: unknown,
  run: () => Promise<void>,
): Promise<void> {
  const statePath =
    typeof storageState === 'string' && storageState.length > 0 ? storageState : null;
  if (!statePath) {
    await run();
    return;
  }
  const role = pathRoleFromStatePath(statePath) ?? 'user';
  const checkUrl =
    process.env[roleSessionCheckKey(role)] || process.env.AUTH_SUCCESS_URL_PATH || '/dashboard';
  const loginUrl = process.env.AUTH_LOGIN_URL_PATH || '/login';

  // Layer 0 (static, zero-config): the session file itself carries TTL
  // evidence — auto-discovered JWT `exp` claims and client expiry records.
  // Resolves without any navigation, so a provably dead session fails the
  // test instantly with zero network cost.
  const stateFile = path.isAbsolute(statePath) ? statePath : path.resolve(statePath);
  if (authStateFileExpiryVerdict(stateFile) === true) {
    throw new Error(sessionExpiredMessage(role, loginUrl));
  }

  const { redirectedToLogin } = await checkSessionRedirect(page, checkUrl);
  if (redirectedToLogin) {
    throw new Error(sessionExpiredMessage(role, loginUrl));
  }

  // Layer 3: workspace-defined probe check (stronger & customizable successor
  // of the old text marker — real Playwright assertions, per role).
  const probe = await runAuthProbeCheck(page, role, { successUrl: checkUrl, loginUrl });
  if (probe.outcome === 'failed') {
    throw new Error(
      `${sessionExpiredMessage(role, loginUrl)} (auth probe: ${probe.reason ?? 'check failed'})`,
    );
  }

  await run();
}

function roleSessionCheckKey(role: string): string {
  const suffix = role.trim().toUpperCase().replace(/-/g, '_');
  return `AUTH_${suffix}_SUCCESS_URL_PATH`;
}

/** Extract `<role>` from `.auth/{env}/{role}.json` (POSIX or Windows separators). */
export function pathRoleFromStatePath(statePath: string): string | null {
  const normalized = statePath.replace(/\\/g, '/');
  const match = /\.auth\/[^/]+\/([^/]+)\.json$/.exec(normalized);
  return match ? match[1] : null;
}
