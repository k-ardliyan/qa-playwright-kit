import { test, expect } from '@playwright/test';
import * as fs from 'node:fs';
import { isReachableStatus } from '@/setup/reachability';
import * as path from 'node:path';
import * as os from 'node:os';
import { isEncryptedValue, buildEnvFileContent } from '@/setup/wizard-writer';
import { isSecretEnvKey, secretKeysFromEnvText } from '@/utils/env-secrets';
import { validateSetup, isSetupReady } from '@/setup/wizard-validate';
import { parseNumberedChoice, normalizeAppPath, isValidAppPathInput } from '@/setup/wizard-prompts';
import { browsersDir, hasChromiumInstalled, buildInstallCommand } from '@/setup/browser-check';
import { buildTerminalCommand } from '@/setup/terminal';
import {
  buildAgentPrompt,
  parseRequirementPromptHints,
} from '../../../tools/scripts/qa-run-prompt';

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

test.describe('buildEnvFileContent generates a clean env file', () => {
  function withTempRepo(seedEnv?: string): (cleanup?: boolean) => void {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wizard-writer-'));
    const originalCwd = process.cwd();
    fs.writeFileSync(
      path.join(tmp, 'package.json'),
      JSON.stringify({ name: 'wizard-writer-fixture' }),
    );
    const envDir = path.join(tmp, 'config', 'environments');
    fs.mkdirSync(envDir, { recursive: true });
    if (seedEnv !== undefined) {
      fs.writeFileSync(path.join(envDir, 'dev.env'), seedEnv, 'utf-8');
    }
    process.chdir(tmp);
    return (skipRemove = false) => {
      process.chdir(originalCwd);
      if (!skipRemove) fs.rmSync(tmp, { recursive: true, force: true });
    };
  }

  test('fresh setup: sections + wizard values, no example comments or placeholders', () => {
    const cleanup = withTempRepo();
    try {
      const built = buildEnvFileContent({
        appEnv: 'dev',
        baseUrl: 'https://dev.kit.example',
        roles: [
          {
            name: 'user',
            fields: { email: 'qa@kit.example', password: 's3cret-valid' },
          },
        ],
        challengeMode: 'none',
      });

      expect(built.content).toContain('BASE_URL=https://dev.kit.example');
      expect(built.content).toContain('TEST_USER_EMAIL=qa@kit.example');
      expect(built.content).toContain('TEST_USER_PASSWORD=s3cret-valid');
      expect(built.content).toContain('HEADLESS=true');
      expect(built.content).toContain('AUTH_CHALLENGE_MODE=none');
      expect(built.content).toContain('SLOW_MO=0');
      expect(built.content).toContain('PLAYWRIGHT_CONFIG=playwright.config.ts');
      expect(built.content).toContain('# ── Role: user');
      expect(built.content).toMatch(/^# dev\.env — di-generate/m);
      expect(built.content).not.toContain('encrypted:');
      expect(built.content).not.toContain('your_password_here');
      expect(built.content).not.toMatch(/^#\s*[A-Z0-9_]+=.*$/m);
    } finally {
      cleanup();
    }
  });

  test('update flow: preserves plaintext extras, drops empty/dotenvx/ciphertext keys', () => {
    const cleanup = withTempRepo(
      [
        '#/---[DOTENV_PUBLIC_KEY]---/',
        'DOTENV_PUBLIC_KEY_DEVDEVELOPMENT="02fc"',
        '# stale template comment',
        'BASE_URL=http://old.example',
        'SOME_EXTRA_KEY=keep-me',
        'EMPTY_KEY=',
        'OLD_PASSWORD=encrypted:deadbeef',
        'TEST_USER_PASSWORD=plaintext-old',
        '',
      ].join('\n'),
    );
    try {
      const built = buildEnvFileContent({
        appEnv: 'dev',
        baseUrl: 'https://dev.kit.example',
        roles: [
          {
            name: 'user',
            fields: { username: 'qa-user', password: 's3cret-valid' },
          },
        ],
        challengeMode: 'otp-stdin',
      });

      expect(built.content).toContain('SOME_EXTRA_KEY=keep-me');
      expect(built.content).not.toContain('EMPTY_KEY');
      expect(built.content).not.toContain('encrypted:');
      expect(built.content).not.toContain('plaintext-old');
      expect(built.content).not.toContain('# stale template comment');
      expect(built.content).not.toContain('#/---');
      expect(built.content).toContain('TEST_USER_USERNAME=qa-user');
      expect(built.content).toContain('TEST_USER_PASSWORD=s3cret-valid');
      expect(built.content).toContain('HEADLESS=true');
      expect(built.keysPreserved).toBe(1);
    } finally {
      cleanup();
    }
  });
});

test.describe('secret-key classification', () => {
  test('passwords/tokens/secrets encrypt; urls/flags/identifiers do not', () => {
    expect(isSecretEnvKey('TEST_USER_PASSWORD')).toBe(true);
    expect(isSecretEnvKey('FINANCE_PASSWORD')).toBe(true);
    expect(isSecretEnvKey('API_TOKEN')).toBe(true);
    expect(isSecretEnvKey('WEBHOOK_SECRET')).toBe(true);
    expect(isSecretEnvKey('PASSWORD')).toBe(true);
    expect(isSecretEnvKey('TEST_USER_EMAIL')).toBe(false);
    expect(isSecretEnvKey('TEST_USER_USERNAME')).toBe(false);
    expect(isSecretEnvKey('TEST_USER_PHONE')).toBe(false);
    expect(isSecretEnvKey('BASE_URL')).toBe(false);
    expect(isSecretEnvKey('HEADLESS')).toBe(false);
    expect(isSecretEnvKey('AUTH_CHALLENGE_MODE')).toBe(false);
    expect(isSecretEnvKey('DOTENV_PUBLIC_KEY')).toBe(false);
  });

  test('secretKeysFromEnvText lists only secret keys present', () => {
    const text = [
      'BASE_URL=https://x',
      'TEST_USER_EMAIL=a@b.com',
      'TEST_USER_PASSWORD=p',
      'FINANCE_PASSWORD=q',
      'HEADLESS=true',
    ].join('\n');
    expect(secretKeysFromEnvText(text)).toEqual(['TEST_USER_PASSWORD', 'FINANCE_PASSWORD']);
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

test.describe('normalizeAppPath (pasted URL / path handling)', () => {
  test('adds leading slash, collapses duplicates, and strips trailing slash', () => {
    expect(normalizeAppPath('dashboard', '/dashboard')).toBe('/dashboard');
    expect(normalizeAppPath('/dashboard/', '/dashboard')).toBe('/dashboard');
    expect(normalizeAppPath('//nested//path//', '/dashboard')).toBe('/nested/path');
  });

  test('extracts pathname from pasted full URLs', () => {
    expect(normalizeAppPath('https://erp.example.com/app/overview', '/dashboard')).toBe(
      '/app/overview',
    );
    expect(normalizeAppPath('http://localhost:3000/login', '/login')).toBe('/login');
    expect(normalizeAppPath('http://localhost:3000/', '/dashboard')).toBe('/dashboard');
  });

  test('strips query and hash fragments', () => {
    expect(normalizeAppPath('/login?redirect=%2Fdashboard', '/login')).toBe('/login');
    expect(normalizeAppPath('/app/home#tab=orders', '/dashboard')).toBe('/app/home');
  });

  test('empty string falls back to default', () => {
    expect(normalizeAppPath('', '/dashboard')).toBe('/dashboard');
    expect(normalizeAppPath('   ', '/login')).toBe('/login');
  });

  test('isValidAppPathInput rejects spaces in raw paths', () => {
    expect(isValidAppPathInput('')).toBe(true);
    expect(isValidAppPathInput('/login')).toBe(true);
    expect(isValidAppPathInput('https://x.com/login')).toBe(true);
    expect(isValidAppPathInput('/bad path')).toBe(false);
  });
});

test.describe('buildTerminalCommand', () => {
  test('builds OS-aware command for background auth:setup or browser install', () => {
    const win = buildTerminalCommand('C:/repo', 'npm run auth:setup', 'win32');
    expect(win.command).toBe('cmd.exe');
    expect(win.args[1]).toContain('npm run auth:setup');

    const mac = buildTerminalCommand('/Users/x/repo', 'npm run auth:setup', 'darwin');
    expect(mac.command).toBe('osascript');
    expect(mac.args.join(' ')).toContain('npm run auth:setup');

    const lin = buildTerminalCommand('/home/x/repo', 'npm run auth:setup', 'linux');
    expect(lin.command).toBe('gnome-terminal');
    expect(lin.args.join(' ')).toContain('npm run auth:setup');
  });
});

test.describe('buildEnvFileContent with custom multi-roles', () => {
  function withIsolatedRepo(): (cleanup?: boolean) => void {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wizard-multi-role-'));
    const originalCwd = process.cwd();
    fs.writeFileSync(
      path.join(tmp, 'package.json'),
      JSON.stringify({ name: 'wizard-multi-fixture' }),
    );
    const envDir = path.join(tmp, 'config', 'environments');
    fs.mkdirSync(envDir, { recursive: true });
    process.chdir(tmp);
    return () => {
      process.chdir(originalCwd);
      fs.rmSync(tmp, { recursive: true, force: true });
    };
  }

  test('generates env for admin, guru, murid with per-role login/redirect paths', () => {
    const cleanup = withIsolatedRepo();
    try {
      const built = buildEnvFileContent({
        appEnv: 'dev',
        baseUrl: 'http://localhost:3000',
        roles: [
          {
            name: 'admin',
            fields: {
              username: 'admin1',
              password: 'secret-admin',
              loginUrlPath: '/admin/login',
              successUrlPath: '/admin/dashboard',
            },
          },
          {
            name: 'guru',
            fields: {
              username: 'guru1',
              password: 'secret-guru',
              loginUrlPath: '/portal/guru',
              successUrlPath: '/guru/kelas',
            },
          },
          {
            name: 'murid',
            fields: {
              username: 'murid1',
              password: 'secret-murid',
              loginUrlPath: '/login',
              successUrlPath: '/student/home',
            },
          },
        ],
        challengeMode: 'none',
      });

      expect(built.content).toContain('ADMIN_USERNAME=admin1');
      expect(built.content).toContain('ADMIN_PASSWORD=secret-admin');
      expect(built.content).toContain('ADMIN_LOGIN_URL_PATH=/admin/login');
      expect(built.content).toContain('ADMIN_SUCCESS_URL_PATH=/admin/dashboard');

      expect(built.content).toContain('GURU_USERNAME=guru1');
      expect(built.content).toContain('GURU_PASSWORD=secret-guru');
      expect(built.content).toContain('GURU_LOGIN_URL_PATH=/portal/guru');
      expect(built.content).toContain('GURU_SUCCESS_URL_PATH=/guru/kelas');

      expect(built.content).toContain('MURID_USERNAME=murid1');
      expect(built.content).toContain('MURID_PASSWORD=secret-murid');
      expect(built.content).toContain('MURID_LOGIN_URL_PATH=/login');
      expect(built.content).toContain('MURID_SUCCESS_URL_PATH=/student/home');

      // Must not contain TEST_USER keys when user is not in roles
      expect(built.content).not.toContain('TEST_USER_');
    } finally {
      cleanup();
    }
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

test.describe('Hermes prompt builder (mode-aware)', () => {
  const loginMarkdown = (challengeMode: string): string =>
    [
      '# REQ-AUTH-001: Login — Demo App',
      '- **Auth state:** unauthenticated',
      '- **Halaman awal:** /login',
      `AUTH_CHALLENGE_MODE=${challengeMode} — catatan pipeline`,
      '',
    ].join('\n');

  test('prompt always starts the pipeline with health_check', () => {
    const prompt = buildAgentPrompt('requirements/login.md', loginMarkdown('none'), 'id');
    expect(prompt).toContain('health_check');
    expect(prompt).toContain('test.step');
  });

  test('login requirement with challenge mode gets auth:setup reminder', () => {
    const prompt = buildAgentPrompt('requirements/login.md', loginMarkdown('otp-browser'), 'id');
    expect(prompt).toContain('auth:setup');
    expect(prompt).toContain('(@manual)');
  });

  test('challenge none does not add the auth:setup reminder', () => {
    const prompt = buildAgentPrompt('requirements/login.md', loginMarkdown('none'), 'id');
    expect(prompt).not.toContain('auth:setup');
  });

  test('parse hints extract the challenge mode', () => {
    expect(parseRequirementPromptHints(loginMarkdown('otp-stdin')).challengeMode).toBe('otp-stdin');
    expect(parseRequirementPromptHints('no markers here').challengeMode).toBeNull();
  });

  test('english prompt uses english strings', () => {
    const prompt = buildAgentPrompt('requirements/login.md', loginMarkdown('none'), 'en');
    expect(prompt).toContain('Run the pipeline in automatic mode');
    expect(prompt).not.toContain('Jalankan pipeline');
  });
});
