import type { Page } from '@playwright/test';

/**
 * Auth Probe Checks — CC-AUTH-RECOVERY layer 3 (customizable, per-role).
 *
 * The framework auto-detects a dead session via:
 *   layer 0 — static TTL scan of the session file (JWT `exp` claims, expiry
 *             records; zero config)
 *   layer 1 — redirect to the login path
 *   layer 2 — 401/403 API responses during the initial navigation
 *
 * Some apps give NO signal at all: they never redirect, swallow 401s, and keep
 * no scannable TTL evidence — they just render an identical-looking shell.
 * For those, define a per-role probe check here. The check runs on the role's
 * success URL right after the guard navigation; it must PASS when the session
 * is alive. Any thrown error (e.g. a locator wait timing out) marks the
 * session as expired and triggers the Auth Recovery Protocol.
 *
 * This is regular Playwright code — assert anything: DOM, `page.request` API
 * calls, storage, URLs. Keep checks fast (they run once per test via the
 * session guard, and once per `auth:setup` reuse gate).
 *
 * Example:
 *
 *   admin: async (page) => {
 *     await page.getByTestId('user-menu').waitFor({ state: 'visible', timeout: 5_000 });
 *   },
 *   user: async (page, { successUrl }) => {
 *     const me = await page.request.get('/api/me');
 *     if (me.status() !== 200) throw new Error(`whoami returned ${me.status()}`);
 *   },
 */
export interface AuthProbeContext {
  role: string;
  /** URL the guard navigated to before running this check. */
  successUrl: string;
  /** Login path configured for the role (for error messages / assertions). */
  loginUrl: string;
}

export type AuthProbeCheck = (page: Page, ctx: AuthProbeContext) => Promise<void>;

/** Role → session-health check. Leave empty when every role is covered by layers 0–2. */
export const authProbeChecks: Record<string, AuthProbeCheck> = {
  // user: async (page) => {
  //   await page.getByText('Dashboard').waitFor({ state: 'visible', timeout: 5_000 });
  // },
  // admin: async (page) => {
  //   await page.getByTestId('user-menu').waitFor({ state: 'visible', timeout: 5_000 });
  // },
};
