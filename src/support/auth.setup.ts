import * as fs from 'node:fs';
import { test as setup, test } from '@playwright/test';
import {
  parseRolesFromEnvMap,
  roleCredentialKeys,
  isPlaceholderCredential,
  type RoleCredentialRef,
} from '../shared/utils/role-credentials';
import type { Page } from '@playwright/test';
import { setTestMetadata, captureActualResult } from './test-metadata';
import { isSessionValid, saveSessionState, resolveRoleCredentials } from './auth-helpers';
import {
  handlePostLoginChallenge,
  resolveChallengeMode,
  isInteractiveChallengeMode,
  resolveChallengeTimeoutMs,
} from './human-challenge';
import { resolveAppUrl } from './app-url';

/**
 * Auth Setup — modular, customizable login runner.
 *
 * Roles in scope: user (fully role-aware — no general/user mode)
 *
 * Runs once during setup project to materialize .auth/{APP_ENV}/<role>.json.
 * If your app requires extra login steps (profile picker, tenant selector, 2-step login),
 * you can customize the steps inside without fear of being overwritten.
 *
 * Run: npm run auth:setup  |  npm run auth:setup:headed
 */

// ─── Shared login helper — satu implementasi untuk semua role ─────────────────

/**
 * Optional per-role URL overrides (customizable without being overwritten).
 * Shape: { [roleName]: { loginUrl?: string; successUrl?: string } }
 */
const ROLE_URL_OVERRIDES: Record<string, { loginUrl?: string; successUrl?: string } | undefined> =
  {};

async function loginRole(roleName: string, page: Page): Promise<void> {
  const cred = resolveRoleCredentials(roleName);
  const authFile = cred.authFile; // scoped: .auth/{APP_ENV}/<role>.json
  const overrides = ROLE_URL_OVERRIDES[roleName] ?? null;
  const roleLoginUrl = cred.loginUrl || (overrides?.loginUrl ?? '/login');
  const roleSuccessUrl = cred.successUrl || (overrides?.successUrl ?? '/dashboard');
  console.log(`ℹ [Auth] Menyiapkan session untuk role: "${roleName}"...`);

  setTestMetadata({
    testId: `TC-AUTH-SETUP-${roleName.toUpperCase().replace(/-/g, '_')}`,
    priority: 'HIGH',
    role: roleName,
    module: 'auth',
    feature: 'session-bootstrap',
    affectedLayer: ['FE', 'BE'],
    inputData: {
      identifier: `credential:${roleName}.${cred.idKind}`,
      password: `credential:${roleName}.password`,
    },
    expectedResult: 'Sesi login aktif tersimpan di ' + authFile,
  });

  const roleRef = roleCredentialKeys(roleName);
  const missing = [] as string[];
  if (isPlaceholderCredential(process.env[roleRef.passwordKey])) missing.push(roleRef.passwordKey);
  if (
    [roleRef.emailKey, roleRef.usernameKey, roleRef.phoneKey].every((key) =>
      isPlaceholderCredential(process.env[key]),
    )
  ) {
    missing.push('one of ' + [roleRef.emailKey, roleRef.usernameKey, roleRef.phoneKey].join(', '));
  }
  if (missing.length > 0) {
    throw new Error(
      `Auth setup cannot authenticate role "${roleName}": missing or placeholder credentials (${missing.join('; ')}).`,
    );
  }

  const forceLogin = process.env.AUTH_FORCE_LOGIN === 'true';

  // 1. Cek apakah session yang ada masih valid (skip jika AUTH_FORCE_LOGIN=true)
  if (!forceLogin) {
    const valid = await isSessionValid(page, {
      authFile,
      checkUrl: roleSuccessUrl,
      loginUrl: roleLoginUrl,
    });
    if (valid) {
      console.log(`✔ [Auth] Session ${roleName} masih valid, reuse session.`);
      captureActualResult(`Session ${roleName} masih valid (reused), tersimpan di ` + authFile);
      return;
    }
  }

  // 2. Fresh Login Flow — must start from a CLEAN context: the setup test may
  // carry the role's previous session (setup.use({ storageState })), and apps
  // redirect /login back to the app for browser sessions they consider alive,
  // so the login form would never render.
  await test.step('Buka halaman login', async () => {
    await page.goto(resolveAppUrl(roleLoginUrl));
  });

  await test.step('Bersihkan sisa sesi lama di context', async () => {
    await page.context().clearCookies();
    try {
      await page.localStorage.clear();
      await page.sessionStorage.clear();
    } catch {
      // Page never reached the app origin — nothing was seeded to clear.
    }
    await page.goto(resolveAppUrl(roleLoginUrl));
  });

  await test.step('Isi kredensial dan submit form login', async () => {
    // Satu field identity (email | username | phone) + password
    // Fail-fast timeout (10s) agar tidak menggantung lama jika selector berbeda
    const fillTimeout = { timeout: 10_000 };
    await page.fill(
      'input[type="email"], input[name="email"], input[name="username"], input[name="phone"], input[id*="email" i], input[id*="user" i], input[id*="phone" i]',
      cred.loginId,
      fillTimeout,
    );
    await page.fill(
      'input[type="password"], input[name="password"], input[id*="pass" i]',
      cred.password,
      fillTimeout,
    );
    await page.click(
      'button[type="submit"], input[type="submit"], button:has-text("Login"), button:has-text("Masuk"), button:has-text("Sign in"), button:has-text("Log in")',
      fillTimeout,
    );
  });

  // 💡 OPSIONAL / ALUR KHUSUS: Jika aplikasi memiliki langkah ekstra setelah submit
  // (misal: pilih profil/tenant, klik popup disclaimer), tambahkan test.step di sini:
  // await test.step('Pilih profil pengguna', async () => {
  //   const profileBtn = page.getByRole('button', { name: /nama-profil/i }).first();
  //   if (await profileBtn.isVisible({ timeout: 5000 }).catch(() => false)) await profileBtn.click();
  // });

  const challengeMode = resolveChallengeMode();
  const successTimeout = isInteractiveChallengeMode(challengeMode)
    ? resolveChallengeTimeoutMs()
    : 20_000;
  try {
    const detected = await handlePostLoginChallenge(page, { mode: challengeMode });
    if (detected !== 'none') {
      console.log(`ℹ [Auth] ${roleName}: post-login challenge handled (${detected})`);
    }
    await test.step('Tunggu redirect sukses dan simpan session baru', async () => {
      await page.waitForURL('**' + roleSuccessUrl + '**', { timeout: successTimeout });
      await saveSessionState(page, authFile);
    });
    console.log(`✔ [Auth] Session baru ${roleName} tersimpan di`, authFile);
    captureActualResult(`Sesi baru ${roleName} berhasil dibuat dan disimpan di ` + authFile);
  } catch (error) {
    if (isInteractiveChallengeMode(challengeMode)) {
      console.error(
        `✖ [Auth] ${roleName}: assisted login failed (AUTH_CHALLENGE_MODE=${challengeMode}).`,
        error instanceof Error ? error.message : error,
      );
    }
    throw error;
  }
}

// ─── Setup blocks per role ─────────────────────────────────────────────────────
function configuredRoles(): RoleCredentialRef[] {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );
  const roles = parseRolesFromEnvMap(env);
  return roles.length > 0 ? roles : [roleCredentialKeys('user')];
}

for (const role of configuredRoles()) {
  // Load the role's EXISTING session into this setup test's context so the
  // reuse gate (isSessionValid) can actually see it — without this, the setup
  // page is always unauthenticated and every run does a fresh login.
  const cred = resolveRoleCredentials(role.name);
  const existingSession = fs.existsSync(cred.authFile) ? cred.authFile : undefined;
  setup.describe(`role:${role.name}`, () => {
    setup.use({ storageState: existingSession });
    setup(`authenticate:${role.name}`, async ({ page }) => {
      await loginRole(role.name, page);
    });
  });
}
