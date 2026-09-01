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
import prompts from 'prompts';
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
import { buildCleanEnvContent } from '../../src/utils/env-clean';
import {
  decryptEnvFileToText,
  encryptSecretKeysInFile,
  EnvEncryptError,
} from '../../src/utils/env-secrets';

const ROOT = process.cwd();
const ENV_DIR = getEnvironmentsDir(ROOT);
const AUTH_SETUP_OUT = path.join(ROOT, 'src', 'support', 'auth.setup.ts');

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
  const modeInitial = Math.max(
    0,
    modeChoices.findIndex((c) => c.value === currentMode),
  );

  const ans = await prompts([
    {
      type: 'text',
      name: 'baseUrl',
      message: 'BASE_URL:',
      initial: map.BASE_URL || 'http://localhost:3000',
    },
    {
      type: 'select',
      name: 'challengeMode',
      message: 'Langkah tambahan setelah login (OTP/CAPTCHA):',
      choices: modeChoices,
      initial: modeInitial,
    },
    {
      type: 'select',
      name: 'headless',
      message: 'HEADLESS (jalankan browser tanpa UI?):',
      choices: [
        { title: 'true — tanpa UI (CI, lebih cepat)', value: 'true' },
        { title: 'false — browser terlihat (debug lokal)', value: 'false' },
      ],
      initial: (map.HEADLESS ?? 'true') === 'false' ? 1 : 0,
    },
    {
      type: 'number',
      name: 'slowMo',
      message: 'SLOW_MO (delay ms per aksi browser — 0 untuk off):',
      initial: parseInt(map.SLOW_MO ?? '0', 10) || 0,
      min: 0,
      max: 10000,
      validate: (v: number) => (Number.isFinite(v) && v >= 0) || 'Harus angka >= 0',
    },
    {
      type: 'number',
      name: 'challengeTimeout',
      message: 'Timeout langkah tambahan (ms, min 5000):',
      initial: parseInt(map.AUTH_CHALLENGE_TIMEOUT_MS ?? '180000', 10) || 180000,
      min: 5000,
      max: 900000,
    },
  ]);
  if (ans.baseUrl === undefined) return content;

  const mode = String(ans.challengeMode ?? 'none');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { challengeModeEnvUpserts } = require('../../src/support/human-challenge') as {
    challengeModeEnvUpserts: (
      m: string,
      cur?: { headless?: string; slowMo?: string },
    ) => Record<string, string>;
  };

  const userHeadless = String(ans.headless ?? 'true');
  const userSlow = String(Math.max(0, Math.floor(Number(ans.slowMo ?? 0))));
  const fromMode = challengeModeEnvUpserts(mode as 'none', {
    headless: userHeadless,
    slowMo: userSlow,
  });

  // Browser modes force headed; otherwise keep user choice
  const headless = fromMode.HEADLESS ?? userHeadless;
  const slowMo = fromMode.SLOW_MO ?? userSlow;

  return upsertEnvContent(content, {
    BASE_URL: String(ans.baseUrl).trim().replace(/\/$/, ''),
    HEADLESS: headless,
    SLOW_MO: slowMo,
    AUTH_CHALLENGE_MODE: mode,
    AUTH_CHALLENGE_TIMEOUT_MS: String(
      Math.max(5000, Math.floor(Number(ans.challengeTimeout ?? 180000))),
    ),
  });
}

async function actionEditRole(content: string, map: Record<string, string>): Promise<string> {
  const roles = parseRolesFromEnvMap(map);
  if (roles.length === 0) {
    printWarn('Belum ada role. Pilih "Tambah role" dulu.');
    return content;
  }

  const { roleName } = await prompts({
    type: 'select',
    name: 'roleName',
    message: 'Pilih role yang mau diedit:',
    choices: roles.map((r) => ({
      title: `${r.name}  (${maskSecret(map[r.emailKey] || map[r.usernameKey] || map[r.phoneKey])})`,
      value: r.name,
    })),
  });
  if (!roleName) return content;

  const ref = roleCredentialKeys(roleName);
  const ans = await prompts([
    {
      type: 'password',
      name: 'password',
      message: `${ref.passwordKey} (kosongkan jika tidak ganti):`,
    },
    {
      type: 'text',
      name: 'email',
      message: `${ref.emailKey} (Enter skip / kosongkan):`,
      initial: map[ref.emailKey] || '',
    },
    {
      type: 'text',
      name: 'username',
      message: `${ref.usernameKey} (opsional):`,
      initial: map[ref.usernameKey] || '',
    },
    {
      type: 'text',
      name: 'phone',
      message: `${ref.phoneKey} (opsional):`,
      initial: map[ref.phoneKey] || '',
    },
    {
      type: 'select',
      name: 'loginIdPref',
      message: 'Preferensi login id:',
      choices: [
        { title: 'Auto (email → username → phone)', value: 'auto' },
        { title: 'Email', value: 'email' },
        { title: 'Username', value: 'username' },
        { title: 'Phone', value: 'phone' },
      ],
      initial: 0,
    },
  ]);
  if (ans.email === undefined && ans.username === undefined) return content;

  const password =
    ans.password && String(ans.password).length > 0
      ? String(ans.password)
      : map[ref.passwordKey] || '';
  const email = String(ans.email ?? '').trim();
  const username = String(ans.username ?? '').trim();
  const phone = String(ans.phone ?? '').trim();
  if (!password) {
    printWarn('Password wajib untuk role yang login.');
    return content;
  }
  if (!email && !username && !phone) {
    printWarn('Isi minimal satu identitas: email, username, atau telepon.');
    return content;
  }

  const values: Record<string, string> = {
    [ref.passwordKey]: password,
  };
  if (email) values[ref.emailKey] = email;
  if (username) values[ref.usernameKey] = username;
  if (phone) values[ref.phoneKey] = phone;
  const pref = String(ans.loginIdPref ?? 'auto');
  if (pref && pref !== 'auto') values[ref.loginIdPrefKey] = pref;

  const trial = { ...map, ...values };
  // Cleared fields must not linger from previous map
  if (!email) delete trial[ref.emailKey];
  if (!username) delete trial[ref.usernameKey];
  if (!phone) delete trial[ref.phoneKey];
  if (!pref || pref === 'auto') delete trial[ref.loginIdPrefKey];

  const resolved = resolveLoginIdentifier(trial, ref);
  if ('error' in resolved) {
    printWarn(resolved.error);
    return content;
  }

  let next = upsertEnvContent(content, values);
  // Remove identity keys that user cleared
  const toRemove: string[] = [];
  if (!email && map[ref.emailKey] !== undefined) toRemove.push(ref.emailKey);
  if (!username && map[ref.usernameKey] !== undefined) toRemove.push(ref.usernameKey);
  if (!phone && map[ref.phoneKey] !== undefined) toRemove.push(ref.phoneKey);
  if ((!pref || pref === 'auto') && map[ref.loginIdPrefKey] !== undefined) {
    toRemove.push(ref.loginIdPrefKey);
  }
  if (toRemove.length > 0) next = removeEnvKeys(next, toRemove);
  return next;
}

async function actionAddRole(content: string, map: Record<string, string>): Promise<string> {
  const ans = await prompts([
    {
      type: 'text',
      name: 'roleName',
      message: 'Nama role (lowercase-hyphen, misal: finance, user) — jangan "general":',
      validate: (v: string) => {
        const n = v.trim().toLowerCase();
        if (n === 'general') return 'Pakai "user" untuk default; general = mode pipeline saja';
        if (n === 'default') return 'Pakai "user" untuk default TEST_USER_*';
        if (!isValidRoleName(n)) return 'Hanya a-z, 0-9, dan tanda hubung';
        const existing = parseRolesFromEnvMap(map).some((r) => r.name === canonicalRoleName(n));
        if (existing) return `Role "${canonicalRoleName(n)}" sudah ada — pilih Edit`;
        return true;
      },
    },
    {
      type: 'password',
      name: 'password',
      message: 'Password:',
      validate: (v: string) => v.length > 0 || 'Wajib diisi',
    },
    { type: 'text', name: 'email', message: 'Email (Enter skip):' },
    { type: 'text', name: 'username', message: 'Username (Enter skip):' },
    { type: 'text', name: 'phone', message: 'Telepon (Enter skip):' },
    {
      type: 'select',
      name: 'loginIdPref',
      message: 'Preferensi login id:',
      choices: [
        { title: 'Auto (email → username → phone)', value: 'auto' },
        { title: 'Email', value: 'email' },
        { title: 'Username', value: 'username' },
        { title: 'Phone', value: 'phone' },
      ],
      initial: 0,
    },
  ]);
  if (!ans.roleName || !ans.password) return content;

  const email = String(ans.email ?? '').trim();
  const username = String(ans.username ?? '').trim();
  const phone = String(ans.phone ?? '').trim();
  if (!email && !username && !phone) {
    printWarn('Isi minimal satu identitas: email, username, atau telepon.');
    return content;
  }

  const ref = roleCredentialKeys(String(ans.roleName).trim());
  const values: Record<string, string> = {
    [ref.passwordKey]: String(ans.password),
  };
  if (email) values[ref.emailKey] = email;
  if (username) values[ref.usernameKey] = username;
  if (phone) values[ref.phoneKey] = phone;
  const pref = String(ans.loginIdPref ?? 'auto');
  if (pref && pref !== 'auto') values[ref.loginIdPrefKey] = pref;

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

  const { roleName } = await prompts({
    type: 'select',
    name: 'roleName',
    message: 'Role yang dihapus:',
    choices: roles.map((r) => ({ title: r.name, value: r.name })),
  });
  if (!roleName) return { content };

  const { confirm } = await prompts({
    type: 'confirm',
    name: 'confirm',
    message: `Hapus keys untuk role "${roleName}" dari env file?`,
    initial: false,
  });
  if (!confirm) return { content };

  const ref = roleCredentialKeys(roleName);
  const keys = [ref.emailKey, ref.usernameKey, ref.phoneKey, ref.passwordKey, ref.loginIdPrefKey];

  const next = removeEnvKeys(content, keys);

  const authAbs = path.join(ROOT, ref.authFile);
  if (fs.existsSync(authAbs)) {
    const { delAuth } = await prompts({
      type: 'confirm',
      name: 'delAuth',
      message: `Hapus juga ${ref.authFile}?`,
      initial: true,
    });
    if (delAuth) {
      fs.unlinkSync(authAbs);
      printOk(`${ref.authFile} dihapus`);
    }
  }

  printOk(`Keys role ${roleName} dihapus dari env`);
  return { content: next, removedAuth: ref.authFile };
}

async function actionFreeKey(content: string): Promise<string> {
  const ans = await prompts([
    {
      type: 'text',
      name: 'key',
      message: 'Nama KEY (UPPER_SNAKE):',
      validate: (v: string) =>
        /^[A-Z][A-Z0-9_]*$/.test(v.trim()) || 'Harus UPPER_SNAKE (misal: MY_KEY)',
    },
    {
      type: 'text',
      name: 'value',
      message: 'Value:',
    },
  ]);
  if (!ans.key) return content;
  return upsertEnvContent(content, { [String(ans.key).trim()]: String(ans.value ?? '') });
}

function regenAuthSetup(map: Record<string, string>): void {
  const roles = parseRolesFromEnvMap(map);
  if (roles.length === 0) {
    printWarn('Tidak ada role di env — auth.setup tidak di-generate.');
    return;
  }

  const loginUrl = map.AUTH_LOGIN_URL_PATH
    ? map.AUTH_LOGIN_URL_PATH.startsWith('/')
      ? map.AUTH_LOGIN_URL_PATH
      : `/${map.AUTH_LOGIN_URL_PATH}`
    : '/login';
  const successUrlPath = map.AUTH_SUCCESS_URL_PATH
    ? map.AUTH_SUCCESS_URL_PATH.startsWith('/')
      ? map.AUTH_SUCCESS_URL_PATH
      : `/${map.AUTH_SUCCESS_URL_PATH}`
    : '/dashboard';

  if (fs.existsSync(AUTH_SETUP_OUT)) {
    const bak = AUTH_SETUP_OUT + '.bak';
    fs.copyFileSync(AUTH_SETUP_OUT, bak);
    printInfo(`Backup: ${path.relative(ROOT, bak)}`);
  }

  writeAuthSetup(
    {
      roles: roles.map((r) => ({ name: r.name, authFile: r.authFile })),
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
    const { action } = await prompts({
      type: 'select',
      name: 'action',
      message: 'Pilih aksi:',
      choices: [
        { title: 'Lihat kredensial (masked)', value: 'list' },
        { title: 'Edit BASE_URL / browser / OTP-CAPTCHA', value: 'base' },
        { title: 'Edit kredensial role', value: 'edit-role' },
        { title: 'Tambah role', value: 'add-role' },
        { title: 'Hapus role', value: 'remove-role' },
        { title: 'Edit key bebas (advanced)', value: 'free' },
        { title: 'Simpan & encrypt', value: 'save' },
        { title: 'Re-encrypt file saja (tanpa ubah isi)', value: 'reencrypt' },
        {
          title: 'Rapikan file — rebuild bersih dari key aktif (hapus komentar placeholder)',
          value: 'tidy',
        },
        {
          title: 'Regenerasi src/support/auth.setup.ts dari roles di env',
          value: 'regen-auth',
        },
        { title: 'Keluar', value: 'exit' },
      ],
    });

    if (!action || action === 'exit') {
      if (dirty) {
        const { save } = await prompts({
          type: 'confirm',
          name: 'save',
          message: 'Ada perubahan belum disimpan. Simpan & encrypt sekarang?',
          initial: true,
        });
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
      const { ok } = await prompts({
        type: 'confirm',
        name: 'ok',
        message: fs.existsSync(AUTH_SETUP_OUT)
          ? 'Overwrite src/support/auth.setup.ts? (backup .bak dibuat)'
          : 'Generate src/support/auth.setup.ts dari roles di env?',
        initial: true,
      });
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
