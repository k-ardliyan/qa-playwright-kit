import { test as setup, test } from '@playwright/test';
import * as fs from 'node:fs';
import { setTestMetadata, captureActualResult } from './test-metadata';
import { isSessionValid, saveSessionState, resolveRoleCredentials } from './auth-helpers';
import {
  handlePostLoginChallenge,
  resolveChallengeMode,
  isInteractiveChallengeMode,
  resolveChallengeTimeoutMs,
} from './human-challenge';

/**
 * Auth Setup — modular, customizable login runner.
 *
 * Runs once during setup project to materialize .auth/{APP_ENV}/<role>.json.
 * If your app requires extra login steps (profile picker, tenant selector, 2-step login),
 * you can customize the steps inside without fear of being overwritten.
 *
 * Run: npm run auth:setup  |  npm run auth:setup:headed
 */

setup('authenticate:user', async ({ page }) => {
  const cred = resolveRoleCredentials('user');
  const authFile = '.auth/dev/user.json';
  const roleLoginUrl = cred.loginUrl || '/login';
  const roleSuccessUrl = cred.successUrl || '/dashboard';

  setTestMetadata({
    testId: 'TC-AUTH-SETUP-USER',
    priority: 'HIGH',
    role: 'user',
    module: 'auth',
    feature: 'session-bootstrap',
    affectedLayer: ['FE', 'BE'],
    inputData: {
      identifier: `credential:${'user'}.${cred.idKind}`,
      password: `credential:${'user'}.password`,
    },
    expectedResult: 'Sesi login aktif tersimpan di ' + authFile,
  });

  if (!cred.loginId || !cred.password) {
    fs.writeFileSync(authFile, JSON.stringify({ cookies: [], origins: [] }, null, 2));
    console.log('ℹ [Auth] user: missing login id or password — wrote empty storage. Set env keys.');
    return;
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
      console.log('✔ [Auth] Session user masih valid, reuse session.');
      captureActualResult('Session user masih valid (reused), tersimpan di ' + authFile);
      return;
    }
  }

  // 2. Fresh Login Flow
  await test.step('Buka halaman login', async () => {
    await page.goto(process.env.BASE_URL! + roleLoginUrl);
  });

  await test.step('Isi kredensial dan submit form login', async () => {
    // Satu field identity (email | username | phone) + password
    await page.fill(
      'input[type="email"], input[name="email"], input[name="username"], input[name="phone"], input[id*="email" i], input[id*="user" i], input[id*="phone" i]',
      cred.loginId,
    );
    await page.fill(
      'input[type="password"], input[name="password"], input[id*="pass" i]',
      cred.password,
    );
    await page.click(
      'button[type="submit"], input[type="submit"], button:has-text("Login"), button:has-text("Masuk"), button:has-text("Sign in"), button:has-text("Log in")',
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
      console.log('ℹ [Auth] user: post-login challenge handled (' + detected + ')');
    }
    await test.step('Tunggu redirect sukses dan simpan session baru', async () => {
      await page.waitForURL('**' + roleSuccessUrl + '**', { timeout: successTimeout });
      await saveSessionState(page, authFile);
    });
    console.log('✔ [Auth] Session baru user tersimpan di', authFile);
    captureActualResult(`Sesi baru ${'user'} berhasil dibuat dan disimpan di ` + authFile);
  } catch (error) {
    if (isInteractiveChallengeMode(challengeMode)) {
      console.error(
        `✖ [Auth] ${'user'}: assisted login failed (AUTH_CHALLENGE_MODE=${challengeMode}).`,
        error instanceof Error ? error.message : error,
      );
    }
    throw error;
  }
});
