/// <reference types="node" />
/**
 * wizard-auth-template — Generate src/support/auth.setup.ts untuk custom project
 *
 * Uses uniform role credentials + resolveLoginIdentifier order:
 * LOGIN_ID_PREF → email → username → phone
 *
 * Includes human-challenge hooks (OTP browser-first, CAPTCHA browser-only).
 *
 * @module scripts/wizard-auth-template
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { canonicalRoleName } from '../../src/shared/utils/role-credentials';

export interface AuthRole {
  /** Nama role, lowercase-hyphen. Misal: 'admin', 'super-admin', 'user' */
  name: string;
  /** Path file auth state. Misal: '.auth/local/user.json' */
  authFile: string;
  /** Path URL halaman login khusus role ini (opsional). Misal: '/admin/login' */
  loginUrl?: string;
  /** Path URL setelah login berhasil khusus role ini (opsional). Misal: '/admin/dashboard' */
  successUrlPath?: string;
}

export interface AuthTemplateOptions {
  roles: AuthRole[];
  /** Default path URL halaman login. Misal: '/login' */
  loginUrl: string;
  /** Default path URL setelah login berhasil. Misal: '/dashboard' */
  successUrlPath: string;
}

/**
 * Generate isi file auth.setup.ts generik untuk satu atau banyak role.
 * Identity field uses resolve order (pref / email / username / phone).
 */
export function generateAuthSetupContent(opts: AuthTemplateOptions): string {
  const { roles, loginUrl, successUrlPath } = opts;

  const roleBlocks = roles
    .map((role) => {
      const name = canonicalRoleName(role.name);
      const authFile = role.authFile.includes('{')
        ? role.authFile
        : role.authFile.replace(/^\.auth\/(?!.*\/)/, '.auth/'); // leave as provided
      const roleLogin = role.loginUrl || loginUrl;
      const roleSuccess = role.successUrlPath || successUrlPath;

      return `
setup('authenticate:${name}', async ({ page }) => {
  const cred = resolveRoleCredentials('${name}');
  const authFile = '${authFile.replace(/\\/g, '/')}';
  const roleLoginUrl = cred.loginUrl || '${roleLogin}';
  const roleSuccessUrl = cred.successUrl || '${roleSuccess}';

  setTestMetadata({
    testId: 'TC-AUTH-SETUP-${name.toUpperCase().replace(/-/g, '_')}',
    priority: 'HIGH',
    role: '${name}',
    module: 'auth',
    feature: 'session-bootstrap',
    affectedLayer: ['FE', 'BE'],
    inputData: {
      identifier: \`credential:\${'${name}'}.\${cred.idKind}\`,
      password: \`credential:\${'${name}'}.password\`,
    },
    expectedResult: 'Sesi login aktif tersimpan di ' + authFile,
  });

  if (!cred.loginId || !cred.password) {
    fs.writeFileSync(authFile, JSON.stringify({ cookies: [], origins: [] }, null, 2));
    console.log(
      'ℹ [Auth] ${name}: missing login id or password — wrote empty storage. Set env keys.',
    );
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
      console.log('✔ [Auth] Session ${name} masih valid, reuse session.');
      captureActualResult('Session ${name} masih valid (reused), tersimpan di ' + authFile);
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
      console.log('ℹ [Auth] ${name}: post-login challenge handled (' + detected + ')');
    }
    await test.step('Tunggu redirect sukses dan simpan session baru', async () => {
      await page.waitForURL('**' + roleSuccessUrl + '**', { timeout: successTimeout });
      await saveSessionState(page, authFile);
    });
    console.log('✔ [Auth] Session baru ${name} tersimpan di', authFile);
    captureActualResult(\`Sesi baru \${'${name}'} berhasil dibuat dan disimpan di \` + authFile);
  } catch (error) {
    if (isInteractiveChallengeMode(challengeMode)) {
      console.error(
        \`✖ [Auth] \${'${name}'}: assisted login failed (AUTH_CHALLENGE_MODE=\${challengeMode}).\`,
        error instanceof Error ? error.message : error,
      );
    }
    throw error;
  }
});`;
    })
    .join('\n');

  return `import { test as setup, test } from '@playwright/test';
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
${roleBlocks}
`;
}

export interface WriteAuthSetupResult {
  outPath: string;
  skipped: boolean;
}

/**
 * Tulis file auth.setup.ts ke disk.
 * Jika file sudah ada dan ditandai // CUSTOM_AUTH_FLOW (diedit kustom oleh QA),
 * file TIDAK AKAN ditimpa (non-destructive) kecuali opts.force=true.
 */
export function writeAuthSetup(
  opts: AuthTemplateOptions & { force?: boolean },
  outPath: string,
): WriteAuthSetupResult {
  const dir = path.dirname(outPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  if (fs.existsSync(outPath)) {
    const existing = fs.readFileSync(outPath, 'utf-8');
    if (
      !opts.force &&
      (existing.includes('// CUSTOM_AUTH_FLOW') || existing.includes('// KUSTOM_LOGIN_FLOW'))
    ) {
      return { outPath, skipped: true };
    }
    const bak = outPath + '.bak';
    try {
      fs.copyFileSync(outPath, bak);
    } catch {
      // non-fatal — still write new content
    }
  }

  // Normalize role names before generate
  const roles = opts.roles.map((r) => ({
    name: canonicalRoleName(r.name),
    authFile: r.authFile,
    loginUrl: r.loginUrl,
    successUrlPath: r.successUrlPath,
  }));

  fs.writeFileSync(outPath, generateAuthSetupContent({ ...opts, roles }), 'utf-8');
  return { outPath, skipped: false };
}
