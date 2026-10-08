/**
 * Unit tests for src/utils/env-clean.ts — clean env file generator.
 * Run: npx playwright test src/utils/__tests__/env-clean.test.ts -c config/playwright/unit.ts
 */
import { test, expect } from '@playwright/test';
import { buildCleanEnvContent, ENV_FILE_DEFAULTS } from '../env-clean';

test.describe('buildCleanEnvContent', () => {
  test('groups sections in canonical order, roles grouped per prefix', () => {
    const content = buildCleanEnvContent({
      appEnv: 'dev',
      values: {
        PLAYWRIGHT_CONFIG: 'playwright.config.ts',
        FINANCE_PASSWORD: 'secret',
        AUTH_CHALLENGE_MODE: 'none',
        TEST_USER_EMAIL: 'a@b.com',
        TEST_USER_PASSWORD: 'pw',
        BASE_URL: 'http://x',
        HEADLESS: 'true',
        SLOW_MO: '0',
        TEST_USER_LOGIN_ID_PREF: 'email',
        CUSTOM_FLAG: '1',
        FINANCE_EMAIL: 'f@b.com',
      },
    });

    const markers = [
      '# ── URL Aplikasi',
      'BASE_URL=http://x',
      '# ── Role: user',
      'TEST_USER_EMAIL=a@b.com',
      'TEST_USER_PASSWORD=pw',
      'TEST_USER_LOGIN_ID_PREF=email',
      '# ── Role: finance',
      'FINANCE_EMAIL=f@b.com',
      'FINANCE_PASSWORD=secret',
      '# ── Browser',
      '# ── Challenge login (OTP/CAPTCHA)',
      '# ── Playwright',
      '# ── Lainnya (dipertahankan)',
      'CUSTOM_FLAG=1',
    ];
    let last = -1;
    for (const marker of markers) {
      const idx = content.indexOf(marker);
      expect(idx, `"${marker}" missing or out of order in:\n${content}`).toBeGreaterThan(last);
      last = idx;
    }
  });

  test('drops empty values and DOTENV_* except public key metadata', () => {
    const content = buildCleanEnvContent({
      appEnv: 'dev',
      values: {
        BASE_URL: 'http://x',
        TEST_USER_PHONE: '',
        DOTENV_PUBLIC_KEY_DEVDEVELOPMENT: '02fc',
        DOTENV_PRIVATE_KEY_DEVDEVELOPMENT: 'must-not-leak',
        DOTENV_CONFIG_QUIET: 'true',
      },
    });

    expect(content).toContain('DOTENV_PUBLIC_KEY_DEVDEVELOPMENT=02fc');
    expect(content).not.toContain('TEST_USER_PHONE');
    expect(content).not.toContain('must-not-leak');
    expect(content).not.toContain('DOTENV_CONFIG_QUIET');
  });

  test('provenance header names the file and edit command', () => {
    const content = buildCleanEnvContent({ appEnv: 'staging', values: { BASE_URL: 'http://x' } });
    expect(content).toMatch(/^# staging\.env — di-generate oleh `npm run setup`\./m);
    expect(content).toContain('# Dokumentasi lengkap key: config/environments/staging.env.example');
  });

  test('single-quotes values containing $ so dotenv does not expand them', () => {
    const content = buildCleanEnvContent({
      appEnv: 'dev',
      values: { BASE_URL: 'http://x', API_PASSWORD: 'pa$$word' },
    });
    expect(content).toContain(`API_PASSWORD='pa$$word'`);
  });

  test('keeps every unknown key (nothing silently lost)', () => {
    const values = { BASE_URL: 'http://x', WEIRD_KEY_ONE: 'a', WEIRD_KEY_TWO: 'b' };
    const content = buildCleanEnvContent({ appEnv: 'dev', values });
    expect(content).toContain('WEIRD_KEY_ONE=a');
    expect(content).toContain('WEIRD_KEY_TWO=b');
  });

  test('defaults cover the non-wizard keys documented in .env.example', () => {
    expect(Object.keys(ENV_FILE_DEFAULTS).sort()).toEqual(['PLAYWRIGHT_CONFIG', 'SLOW_MO']);
  });

  test('sections the documented URL/Browser keys (incl. QA_VIEWPORT, global auth)', () => {
    const content = buildCleanEnvContent({
      appEnv: 'dev',
      values: {
        BASE_URL: 'http://x',
        AUTH_LOGIN_URL_PATH: '/login',
        AUTH_SUCCESS_URL_PATH: '/dashboard',
        APP_BASE_URL: 'https://app.example.com',
        API_BASE_URL: 'https://api.example.com',
        QA_VIEWPORT: '1920x1080',
        HEADLESS: 'true',
      },
    });

    const urlIdx = content.indexOf('# ── URL Aplikasi');
    const browserIdx = content.indexOf('# ── Browser');
    expect(urlIdx).toBeGreaterThanOrEqual(0);
    expect(browserIdx).toBeGreaterThan(urlIdx);
    // Documented advanced keys must be sectioned, never dumped into "Lainnya".
    const lainnyaIdx = content.indexOf('# ── Lainnya (dipertahankan)');
    for (const line of [
      'AUTH_LOGIN_URL_PATH=/login',
      'APP_BASE_URL=https://app.example.com',
      'API_BASE_URL=https://api.example.com',
      'QA_VIEWPORT=1920x1080',
    ]) {
      const at = content.indexOf(line);
      expect(at).toBeGreaterThanOrEqual(0);
      if (lainnyaIdx >= 0) expect(at).toBeLessThan(lainnyaIdx);
    }
  });
});
