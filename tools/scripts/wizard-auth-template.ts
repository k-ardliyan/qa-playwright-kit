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
import { canonicalRoleName, roleToEnvPrefix } from '../../src/shared/utils/role-credentials';

export interface AuthRole {
  /** Nama role, lowercase-hyphen. Misal: 'admin', 'super-admin', 'user' */
  name: string;
  /** Path file auth state. Misal: '.auth/local/user.json' */
  authFile: string;
}

export interface AuthTemplateOptions {
  roles: AuthRole[];
  /** Path URL halaman login. Misal: '/login' */
  loginUrl: string;
  /** Path URL setelah login berhasil. Misal: '/dashboard' */
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
      const envPrefix = roleToEnvPrefix(name);
      const authFile = role.authFile.includes('{')
        ? role.authFile
        : role.authFile.replace(/^\.auth\/(?!.*\/)/, '.auth/'); // leave as provided

      return `
setup('authenticate:${name}', async ({ page }) => {
  const authFile = '${authFile.replace(/\\/g, '/')}';
  const dir = path.dirname(authFile);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const pref = (process.env.${envPrefix}_LOGIN_ID_PREF ?? '').trim().toLowerCase();
  const email = (process.env.${envPrefix}_EMAIL ?? '').trim();
  const username = (process.env.${envPrefix}_USERNAME ?? '').trim();
  const phone = (process.env.${envPrefix}_PHONE ?? '').trim();
  const password = (process.env.${envPrefix}_PASSWORD ?? '').trim();

  const loginId =
    (pref === 'email' && email) ||
    (pref === 'username' && username) ||
    (pref === 'phone' && phone) ||
    email ||
    username ||
    phone;

  const idKind =
    pref === 'email' || pref === 'username' || pref === 'phone'
      ? pref
      : email
        ? 'email'
        : username
          ? 'username'
          : phone
            ? 'phone'
            : 'email';

  setTestMetadata({
    testId: 'TC-AUTH-SETUP-${name.toUpperCase().replace(/-/g, '_')}',
    priority: 'HIGH',
    role: '${name}',
    module: 'auth',
    feature: 'session-bootstrap',
    affectedLayer: ['FE', 'BE'],
    inputData: {
      identifier: \`credential:\${'${name}'}.\${idKind}\`,
      password: \`credential:\${'${name}'}.password\`,
      loginUrl: '${loginUrl}',
      successUrl: '${successUrlPath}',
    },
    expectedResult: 'Sesi login aktif tersimpan di ' + authFile,
  });

  if (!loginId || !password) {
    fs.writeFileSync(authFile, JSON.stringify({ cookies: [], origins: [] }, null, 2));
    console.log(
      'ℹ [Auth] ${name}: missing login id or password — wrote empty storage. Set env keys (${envPrefix}_*).',
    );
    return;
  }

  const forceLogin = process.env.AUTH_FORCE_LOGIN === 'true';

  // 1. Cek apakah session yang ada masih valid (skip jika AUTH_FORCE_LOGIN=true)
  if (!forceLogin && fs.existsSync(authFile)) {
    try {
      await test.step('Verifikasi session tersimpan masih valid', async () => {
        await page.goto(process.env.BASE_URL! + '${successUrlPath}');
      });
      if (!page.url().includes('${loginUrl}')) {
        console.log('✔ [Auth] Session ${name} masih valid, reuse session.');
        await page.context().storageState({ path: authFile });
        captureActualResult('Session ${name} masih valid (reused), tersimpan di ' + authFile);
        return;
      }
      console.log('ℹ [Auth] Session ${name} kedaluwarsa, melakukan login fresh...');
    } catch {
      console.log('⚠ [Auth] Gagal verifikasi session ${name}, melakukan login fresh...');
    }
  }

  // 2. Fresh Login Flow
  await test.step('Buka halaman login', async () => {
    await page.goto(process.env.BASE_URL! + '${loginUrl}');
  });

  await test.step('Isi kredensial dan submit form login', async () => {
    // Satu field identity (email | username | phone) + password
    await page.fill(
      'input[type="email"], input[name="email"], input[name="username"], input[name="phone"], input[id*="email" i], input[id*="user" i], input[id*="phone" i]',
      loginId,
    );
    await page.fill(
      'input[type="password"], input[name="password"], input[id*="pass" i]',
      password,
    );
    await page.click(
      'button[type="submit"], input[type="submit"], button:has-text("Login"), button:has-text("Masuk"), button:has-text("Sign in"), button:has-text("Log in")',
    );
  });

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
      await page.waitForURL('**${successUrlPath}**', { timeout: successTimeout });
      await page.context().storageState({ path: authFile });
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
import * as path from 'node:path';
import { setTestMetadata, captureActualResult } from './test-metadata';
import {
  handlePostLoginChallenge,
  resolveChallengeMode,
  isInteractiveChallengeMode,
  resolveChallengeTimeoutMs,
} from './human-challenge';

/**
 * Auth Setup — generated by setup / env:edit
 *
 * Role "user" = default account for pipeline mode **general** (not an env role named general).
 * Login id resolve: LOGIN_ID_PREF → EMAIL → USERNAME → PHONE
 *
 * Human challenge (OTP/CAPTCHA): AUTH_CHALLENGE_MODE
 *   - otp-browser (disarankan) | otp-stdin | captcha-browser | auto | none
 *
 * File ini di-generate otomatis. Aman untuk diedit manual.
 * Jika selector form login tidak cocok, minta bantuan Hermes:
 *   "Tolong perbaiki src/support/auth.setup.ts untuk login page di {BASE_URL}${loginUrl}"
 *
 * Jalankan: npm run auth:setup  |  npm run auth:setup:headed
 */
${roleBlocks}
`;
}

/**
 * Tulis file auth.setup.ts ke disk, buat direktori jika belum ada.
 * Jika file sudah ada, backup ke `<outPath>.bak` sekali sebelum overwrite.
 */
export function writeAuthSetup(opts: AuthTemplateOptions, outPath: string): void {
  const dir = path.dirname(outPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  if (fs.existsSync(outPath)) {
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
  }));
  fs.writeFileSync(outPath, generateAuthSetupContent({ ...opts, roles }), 'utf-8');
}
