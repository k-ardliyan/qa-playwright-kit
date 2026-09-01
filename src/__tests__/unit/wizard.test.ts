import { test, expect } from '@playwright/test';
import * as fs from 'node:fs';
import { isReachableStatus } from '@/setup/reachability';
import { isEncryptedValue } from '@/setup/wizard-writer';
import { validateSetup, isSetupReady } from '@/setup/wizard-validate';
import { parseNumberedChoice } from '@/setup/wizard-prompts';
import { browsersDir, hasChromiumInstalled, buildInstallCommand } from '@/setup/browser-check';

test.describe('wizard reachability predicate', () => {
  test('alive statuses (2xx, 302, 304, 401)', () => {
    for (const s of [200, 204, 302, 304, 401]) {
      expect(isReachableStatus(s), `status ${s} should be reachable`).toBe(true);
    }
  });

  test('dead statuses (403, 404, 5xx)', () => {
    for (const s of [403, 404, 500, 503]) {
      expect(isReachableStatus(s), `status ${s} should NOT be reachable`).toBe(false);
    }
  });
});

test.describe('isEncryptedValue', () => {
  test('recognizes dotenvx ciphertext', () => {
    expect(isEncryptedValue('encrypted:BOxxfXVEreL37ryekuHHys1lE==')).toBe(true);
    expect(isEncryptedValue('encrypted:abc')).toBe(true);
    expect(isEncryptedValue('  encrypted:abc  ')).toBe(true);
  });

  test('rejects plaintext', () => {
    expect(isEncryptedValue('http://localhost:3000')).toBe(false);
    expect(isEncryptedValue('secret123')).toBe(false);
    expect(isEncryptedValue('')).toBe(false);
    expect(isEncryptedValue(null)).toBe(false);
    expect(isEncryptedValue(undefined)).toBe(false);
  });
});

test.describe('parseNumberedChoice (type-then-Enter numbered picker)', () => {
  test('accepts valid 1..N, trimming & leading zeros', () => {
    expect(parseNumberedChoice('1', 4)).toBe(1);
    expect(parseNumberedChoice('4', 4)).toBe(4);
    expect(parseNumberedChoice(' 2 ', 4)).toBe(2);
    expect(parseNumberedChoice('05', 5)).toBe(5);
    expect(parseNumberedChoice('2.0', 4)).toBe(2); // 2.0 isInteger true
  });

  test('rejects out-of-range, empty, decimals, non-numeric', () => {
    expect(parseNumberedChoice('', 4)).toBe('Masukkan angka 1-4');
    expect(parseNumberedChoice('0', 4)).toBe('Masukkan angka 1-4');
    expect(parseNumberedChoice('5', 4)).toBe('Masukkan angka 1-4');
    expect(parseNumberedChoice('2.5', 4)).toBe('Masukkan angka 1-4');
    expect(parseNumberedChoice('abc', 4)).toBe('Masukkan angka 1-4');
    expect(parseNumberedChoice('1/2', 4)).toBe('Masukkan angka 1-4');
  });

  test('scales message to len (N reflected)', () => {
    expect(parseNumberedChoice('', 5)).toBe('Masukkan angka 1-5');
    expect(parseNumberedChoice('9', 5)).toBe('Masukkan angka 1-5');
  });

  test('english messages when lang=en', () => {
    expect(parseNumberedChoice('', 4, 'en')).toBe('Enter a number 1-4');
    expect(parseNumberedChoice('9', 4, 'en')).toBe('Enter a number 1-4');
    expect(parseNumberedChoice('2', 4, 'en')).toBe(2);
  });
});

test.describe('validateSetup with encrypted values', () => {
  test('encrypted BASE_URL → warning, not fake reachable', async () => {
    const env = {
      BASE_URL: 'encrypted:abc',
      TEST_USER_EMAIL: 'a@b.com',
      TEST_USER_PASSWORD: 'encrypted:p',
    };
    const v = await validateSetup('dev', env as Record<string, string>, '/tmp/dev.env');
    expect(v.warnings.join(' ')).toContain('BASE_URL terenkripsi');
    expect(v.reachable).toBe(false);
    expect(v.rolesEncrypted).toContain('user');
    expect(v.rolesReady).not.toContain('user');
  });

  test('mixed map: encrypted user, plaintext admin who is ready', async () => {
    const env = {
      BASE_URL: 'http://localhost:3000',
      TEST_USER_PASSWORD: 'encrypted:x',
      ADMIN_EMAIL: 'admin@ex.com',
      ADMIN_PASSWORD: 'realpass',
    };
    const v = await validateSetup('dev', env as Record<string, string>, '/tmp/dev.env');
    expect(v.rolesEncrypted).toContain('user');
    expect(v.rolesReady).toContain('admin');
  });

  test('encrypted EMAIL is still rolesEncrypted (not rolesReady)', async () => {
    const env = {
      BASE_URL: 'http://a.com',
      FINANCE_EMAIL: 'encrypted:abc',
      FINANCE_PASSWORD: 'pass',
    };
    const v = await validateSetup('dev', env as Record<string, string>, '/tmp/dev.env');
    expect(v.rolesEncrypted).toContain('finance');
    expect(v.rolesReady).not.toContain('finance');
  });

  test('english messages when lang=en', async () => {
    const v = await validateSetup(
      'dev',
      { BASE_URL: 'encrypted:abc' } as Record<string, string>,
      '/tmp/dev.env',
      'en',
    );
    expect(v.warnings.join(' ')).toContain('BASE_URL is encrypted');
    expect(v.warnings.join(' ')).not.toContain('terenkripsi');
  });

  test('isSetupReady returns false for encrypted BASE_URL or any credential', () => {
    expect(
      isSetupReady({ BASE_URL: 'encrypted:abc', TEST_USER_PASSWORD: 'p' } as Record<
        string,
        string
      >),
    ).toBe(false);
    expect(
      isSetupReady({ BASE_URL: 'http://a.com', TEST_USER_PASSWORD: 'encrypted:p' } as Record<
        string,
        string
      >),
    ).toBe(false);
    expect(
      isSetupReady({
        BASE_URL: 'http://a.com',
        TEST_USER_EMAIL: 'encrypted:abc',
        TEST_USER_PASSWORD: 'p',
      } as Record<string, string>),
    ).toBe(false);
    expect(
      isSetupReady({
        BASE_URL: 'http://a.com',
        TEST_USER_EMAIL: 'a@b.com',
        TEST_USER_PASSWORD: 'real',
      } as Record<string, string>),
    ).toBe(true);
  });
});

test.describe('browser availability check', () => {
  test('browsersDir honors PLAYWRIGHT_BROWSERS_PATH override', () => {
    process.env.PLAYWRIGHT_BROWSERS_PATH = '/custom/browsers';
    expect(browsersDir()).toBe('/custom/browsers');
    delete process.env.PLAYWRIGHT_BROWSERS_PATH;
  });

  test('hasChromiumInstalled false on missing dir and true with chromium-* entry', () => {
    expect(hasChromiumInstalled('/definitely/not/a/real/path')).toBe(false);
    const tmp = `${process.env.LOCALAPPDATA}/hermes-browsers-test`;
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.mkdirSync(`${tmp}/chromium-1234`, { recursive: true });
    fs.writeFileSync(`${tmp}/chromium-1234/placeholder`, 'x');
    expect(hasChromiumInstalled(tmp)).toBe(true);
    expect(hasChromiumInstalled(`${tmp}/firefox-1`)).toBe(false);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  test('buildInstallCommand is OS-aware', () => {
    const w = buildInstallCommand('C:/repo dir', 'win32');
    expect(w.command).toBe('cmd.exe');
    expect(w.args[0]).toBe('/c');
    expect(w.args[1]).toContain('npx playwright install chromium');

    const m = buildInstallCommand('/Users/x/repo', 'darwin');
    expect(m.command).toBe('osascript');
    expect(m.args.join(' ')).toContain('npx playwright install chromium');

    const l = buildInstallCommand('/home/x/repo', 'linux');
    expect(l.command).toBe('gnome-terminal');
    expect(l.args.join(' ')).toContain('npx playwright install chromium');
  });
});
