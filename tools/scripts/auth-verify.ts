/**
 * Auth Session Verify — live-check per role session (`npm run auth:verify`).
 *
 * For each role with credentials in the active env, launch an ephemeral browser
 * with the saved storage state and navigate to the role's success URL. If the
 * app redirects to the login path the session is dead → re-run
 * `npm run auth:setup` (real UI login — the ONLY session producer; never
 * inject storage state).
 *
 * Static cookie-TTL probe runs first (no browser) and reports expired sessions
 * immediately; `unknown` (localStorage-only) roles get the live check.
 *
 * Exit codes: 0 all checked roles valid · 1 any role expired/missing/unreachable.
 *
 * @module tools/scripts/auth-verify
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { chromium } from 'playwright';
import { bootstrapMcpEnvironment } from './mcp-bootstrap';
import { probeAuthRoles } from '../mcp/src/utils/auth-probe';
import { resolveAppUrl } from '../../src/support/app-url';
import { isSessionValid, resolveRoleCredentials } from '../../src/support/auth-helpers';
import { parseRolesFromEnvMap } from '../../src/shared/utils/role-credentials';

interface RoleOutcome {
  role: string;
  status: 'valid' | 'expired' | 'missing' | 'unreachable';
  detail: string;
}

function discoverRoles(): string[] {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );
  const roles = parseRolesFromEnvMap(env).map((r) => r.name);
  return roles.length > 0 ? roles : ['user'];
}

async function verifyRole(role: string): Promise<RoleOutcome> {
  const cred = resolveRoleCredentials(role);
  const authFile = path.resolve(cred.authFile);

  if (!fs.existsSync(authFile)) {
    return {
      role,
      status: 'missing',
      detail: `${cred.authFile} not found — run: npm run auth:setup`,
    };
  }

  const { launchHeadless } = resolveBrowserPrefs();
  let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;
  try {
    browser = await chromium.launch({ headless: launchHeadless });
    const context = await browser.newContext({ storageState: authFile });
    const page = await context.newPage();
    const valid = await isSessionValid(page, {
      authFile,
      checkUrl: cred.successUrl,
      loginUrl: cred.loginUrl,
    });
    if (valid) {
      return { role, status: 'valid', detail: `session alive (${cred.authFile})` };
    }
    return {
      role,
      status: 'expired',
      detail: `redirected to ${cred.loginUrl} — re-run: npm run auth:setup`,
    };
  } catch (err) {
    return {
      role,
      status: 'unreachable',
      detail: `cannot reach ${resolveAppUrl(cred.successUrl)}: ${err instanceof Error ? err.message : String(err)}`,
    };
  } finally {
    await browser?.close();
  }
}

function resolveBrowserPrefs(): { launchHeadless: boolean } {
  return { launchHeadless: process.env.HEADLESS !== 'false' };
}

async function main(): Promise<void> {
  bootstrapMcpEnvironment(__dirname);

  const roles = discoverRoles();
  const authDir = path.resolve('.auth', process.env.APP_ENV || 'local');
  const staticProbe = probeAuthRoles(authDir);

  // Fast-fail: expired/malformed cookies need no browser.
  const staticDead = staticProbe.filter((r) => roles.includes(r.role) && r.ready === false);
  const staticOk = staticProbe.filter((r) => roles.includes(r.role) && r.ready === true);
  if (staticDead.length > 0) {
    for (const r of staticDead) {
      console.log(`✖ [auth:verify] ${r.role}: EXPIRED — ${r.reason ?? 'session cookies expired'}`);
    }
    console.log(
      '\nFix: npm run auth:setup (real UI login; OTP/CAPTCHA: npm run auth:setup:headed)',
    );
    process.exit(1);
  }

  const liveRoles = roles.filter((role) => !staticOk.some((r) => r.role === role));
  const outcomes: RoleOutcome[] = staticOk.map((r) => ({
    role: r.role,
    status: 'valid',
    detail: 'cookie TTL valid',
  }));

  for (const role of liveRoles) {
    console.log(`ℹ [auth:verify] ${role}: live check → ${resolveRoleCredentials(role).successUrl}`);
    outcomes.push(await verifyRole(role));
  }

  let failures = 0;
  for (const o of outcomes) {
    const mark = o.status === 'valid' ? '✔' : '✖';
    if (o.status !== 'valid') failures++;
    console.log(`${mark} [auth:verify] ${o.role}: ${o.status.toUpperCase()} — ${o.detail}`);
  }

  // Orphan check: files under .auth/ whose role has NO env credentials are
  // almost always duplicated/renamed session files (e.g. `user-2.json` from
  // `cp user.json`). They are NOT valid roles — never reference them.
  const envRoles = new Set(roles);
  const orphans = staticProbe.filter((r) => !envRoles.has(r.role));
  if (orphans.length > 0) {
    console.log(
      `⚠ [auth:verify] orphan session file(s) without env credentials: ${orphans.map((r) => r.role).join(', ')}`,
    );
    console.log(
      '   These look like duplicated/renamed .auth files — a role only exists when ROLE_PASSWORD + identity are in config/environments/{APP_ENV}.env (npm run env:edit), then npm run auth:setup creates its session. Do not reference orphan files in specs.',
    );
  }

  if (failures > 0) {
    console.log(
      '\nFix: npm run auth:setup (real UI login; OTP/CAPTCHA: npm run auth:setup:headed).',
    );
    console.log(
      'Never inject storage state manually (browser_set_storage_state / addCookies / localStorage).',
    );
    process.exit(1);
  }
  console.log('\nAll role sessions valid.');
}

main().catch((err: unknown) => {
  console.error('[auth:verify] fatal:', err instanceof Error ? err.message : err);
  process.exit(1);
});
