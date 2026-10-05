/// <reference types="node" />
/**
 * env-edit — Credential & runtime config manager for QA Playwright Kit
 *
 * Usage:
 *   npm run env:edit
 *   npm run env:edit:list
 *   npm run env:use:local   # then env:edit uses the pinned env
 *
 * Decrypts config/environments/{APP_ENV}.env via dotenvx private keys,
 * lets QA list/edit/add/remove role credentials, then re-encrypts secret
 * keys only (`*_PASSWORD` / `*_SECRET` / `*_TOKEN`). Same helper as setup.
 *
 * @module scripts/env-edit
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  abortIfCancelled,
  confirm as clackConfirm,
  isInteractive,
  password as clackPassword,
  select as clackSelect,
  text as clackText,
} from '../../src/setup/prompts/clack';
import { printOk, printWarn, printError, printInfo } from './format-error';
import { EXIT } from './exit-codes';
import { writeAuthSetup } from './wizard-auth-template';
import {
  isValidRoleName,
  roleCredentialKeys,
  parseRolesFromEnvMap,
  maskSecret,
  upsertEnvContent,
  removeEnvKeys,
  parseEnvText,
  resolveLoginIdentifier,
  canonicalRoleName,
  isRoleLoginReady,
  hasDefaultUserCredentials,
} from './env-edit-lib';
import { getGlobalKeysPath, migrateWorkspaceEnvKeys } from '../../src/utils/dotenv-keys';
import { resolveAppEnv, getEnvironmentsDir } from '../../src/utils/app-env';
import { normalizeAppPath } from '../../src/setup/wizard-prompts';
import { buildCleanEnvContent } from '../../src/utils/env-clean';
import {
  decryptEnvFileToText,
  encryptSecretKeysInFile,
  EnvEncryptError,
} from '../../src/utils/env-secrets';

const ROOT = process.cwd();
const ENV_DIR = getEnvironmentsDir(ROOT);
const AUTH_SETUP_OUT = path.join(ROOT, 'src', 'support', 'auth.setup.ts');

// ─── clack adapters ──────────────────────────────────────────────────────────
// The old array-form `prompts([...])` is expressed as sequential clack calls;
// these two helpers keep the call sites as short as the array form was while
// funnelling every cancellation through the shared abort token.

const t = (message: string, defaultValue?: string) =>
  clackText({ message, defaultValue, placeholder: defaultValue });

const pw = (message: string) => clackPassword({ message });

const sel = <T extends string>(
  message: string,
  options: Array<{ value: T; label: string }>,
  initialValue?: T,
) =>
  clackSelect<T>({
    message,
    options: options as Parameters<typeof clackSelect<T>>[0]['options'],
    initialValue: initialValue ?? options[0]!.value,
  });

const conf = (message: string, initialValue = true) => clackConfirm({ message, initialValue });

// ─── CLI flags ─────────────────────────────────────────────────────────────

interface CliFlags {
  envName: string;
  listOnly: boolean;
  help: boolean;
}

function parseFlags(): CliFlags {
  const args = process.argv.slice(2);
  const flags: CliFlags = {
    envName: resolveAppEnv({ repoRoot: ROOT }).appEnv,
    listOnly: false,
    help: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') {
      flags.help = true;
    } else if (arg === '--list' || arg === '-l') {
      flags.listOnly = true;
    } else if (arg === '--env') {
      const next = args[i + 1];
      if (!next || next.startsWith('-')) {
        process.stdout.write(
          '\n  ⚠️  --env butuh nama environment (local|dev|staging|production)\n\n',
        );
        process.exit(EXIT.USAGE);
      }
      flags.envName = next;
      i++;
    } else if (arg.startsWith('--env=')) {
      flags.envName = arg.split('=')[1] || flags.envName;
    } else {
      process.stdout.write(`\n  ⚠️  Unknown flag: ${arg}\n`);
      process.stdout.write('  Run with --help untuk lihat opsi.\n\n');
      process.exit(EXIT.USAGE);
    }
  }
  return flags;
}

function printHelp(): void {
  process.stdout.write(`
  env:edit — Kelola konfigurasi & kredensial test

  Usage:
    npm run env:edit                       # menu interaktif (file = APP_ENV aktif)
    npm run env:edit:list                  # tampilkan semua config (masked)
    npm run env:use:local                  # pin env, lalu env:edit
    npx tsx tools/scripts/env-edit.ts -h   # bantuan ini

  Yang bisa diedit:
    - BASE_URL / HEADLESS / SLOW_MO / AUTH_CHALLENGE_MODE (OTP/CAPTCHA)
    - Kredensial tiap role (TEST_USER_*, FINANCE_*, SUPER_ADMIN_*, dll)
    - Tambah / hapus role
    - Key bebas (advanced)
    - Re-encrypt file saja
    - Rapikan file (rebuild bersih dari key aktif)
    - Regenerasi src/support/auth.setup.ts

  Refresh session login setelah edit:
    npm run auth:setup
    # OTP/CAPTCHA browser:
    npm run auth:setup:headed

  Docs: docs/CREDENTIALS.md · docs/AUTH-CONTEXT-CONVENTION.md

`);
}

// ─── Project / keys helpers ────────────────────────────────────────────────

function resolveKeysPath(): string | null {
  // Merge-migrate any workspace keys first, then return global path if present
  try {
    migrateWorkspaceEnvKeys(ROOT);
  } catch {
    // non-fatal
  }
  const globalPath = getGlobalKeysPath(ROOT);
  if (fs.existsSync(globalPath)) return globalPath;
  // fall back to workspace candidates if global not created yet
  const candidates = [path.join(ENV_DIR, '.env.keys'), path.join(ROOT, '.env.keys')];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

// ─── Load / save env ───────────────────────────────────────────────────────

function envFilePath(envName: string): string {
  return path.join(ENV_DIR, `${envName}.env`);
}

function failEncrypt(err: unknown): never {
  const detail = err instanceof EnvEncryptError ? (err.detail ?? err.message) : String(err);
  const title = err instanceof EnvEncryptError ? err.message : 'Gagal encrypt/decrypt env file';
  printError({
    title,
    detail,
    hint: 'Cek ~/.dotenvx-keys/<package>/.env.keys, atau recreate dari .env.example. docs/CREDENTIALS.md',
    docsLink: 'docs/CREDENTIALS.md',
    exitCode: EXIT.FIXABLE,
  });
  process.exit(EXIT.FIXABLE);
}

/** Decrypt env to plaintext string via dotenvx --stdout (does not rewrite file). */
function decryptEnvToText(filePath: string, keysPath: string | null): string {
  try {
    return decryptEnvFileToText(filePath, { repoRoot: ROOT, keysPath });
  } catch (err: unknown) {
    failEncrypt(err);
  }
}

/** Encrypt secret keys only (`*_PASSWORD` / `*_SECRET` / `*_TOKEN`). */
function encryptEnvFile(filePath: string, keysPath: string | null): void {
  try {
    encryptSecretKeysInFile(filePath, { repoRoot: ROOT, keysPath });
  } catch (err: unknown) {
    failEncrypt(err);
  }
}

function saveEnvMap(filePath: string, content: string, keysPath: string | null): void {
  // Refuse secrets with newlines before touching disk
  const map = parseEnvText(content);
  for (const [k, v] of Object.entries(map)) {
    if (/[\r\n]/.test(v)) {
      printError({
        title: `Nilai ${k} mengandung baris baru`,
        detail: 'Format .env hanya mendukung value satu baris.',
        hint: 'Ganti password/value tanpa Enter di tengah.',
        exitCode: EXIT.FIXABLE,
      });
      process.exit(EXIT.FIXABLE);
    }
  }

  fs.writeFileSync(filePath, content, 'utf-8');
  encryptEnvFile(filePath, keysPath);
  printOk(`${path.relative(ROOT, filePath)} tersimpan (secret keys terenkripsi)`);
  printInfo(
    'Session lama mungkin invalid. Jalankan:\n' +
      '    npm run auth:setup\n' +
      '    # OTP/CAPTCHA: npm run auth:setup:headed',
  );
}

// ─── Display ───────────────────────────────────────────────────────────────

function printRoleTable(map: Record<string, string>): void {
  const roles = parseRolesFromEnvMap(map);
  process.stdout.write('\n  Kredensial terdeteksi:\n\n');
  if (roles.length === 0) {
    process.stdout.write('  (belum ada role login-ready)\n\n');
  } else {
    process.stdout.write('  Role            Ids set                 Password      Auth file\n');
    process.stdout.write(
      '  ──────────────  ──────────────────────  ────────────  ──────────────────\n',
    );
    for (const r of roles) {
      const ids: string[] = [];
      if (map[r.emailKey]?.trim()) ids.push('email');
      if (map[r.usernameKey]?.trim()) ids.push('username');
      if (map[r.phoneKey]?.trim()) ids.push('phone');
      const ready = isRoleLoginReady(map, r) ? 'ok' : '!!';
      const pw = maskSecret(map[r.passwordKey]);
      process.stdout.write(
        `  ${r.name.padEnd(14)}  ${(ids.join('+') || '-').padEnd(22)}  ${pw.padEnd(12)}  ${r.authFile}  ${ready}\n`,
      );
    }
    process.stdout.write('\n');
    if (!hasDefaultUserCredentials(map)) {
      process.stdout.write(
        '  ⚠ Default user (TEST_USER_*) belum login-ready — mode general authenticated berisiko.\n\n',
      );
    }
  }

  process.stdout.write('  Config lain:\n');
  process.stdout.write(`    BASE_URL  = ${maskSecret(map.BASE_URL)}\n`);
  process.stdout.write(`    LOGIN_PATH = ${map.AUTH_LOGIN_URL_PATH ?? '/login'}\n`);
  process.stdout.write(`    SUCCESS_PATH = ${map.AUTH_SUCCESS_URL_PATH ?? '/dashboard'}\n`);
  if (map.PLAYWRIGHT_CONFIG) {
    process.stdout.write(`    PLAYWRIGHT_CONFIG = ${map.PLAYWRIGHT_CONFIG}\n`);
  }
  process.stdout.write(`    HEADLESS  = ${map.HEADLESS ?? 'true'}\n`);
  process.stdout.write(`    SLOW_MO   = ${map.SLOW_MO ?? '0'}\n`);
  process.stdout.write(`    CHALLENGE = ${map.AUTH_CHALLENGE_MODE ?? 'none'}\n`);
  if (map.AUTH_CHALLENGE_TIMEOUT_MS) {
    process.stdout.write(`    CHALLENGE_TIMEOUT_MS = ${map.AUTH_CHALLENGE_TIMEOUT_MS}\n`);
  }
  process.stdout.write('\n');
}

// ─── Menu actions ──────────────────────────────────────────────────────────

async function actionEditBase(content: string, map: Record<string, string>): Promise<string> {
  const modeChoices = [
    { title: 'none — tanpa langkah tambahan (default / CI)', value: 'none' },
    {
      title: 'otp-browser — OTP di browser terlihat (disarankan)',
      value: 'otp-browser',
    },
    {
      title: 'otp-stdin — OTP diketik di terminal (headless OK)',
      value: 'otp-stdin',
    },
    {
      title: 'captcha-browser — CAPTCHA di browser (terminal tidak bisa)',
      value: 'captcha-browser',
    },
    {
      title: 'auto — deteksi (OTP: browser dulu, fallback terminal)',
      value: 'auto',
    },
  ];
  const currentMode = (map.AUTH_CHALLENGE_MODE ?? 'none').trim().toLowerCase();
  const modeInitial = modeChoices.find((c) => c.value === currentMode)?.value ?? 'none';

  const baseUrl = abortIfCancelled(await t('BASE_URL:', map.BASE_URL || 'http://localhost:3000'));
  const loginUrlPath = abortIfCancelled(
    await t('Path halaman login (mis. /login):', map.AUTH_LOGIN_URL_PATH || '/login'),
  );
  const successUrlPath = abortIfCancelled(
    await t(
      'Path setelah login sukses (mis. /dashboard):',
      map.AUTH_SUCCESS_URL_PATH || '/dashboard',
    ),
  );
  const challengeMode = abortIfCancelled(
    await sel(
      'Langkah tambahan setelah login (OTP/CAPTCHA):',
      modeChoices.map((c) => ({ value: c.value, label: c.title })),
      modeInitial,
    ),
  );
  const headless = abortIfCancelled(
    await sel(
      'HEADLESS (jalankan browser tanpa UI?):',
      [
        { value: 'true', label: 'true — tanpa UI (CI, lebih cepat)' },
        { value: 'false', label: 'false — browser terlihat (debug lokal)' },
      ],
      (map.HEADLESS ?? 'true') === 'false' ? 'false' : 'true',
    ),
  );
  const slowMoRaw = abortIfCancelled(
    await t(
      'SLOW_MO (delay ms per aksi browser — 0 untuk off):',
      String(parseInt(map.SLOW_MO ?? '0', 10) || 0),
    ),
  );
  const challengeTimeoutRaw = abortIfCancelled(
    await t(
      'Timeout langkah tambahan (ms, min 5000):',
      String(parseInt(map.AUTH_CHALLENGE_TIMEOUT_MS ?? '180000', 10) || 180000),
    ),
  );

  const mode = String(challengeMode ?? 'none');
  const { challengeModeEnvUpserts } = require('../../src/support/human-challenge') as {
    challengeModeEnvUpserts: (
      m: string,
      cur?: { headless?: string; slowMo?: string },
    ) => Record<string, string>;
  };

  const userHeadless = String(headless ?? 'true');
  const userSlow = String(Math.max(0, Math.floor(Number(slowMoRaw ?? 0))));
  const fromMode = challengeModeEnvUpserts(mode as 'none', {
    headless: userHeadless,
    slowMo: userSlow,
  });

  // Browser modes force headed; otherwise keep user choice
  const headlessFinal = fromMode.HEADLESS ?? userHeadless;
  const slowMo = fromMode.SLOW_MO ?? userSlow;

  const loginPath = normalizeAppPath(String(loginUrlPath ?? ''), '/login');
  const successPath = normalizeAppPath(String(successUrlPath ?? ''), '/dashboard');

  return upsertEnvContent(content, {
    BASE_URL: String(baseUrl).trim().replace(/\/$/, ''),
    AUTH_LOGIN_URL_PATH: loginPath,
    AUTH_SUCCESS_URL_PATH: successPath,
    HEADLESS: headlessFinal,
    SLOW_MO: slowMo,
    AUTH_CHALLENGE_MODE: mode,
    AUTH_CHALLENGE_TIMEOUT_MS: String(
      Math.max(5000, Math.floor(Number(challengeTimeoutRaw ?? 180000))),
    ),
  });
}

async function actionEditRole(content: string, map: Record<string, string>): Promise<string> {
  const roles = parseRolesFromEnvMap(map);
  if (roles.length === 0) {
    printWarn('Belum ada role. Pilih "Tambah role" dulu.');
    return content;
  }

  const roleName = abortIfCancelled(
    await sel(
      'Pilih role yang mau diedit:',
      roles.map((r) => ({
        value: r.name,
        label: `${r.name}  (${maskSecret(map[r.emailKey] || map[r.usernameKey] || map[r.phoneKey])})`,
      })),
    ),
  );
  if (!roleName) return content;

  const ref = roleCredentialKeys(roleName);
  const password = abortIfCancelled(await pw(`${ref.passwordKey} (kosongkan jika tidak ganti):`));
  const email = abortIfCancelled(
    await t(`${ref.emailKey} (Enter skip / kosongkan):`, map[ref.emailKey] || ''),
  );
  const username = abortIfCancelled(
    await t(`${ref.usernameKey} (opsional):`, map[ref.usernameKey] || ''),
  );
  const phone = abortIfCancelled(await t(`${ref.phoneKey} (opsional):`, map[ref.phoneKey] || ''));
  const loginIdPref = abortIfCancelled(
    await sel('Preferensi login id:', [
      { value: 'auto', label: 'Auto (username → email → phone)' },
      { value: 'username', label: 'Username' },
      { value: 'email', label: 'Email' },
      { value: 'phone', label: 'Phone' },
    ]),
  );
  const loginUrlPath = abortIfCancelled(
    await t(
      `Path halaman login ${roleName} (Enter = ${map[ref.loginUrlPathKey] || '/login'}):`,
      map[ref.loginUrlPathKey] || '',
    ),
  );
  const successUrlPath = abortIfCancelled(
    await t(
      `Path redirect sukses ${roleName} (Enter = ${map[ref.successUrlPathKey] || '/dashboard'}):`,
      map[ref.successUrlPathKey] || '',
    ),
  );
  const company = abortIfCancelled(
    await t(
      `${ref.companyKey} (opsional, kode company/tenant di form login):`,
      map[ref.companyKey] || '',
    ),
  );

  const passwordFinal =
    password && String(password).length > 0 ? String(password) : map[ref.passwordKey] || '';
  const emailFinal = String(email ?? '').trim();
  const usernameFinal = String(username ?? '').trim();
  const phoneFinal = String(phone ?? '').trim();
  const loginUrlPathFinal = String(loginUrlPath ?? '').trim();
  const successUrlPathFinal = String(successUrlPath ?? '').trim();
  const companyFinal = String(company ?? '').trim();
  if (!passwordFinal) {
    printWarn('Password wajib untuk role yang login.');
    return content;
  }
  if (!emailFinal && !usernameFinal && !phoneFinal) {
    printWarn('Isi minimal satu identitas: email, username, atau telepon.');
    return content;
  }

  const values: Record<string, string> = {
    [ref.passwordKey]: passwordFinal,
  };
  if (emailFinal) values[ref.emailKey] = emailFinal;
  if (usernameFinal) values[ref.usernameKey] = usernameFinal;
  if (phoneFinal) values[ref.phoneKey] = phoneFinal;
  const pref = String(loginIdPref ?? 'auto');
  if (pref && pref !== 'auto') values[ref.loginIdPrefKey] = pref;
  if (loginUrlPathFinal)
    values[ref.loginUrlPathKey] = normalizeAppPath(loginUrlPathFinal, '/login');
  if (successUrlPathFinal)
    values[ref.successUrlPathKey] = normalizeAppPath(successUrlPathFinal, '/dashboard');
  if (companyFinal) values[ref.companyKey] = companyFinal;

  const trial = { ...map, ...values };
  // Cleared fields must not linger from previous map
  if (!emailFinal) delete trial[ref.emailKey];
  if (!usernameFinal) delete trial[ref.usernameKey];
  if (!phoneFinal) delete trial[ref.phoneKey];
  if (!pref || pref === 'auto') delete trial[ref.loginIdPrefKey];

  const resolved = resolveLoginIdentifier(trial, ref);
  if ('error' in resolved) {
    printWarn(resolved.error);
    return content;
  }

  let next = upsertEnvContent(content, values);
  // Remove identity keys that user cleared
  const toRemove: string[] = [];
  if (!emailFinal && map[ref.emailKey] !== undefined) toRemove.push(ref.emailKey);
  if (!usernameFinal && map[ref.usernameKey] !== undefined) toRemove.push(ref.usernameKey);
  if (!phoneFinal && map[ref.phoneKey] !== undefined) toRemove.push(ref.phoneKey);
  if ((!pref || pref === 'auto') && map[ref.loginIdPrefKey] !== undefined) {
    toRemove.push(ref.loginIdPrefKey);
  }
  if (!companyFinal && map[ref.companyKey] !== undefined) toRemove.push(ref.companyKey);
  if (toRemove.length > 0) next = removeEnvKeys(next, toRemove);
  return next;
}

async function actionAddRole(content: string, map: Record<string, string>): Promise<string> {
  const roleName = abortIfCancelled(
    await clackText({
      message: 'Nama role (lowercase-hyphen, misal: finance, user) — jangan "general":',
      validate: (v) => {
        const n = (v ?? '').trim().toLowerCase();
        if (n === 'general') return 'Pakai "user" untuk default; general = mode pipeline saja';
        if (n === 'default') return 'Pakai "user" untuk default TEST_USER_*';
        if (!isValidRoleName(n)) return 'Hanya a-z, 0-9, dan tanda hubung';
        const existing = parseRolesFromEnvMap(map).some((r) => r.name === canonicalRoleName(n));
        if (existing) return `Role "${canonicalRoleName(n)}" sudah ada — pilih Edit`;
        return undefined;
      },
    }),
  );
  const password = abortIfCancelled(
    await clackPassword({
      message: 'Password:',
      validate: (v) => ((v ?? '').length > 0 ? undefined : 'Wajib diisi / Required'),
    }),
  );
  const email = abortIfCancelled(await t('Email (Enter skip):'));
  const username = abortIfCancelled(await t('Username (Enter skip):'));
  const phone = abortIfCancelled(await t('Telepon (Enter skip):'));
  const loginIdPref = abortIfCancelled(
    await sel('Preferensi login id:', [
      { value: 'auto', label: 'Auto (username → email → phone)' },
      { value: 'username', label: 'Username' },
      { value: 'email', label: 'Email' },
      { value: 'phone', label: 'Phone' },
    ]),
  );
  const loginUrlPath = abortIfCancelled(await t('Path halaman login (Enter = /login):', '/login'));
  const successUrlPath = abortIfCancelled(
    await t('Path redirect sukses (Enter = /dashboard):', '/dashboard'),
  );
  const company = abortIfCancelled(await t('Kode company/tenant (opsional, Enter skip):'));

  if (!roleName || !password) return content;

  const emailFinal = String(email ?? '').trim();
  const usernameFinal = String(username ?? '').trim();
  const phoneFinal = String(phone ?? '').trim();
  const loginUrlPathFinal = String(loginUrlPath ?? '').trim();
  const successUrlPathFinal = String(successUrlPath ?? '').trim();
  const companyFinal = String(company ?? '').trim();
  if (!emailFinal && !usernameFinal && !phoneFinal) {
    printWarn('Isi minimal satu identitas: email, username, atau telepon.');
    return content;
  }

  const ref = roleCredentialKeys(String(roleName).trim());
  const values: Record<string, string> = {
    [ref.passwordKey]: String(password),
  };
  if (emailFinal) values[ref.emailKey] = emailFinal;
  if (usernameFinal) values[ref.usernameKey] = usernameFinal;
  if (phoneFinal) values[ref.phoneKey] = phoneFinal;
  const pref = String(loginIdPref ?? 'auto');
  if (pref && pref !== 'auto') values[ref.loginIdPrefKey] = pref;
  if (loginUrlPathFinal && loginUrlPathFinal !== '/login') {
    values[ref.loginUrlPathKey] = normalizeAppPath(loginUrlPathFinal, '/login');
  }
  if (successUrlPathFinal && successUrlPathFinal !== '/dashboard') {
    values[ref.successUrlPathKey] = normalizeAppPath(successUrlPathFinal, '/dashboard');
  }
  if (companyFinal) values[ref.companyKey] = companyFinal;

  const next = upsertEnvContent(content, values, 'Kredensial per role');
  printOk(`Role ${ref.name} ditambahkan`);
  printInfo(`Auth file nanti: ${ref.authFile}`);
  return next;
}

async function actionRemoveRole(
  content: string,
  map: Record<string, string>,
): Promise<{ content: string; removedAuth?: string }> {
  const roles = parseRolesFromEnvMap(map);
  if (roles.length === 0) {
    printWarn('Tidak ada role untuk dihapus.');
    return { content };
  }

  const roleName = abortIfCancelled(
    await sel(
      'Role yang dihapus:',
      roles.map((r) => ({ value: r.name, label: r.name })),
    ),
  );
  if (!roleName) return { content };

  const confirmed = abortIfCancelled(
    await conf(`Hapus keys untuk role "${roleName}" dari env file?`, false),
  );
  if (!confirmed) return { content };

  const ref = roleCredentialKeys(roleName);
  const keys = [
    ref.emailKey,
    ref.usernameKey,
    ref.phoneKey,
    ref.passwordKey,
    ref.loginIdPrefKey,
    ref.loginUrlPathKey,
    ref.successUrlPathKey,
  ];

  const next = removeEnvKeys(content, keys);

  const authAbs = path.join(ROOT, ref.authFile);
  if (fs.existsSync(authAbs)) {
    const delAuth = abortIfCancelled(await conf(`Hapus juga ${ref.authFile}?`, true));
    if (delAuth) {
      fs.unlinkSync(authAbs);
      printOk(`${ref.authFile} dihapus`);
    }
  }

  printOk(`Keys role ${roleName} dihapus dari env`);
  return { content: next, removedAuth: ref.authFile };
}

async function actionFreeKey(content: string): Promise<string> {
  const key = abortIfCancelled(
    await clackText({
      message: 'Nama KEY (UPPER_SNAKE):',
      validate: (v) =>
        /^[A-Z][A-Z0-9_]*$/.test((v ?? '').trim())
          ? undefined
          : 'Harus UPPER_SNAKE (misal: MY_KEY)',
    }),
  );
  const value = abortIfCancelled(await t('Value:'));
  if (!key) return content;
  return upsertEnvContent(content, { [String(key).trim()]: String(value ?? '') });
}

function regenAuthSetup(map: Record<string, string>): void {
  const roles = parseRolesFromEnvMap(map);
  if (roles.length === 0) {
    printWarn('Tidak ada role di env — auth.setup tidak di-generate.');
    return;
  }

  const loginUrl = map.AUTH_LOGIN_URL_PATH
    ? normalizeAppPath(map.AUTH_LOGIN_URL_PATH, '/login')
    : '/login';
  const successUrlPath = map.AUTH_SUCCESS_URL_PATH
    ? normalizeAppPath(map.AUTH_SUCCESS_URL_PATH, '/dashboard')
    : '/dashboard';

  if (fs.existsSync(AUTH_SETUP_OUT)) {
    const bak = AUTH_SETUP_OUT + '.bak';
    fs.copyFileSync(AUTH_SETUP_OUT, bak);
    printInfo(`Backup: ${path.relative(ROOT, bak)}`);
  }

  writeAuthSetup(
    {
      roles: roles.map((r) => ({
        name: r.name,
        authFile: r.authFile,
        loginUrl: map[r.loginUrlPathKey] || loginUrl,
        successUrlPath: map[r.successUrlPathKey] || successUrlPath,
      })),
      loginUrl,
      successUrlPath,
    },
    AUTH_SETUP_OUT,
  );
  printOk(`${path.relative(ROOT, AUTH_SETUP_OUT)} di-regenerate (${roles.length} role)`);
}

// ─── Main ──────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const flags = parseFlags();
  if (flags.help) {
    printHelp();
    process.exit(EXIT.OK);
  }

  const filePath = envFilePath(flags.envName);
  if (!fs.existsSync(filePath)) {
    printError({
      title: `File tidak ditemukan: config/environments/${flags.envName}.env`,
      detail: `Expected path: ${filePath}`,
      hint: `Salin template: cp config/environments/local.env.example config/environments/${flags.envName}.env`,
      docsLink: 'docs/CREDENTIALS.md',
      exitCode: EXIT.USAGE,
    });
    process.exit(EXIT.USAGE);
  }

  const keysPath = resolveKeysPath();
  let content = decryptEnvToText(filePath, keysPath);
  let map = parseEnvText(content);

  process.stdout.write('\n');
  process.stdout.write('╔══════════════════════════════════════════════════════════════╗\n');
  process.stdout.write('║  🔐 env:edit — Kelola kredensial test                        ║\n');
  process.stdout.write('╚══════════════════════════════════════════════════════════════╝\n');
  process.stdout.write(`  File: config/environments/${flags.envName}.env\n`);
  if (keysPath) {
    process.stdout.write(`  Keys: ${keysPath}\n`);
  }

  printRoleTable(map);

  if (flags.listOnly) {
    process.exit(EXIT.OK);
  }

  let dirty = false;
  let running = true;

  while (running) {
    const action = abortIfCancelled(
      await sel('Pilih aksi:', [
        { value: 'list', label: 'Lihat kredensial (masked)' },
        { value: 'base', label: 'Edit BASE_URL / browser / OTP-CAPTCHA' },
        { value: 'edit-role', label: 'Edit kredensial role' },
        { value: 'add-role', label: 'Tambah role' },
        { value: 'remove-role', label: 'Hapus role' },
        { value: 'free', label: 'Edit key bebas (advanced)' },
        { value: 'save', label: 'Simpan & encrypt' },
        { value: 'reencrypt', label: 'Re-encrypt file saja (tanpa ubah isi)' },
        {
          value: 'tidy',
          label: 'Rapikan file — rebuild bersih dari key aktif (hapus komentar placeholder)',
        },
        {
          value: 'regen-auth',
          label: 'Regenerasi src/support/auth.setup.ts dari roles di env',
        },
        { value: 'exit', label: 'Keluar' },
      ]),
    );

    if (!action || action === 'exit') {
      if (dirty) {
        const save = abortIfCancelled(
          await conf('Ada perubahan belum disimpan. Simpan & encrypt sekarang?', true),
        );
        if (save) {
          saveEnvMap(filePath, content, resolveKeysPath() ?? keysPath);
        } else {
          printWarn('Keluar tanpa menyimpan perubahan di memory.');
        }
      }
      process.stdout.write('\n');
      running = false;
      continue;
    }

    if (action === 'list') {
      map = parseEnvText(content);
      printRoleTable(map);
      continue;
    }

    if (action === 'base') {
      const next = await actionEditBase(content, map);
      if (next !== content) {
        content = next;
        map = parseEnvText(content);
        dirty = true;
        printOk('BASE_URL / browser / challenge di-update (belum disimpan ke disk)');
      }
      continue;
    }

    if (action === 'edit-role') {
      map = parseEnvText(content);
      const next = await actionEditRole(content, map);
      if (next !== content) {
        content = next;
        map = parseEnvText(content);
        dirty = true;
        printOk('Kredensial role di-update (belum disimpan ke disk)');
      }
      continue;
    }

    if (action === 'add-role') {
      map = parseEnvText(content);
      const next = await actionAddRole(content, map);
      if (next !== content) {
        content = next;
        map = parseEnvText(content);
        dirty = true;
      }
      continue;
    }

    if (action === 'remove-role') {
      map = parseEnvText(content);
      const result = await actionRemoveRole(content, map);
      if (result.content !== content) {
        content = result.content;
        map = parseEnvText(content);
        dirty = true;
      }
      continue;
    }

    if (action === 'free') {
      const next = await actionFreeKey(content);
      if (next !== content) {
        content = next;
        map = parseEnvText(content);
        dirty = true;
        printOk('Key di-update (belum disimpan ke disk)');
      }
      continue;
    }

    if (action === 'save') {
      saveEnvMap(filePath, content, resolveKeysPath() ?? keysPath);
      // reload encrypted→decrypt for further edits
      content = decryptEnvToText(filePath, resolveKeysPath());
      map = parseEnvText(content);
      dirty = false;
      continue;
    }

    if (action === 'reencrypt') {
      // write current content then encrypt
      fs.writeFileSync(filePath, content, 'utf-8');
      encryptEnvFile(filePath, resolveKeysPath() ?? keysPath);
      printOk('Re-encrypt selesai');
      content = decryptEnvToText(filePath, resolveKeysPath());
      map = parseEnvText(content);
      dirty = false;
      continue;
    }

    if (action === 'tidy') {
      // Rebuild the file from active keys only — same layout the setup wizard
      // generates: sections, no commented-out placeholders, no dotenvx box.
      map = parseEnvText(content);
      const next = buildCleanEnvContent({ appEnv: flags.envName, values: map });
      if (next !== content) {
        content = next;
        map = parseEnvText(content);
        dirty = true;
        printOk('Struktur file dirapikan (belum disimpan — pilih "Simpan & encrypt")');
      } else {
        printInfo('File sudah rapikan — tidak ada perubahan');
      }
      continue;
    }

    if (action === 'regen-auth') {
      map = parseEnvText(content);
      const ok = abortIfCancelled(
        await conf(
          fs.existsSync(AUTH_SETUP_OUT)
            ? 'Overwrite src/support/auth.setup.ts? (backup .bak dibuat)'
            : 'Generate src/support/auth.setup.ts dari roles di env?',
          true,
        ),
      );
      if (ok) regenAuthSetup(map);
      continue;
    }
  }
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  printError({
    title: 'Unexpected error di env:edit',
    detail: msg,
    hint: 'Hubungi Framework Maintainer jika berulang. Fallback manual: docs/CREDENTIALS.md',
    exitCode: EXIT.ESCALATE,
  });
  process.exit(EXIT.ESCALATE);
});
