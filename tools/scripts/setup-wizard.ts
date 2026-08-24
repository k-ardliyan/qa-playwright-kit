/// <reference types="node" />
/**
 * setup-wizard — Interactive CLI wizard setup pertama kali untuk QA
 *
 * Usage: npm run setup:wizard
 *
 * Phase 0: Welcome + pre-flight + resume detection
 * Phase 1: Project name → APP_ENV → BASE_URL for that env (environments/{APP_ENV}.env)
 * Phase 2: Kredensial test (email/username/phone + password, multi-role) → same env file
 * Phase 3: Install dependencies (npm, playwright, mcp:build)
 * Phase 4: Hermes + MCP verification
 * Phase 5: Auth setup (generate + run auth.setup.ts)
 * Phase 6: Verify + encrypt environments/{APP_ENV}.env
 * Phase 7: Next steps
 *
 * @module scripts/setup-wizard
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import prompts from 'prompts';
import { printOk, printWarn, printError, printInfo } from './format-error';
import { EXIT } from './exit-codes';
import { writeAuthSetup } from './wizard-auth-template';
import {
  encodeEnvValue,
  normalizeWizardRoles,
  isValidRoleName,
  canonicalRoleName,
  type WizardRoleInput,
} from './env-edit-lib';
import { resolveProjectName } from '../../src/utils/dotenv-keys';
import {
  buildLoginRequirement,
  type LoginMechanism,
  type RoleSpec as ScaffolderRole,
} from './wizard-login-template';

const ROOT = process.cwd();
const STATE_FILE = path.join(ROOT, '.wizard-state.json');
const ENV_DIR = path.join(ROOT, 'environments');
const AUTH_SETUP_OUT = path.join(ROOT, 'src', 'support', 'auth.setup.ts');
const TOTAL_PHASES = 7;

/** Path to environments/{envName}.env (APP_ENV profile file). */
function envFilePath(envName: string): string {
  const name = (envName || 'local').trim() || 'local';
  return path.join(ENV_DIR, `${name}.env`);
}

function suggestedBaseUrl(envName: string): string {
  switch ((envName || 'local').trim()) {
    case 'dev':
      return 'https://dev.example.com';
    case 'staging':
      return 'https://staging.example.com';
    case 'production':
      return 'https://app.example.com';
    case 'local':
    default:
      return 'http://localhost:3000';
  }
}

/**
 * Ensure environments/{env}.env exists (bootstrap from example if needed).
 * Returns absolute path.
 */
function ensureEnvFile(envName: string): string {
  if (!fs.existsSync(ENV_DIR)) fs.mkdirSync(ENV_DIR, { recursive: true });
  const target = envFilePath(envName);
  if (fs.existsSync(target)) return target;
  const example = path.join(ENV_DIR, `${envName}.env.example`);
  const localExample = path.join(ENV_DIR, 'local.env.example');
  if (fs.existsSync(example)) {
    fs.copyFileSync(example, target);
  } else if (fs.existsSync(localExample)) {
    fs.copyFileSync(localExample, target);
  } else {
    fs.writeFileSync(target, '', 'utf8');
  }
  return target;
}

// ─── CLI flags ─────────────────────────────────────────────────────────────

interface CliFlags {
  dryRun: boolean;
  fromPhase: number | null;
}

function parseFlags(): CliFlags {
  const args = process.argv.slice(2);
  const flags: CliFlags = { dryRun: false, fromPhase: null };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--dry-run' || arg === '--dryrun') {
      flags.dryRun = true;
    } else if (arg === '--from-phase') {
      const next = args[i + 1];
      const n = next ? parseInt(next, 10) : NaN;
      if (Number.isFinite(n) && n >= 0 && n <= TOTAL_PHASES) {
        flags.fromPhase = n;
        i++;
      } else {
        process.stdout.write('\n  ⚠️  --from-phase butuh angka 0-' + TOTAL_PHASES + '\n');
        process.stdout.write('  Contoh: npm run setup:wizard -- --from-phase=3\n\n');
        process.exit(2);
      }
    } else if (arg.startsWith('--from-phase=')) {
      const n = parseInt(arg.split('=')[1], 10);
      if (Number.isFinite(n) && n >= 0 && n <= TOTAL_PHASES) {
        flags.fromPhase = n;
      } else {
        process.stdout.write('\n  ⚠️  --from-phase butuh angka 0-' + TOTAL_PHASES + '\n\n');
        process.exit(2);
      }
    } else if (arg === '--help' || arg === '-h') {
      process.stdout.write('\n  Setup Wizard — Usage:\n');
      process.stdout.write('    npm run setup:wizard                       # interactive setup\n');
      process.stdout.write(
        '    npm run setup:wizard -- --dry-run          # preview only, no writes\n',
      );
      process.stdout.write('    npm run setup:wizard -- --from-phase=3     # start at Phase 3\n');
      process.stdout.write('    npm run setup:wizard -- --help             # this help\n\n');
      process.exit(0);
    } else {
      process.stdout.write('\n  ⚠️  Unknown flag: ' + arg + '\n');
      process.stdout.write('  Run with --help untuk lihat opsi.\n\n');
      process.exit(2);
    }
  }

  return flags;
}

const FLAGS = parseFlags();

// ─── Types ────────────────────────────────────────────────────────────────────

interface RoleCredential {
  name: string;
  authFile: string;
}

interface WizardState {
  version: '1';
  completedPhases: number[];
  projectName: string;
  baseUrl: string;
  envName: string;
  loginUrl: string;
  successUrlPath: string;
  roles: RoleCredential[];
  mcpVerified: boolean;
  authSetupDone: boolean;
  timestamp: string;
  /** Login mechanism — set by Phase 5. */
  loginMechanism: LoginMechanism | null;
  /** Optional field hints for Generator live-verify. */
  loginFieldHints: string[];
  passwordFieldHints: string[];
  submitButtonHints: string[];
}

// ─── State helpers ────────────────────────────────────────────────────────────

function loadState(): WizardState | null {
  if (!fs.existsSync(STATE_FILE)) return null;
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8')) as WizardState;
  } catch {
    return null;
  }
}

function saveState(state: WizardState): void {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf-8');
}

function markPhase(state: WizardState, phase: number): void {
  if (!state.completedPhases.includes(phase)) {
    state.completedPhases.push(phase);
  }
  state.timestamp = new Date().toISOString();
  saveState(state);
}

function defaultState(): WizardState {
  return {
    version: '1',
    completedPhases: [],
    projectName: '',
    baseUrl: '',
    envName: 'local',
    loginUrl: '/login',
    successUrlPath: '/dashboard',
    roles: [],
    mcpVerified: false,
    authSetupDone: false,
    timestamp: new Date().toISOString(),
    loginMechanism: null,
    loginFieldHints: [],
    passwordFieldHints: [],
    submitButtonHints: [],
  };
}

// ─── UI helpers ───────────────────────────────────────────────────────────────

function hr(char = '─', width = 62): string {
  return char.repeat(width);
}

function banner(): void {
  process.stdout.write('\n');
  process.stdout.write('╔══════════════════════════════════════════════════════════════╗\n');
  process.stdout.write('║  QA Playwright Kit — Setup Wizard                            ║\n');
  process.stdout.write('║  Setup awal testing otomatis (Hermes Agent)                  ║\n');
  process.stdout.write('╚══════════════════════════════════════════════════════════════╝\n\n');
  process.stdout.write('  Wizard ini menyiapkan project agar QA bisa menjalankan test\n');
  process.stdout.write('  dari file requirement — tanpa menulis TypeScript sendiri.\n\n');
  process.stdout.write('  Setelah setup, Hermes Agent menjalankan pipeline tes.\n');
  process.stdout.write('  Estimasi: sekitar 5–15 menit.\n\n');
}

function phaseHeader(num: number, title: string): void {
  process.stdout.write('\n' + hr() + '\n');
  process.stdout.write('  [' + num + '/' + TOTAL_PHASES + '] ' + title + '\n');
  process.stdout.write(hr() + '\n');
}

function isEncryptedEnv(filePath: string): boolean {
  if (!fs.existsSync(filePath)) return false;
  return fs.readFileSync(filePath, 'utf-8').includes('encrypted:');
}

function isValidUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

function parseHintList(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function runCmd(
  cmd: string,
  opts: { cwd?: string; env?: NodeJS.ProcessEnv; inheritStdio?: boolean } = {},
): { ok: boolean; output: string } {
  try {
    if (opts.inheritStdio) {
      execSync(cmd, {
        cwd: opts.cwd ?? ROOT,
        stdio: 'inherit',
        encoding: 'utf-8',
        env: opts.env ? { ...process.env, ...opts.env } : process.env,
      });
      return { ok: true, output: '' };
    }
    const out = execSync(cmd, {
      cwd: opts.cwd ?? ROOT,
      stdio: 'pipe',
      encoding: 'utf-8',
      env: opts.env ? { ...process.env, ...opts.env } : process.env,
    });
    return { ok: true, output: String(out ?? '') };
  } catch (err: unknown) {
    const e = err as Error & { stderr?: string; stdout?: string; status?: number };
    if (opts.inheritStdio) {
      return { ok: false, output: e.message ?? String(err) };
    }
    const msg = e.stderr ?? e.stdout ?? e.message ?? String(err);
    return { ok: false, output: msg };
  }
}

function fileExistsAndNonEmpty(p: string): boolean {
  return fs.existsSync(p) && fs.statSync(p).size > 0;
}

interface OSInfo {
  platform: 'linux' | 'macos' | 'windows' | 'unknown';
  isRoot: boolean;
  needsSudo: boolean;
  shellName: string;
}

function detectOS(): OSInfo {
  const p = process.platform;
  let platform: OSInfo['platform'] = 'unknown';
  if (p === 'win32') platform = 'windows';
  else if (p === 'darwin') platform = 'macos';
  else if (p === 'linux') platform = 'linux';

  let isRoot = false;
  try {
    if (typeof process.getuid === 'function') {
      isRoot = (process.getuid as () => number)() === 0;
    }
  } catch {
    isRoot = false;
  }

  const needsSudo = platform !== 'windows' && !isRoot;
  const shellName = platform === 'windows' ? 'PowerShell/CMD' : 'bash/zsh';

  return { platform, isRoot, needsSudo, shellName };
}

/**
 * Upsert KEY=value into environments/{envName}.env (active wizard APP_ENV profile).
 */
function writeEnvSection(
  envName: string,
  values: Record<string, string>,
  sectionComment?: string,
): void {
  if (FLAGS.dryRun) {
    process.stdout.write(
      `\n  [dry-run] skip env write → environments/${envName || 'local'}.env: ` +
        Object.keys(values).join(', ') +
        '\n',
    );
    return;
  }
  const file = ensureEnvFile(envName);
  let content = fs.existsSync(file) ? fs.readFileSync(file, 'utf-8') : '';
  if (sectionComment) content += '\n# ' + sectionComment + '\n';
  for (const [key, val] of Object.entries(values)) {
    if (/[\r\n]/.test(val)) {
      throw new Error(`Nilai ${key} mengandung baris baru — password/value harus satu baris.`);
    }
    const encoded = encodeEnvValue(val);
    const regex = new RegExp('^' + key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '=.*$', 'm');
    const line = key + '=' + encoded;
    if (regex.test(content)) {
      content = content.replace(regex, line);
    } else {
      content += line + '\n';
    }
  }
  fs.writeFileSync(file, content, 'utf-8');
}

// ─── Phase 0: Welcome + Pre-flight ───────────────────────────────────────────

async function phase0(_state: WizardState): Promise<boolean> {
  phaseHeader(0, 'Welcome + Pre-flight Check');
  process.stdout.write('\n  Mengecek prasyarat...\n\n');
  let allOk = true;

  // Node.js version
  const nodeMajor = parseInt(process.versions.node.split('.')[0], 10);
  if (nodeMajor >= 20) {
    printOk('Node.js ' + process.versions.node + ' (>= 20.19.0 required)');
  } else {
    printError({
      title: 'Node.js terlalu lama: ' + process.versions.node,
      detail: 'Versi Node.js harus >= 20.19.0',
      hint: 'Install Node.js >= 20.19.0 dari https://nodejs.org/',
      exitCode: EXIT.FIXABLE,
    });
    allOk = false;
  }

  // Git
  if (runCmd('git --version').ok) {
    printOk('Git tersedia');
  } else {
    printWarn('Git tidak ditemukan — tidak wajib tapi disarankan');
  }

  // Active env profile file (may still be local until Phase 1)
  const probeEnv = _state.envName || 'local';
  const probeFile = envFilePath(probeEnv);
  if (fs.existsSync(probeFile) && isEncryptedEnv(probeFile)) {
    const keyPaths = [
      path.join(ENV_DIR, '.env.keys'),
      path.join(ROOT, '.env.keys'),
      path.join(
        process.env.HOME ?? process.env.USERPROFILE ?? '',
        '.dotenvx-keys',
        resolveProjectName(ROOT),
        '.env.keys',
      ),
    ];
    const hasKey = keyPaths.some((k) => fs.existsSync(k));
    if (!hasKey) {
      printWarn(`environments/${probeEnv}.env ada tapi terenkripsi dan kunci tidak ditemukan.`);
      const { overwrite } = await prompts({
        type: 'confirm',
        name: 'overwrite',
        message: 'Timpa dengan konfigurasi baru? (data lama akan hilang)',
        initial: false,
      });
      if (overwrite) {
        fs.unlinkSync(probeFile);
        printInfo('File lama dihapus. Akan dibuat ulang.');
      } else {
        printInfo('Lanjut tanpa menimpa.');
      }
    } else {
      printOk(`environments/${probeEnv}.env terenkripsi dan kunci tersedia`);
    }
  } else if (fs.existsSync(probeFile)) {
    printOk(`environments/${probeEnv}.env sudah ada`);
  } else {
    printInfo(`environments/{nama-target}.env belum ada — dibuat di Phase 1 (pilih target + URL)`);
  }

  // node_modules
  if (fs.existsSync(path.join(ROOT, 'node_modules', '@playwright', 'test'))) {
    printOk('node_modules sudah terinstall');
  } else {
    printInfo('node_modules belum ada — akan diinstall di Phase 3');
  }

  // tools/mcp/dist
  if (fileExistsAndNonEmpty(path.join(ROOT, 'tools', 'mcp', 'dist', 'index-mcp.js'))) {
    printOk('tools/mcp/dist sudah di-build');
  } else {
    printInfo('tools/mcp/dist belum ada — akan di-build di Phase 3');
  }

  if (!allOk) {
    process.stdout.write(
      '\n  Ada prasyarat yang tidak terpenuhi. Perbaiki dulu sebelum lanjut.\n\n',
    );
    return false;
  }
  process.stdout.write('\n');
  return true;
}

// ─── Phase 1: Project + Environment ───────────────────────────────────────────

async function phase1(state: WizardState): Promise<void> {
  phaseHeader(1, 'Project & target testing');
  process.stdout.write('\n  Kita tentukan dulu: project ini, server mana yang ditest,\n');
  process.stdout.write('  dan alamat website (URL) untuk server itu.\n\n');
  process.stdout.write('  Catatan: tiap target (local/dev/staging) punya URL sendiri.\n');
  process.stdout.write('  Jangan pakai satu URL untuk semua target.\n\n');

  const nameAns = await prompts({
    type: 'text',
    name: 'projectName',
    message: 'Nama project (muncul di laporan):',
    initial: state.projectName || 'my-app-testing',
    validate: (v: string) => v.trim().length > 0 || 'Nama project tidak boleh kosong',
  });
  if (!nameAns.projectName) {
    printWarn('Dibatalkan.');
    return;
  }

  const envAns = await prompts({
    type: 'select',
    name: 'envName',
    message: 'Server / target mana yang mau disiapkan sekarang?',
    choices: [
      { title: 'local — di komputer sendiri (localhost)', value: 'local' },
      { title: 'dev — server development', value: 'dev' },
      { title: 'staging — server staging / QA', value: 'staging' },
      { title: 'production — hati-hati (hanya akun QA)', value: 'production' },
    ],
    initial: Math.max(
      0,
      ['local', 'dev', 'staging', 'production'].indexOf(state.envName || 'local'),
    ),
  });
  if (!envAns.envName) {
    printWarn('Dibatalkan.');
    return;
  }

  const envName = String(envAns.envName);
  // If env changed since last run, don't keep old BASE_URL as initial
  const urlInitial =
    state.envName === envName && state.baseUrl ? state.baseUrl : suggestedBaseUrl(envName);
  const urlAns = await prompts({
    type: 'text',
    name: 'baseUrl',
    message: `Alamat website (URL) untuk target "${envName}":`,
    initial: urlInitial,
    validate: (v: string) =>
      isValidUrl(v.trim()) ||
      'URL tidak valid. Contoh: https://staging.myapp.com atau http://localhost:3000',
  });
  if (!urlAns.baseUrl) {
    printWarn('Dibatalkan.');
    return;
  }

  state.projectName = String(nameAns.projectName).trim();
  state.envName = envName;
  state.baseUrl = String(urlAns.baseUrl).trim().replace(/\/$/, '');

  writeEnvSection(
    state.envName,
    {
      BASE_URL: state.baseUrl,
      PLAYWRIGHT_CONFIG: 'playwright.config.ts',
      HEADLESS: 'true',
      SLOW_MO: '0',
    },
    `QA Playwright Kit — environments/${state.envName}.env`,
  );

  // Pin active env for local sessions
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { writeActiveEnvPin, isKnownAppEnv } = require('../../src/utils/app-env') as {
      writeActiveEnvPin: (root: string, env: string) => string;
      isKnownAppEnv: (v: string) => boolean;
    };
    if (isKnownAppEnv(state.envName)) {
      writeActiveEnvPin(process.cwd(), state.envName);
      printInfo(
        `Target aktif diset ke "${state.envName}" (disimpan agar session berikutnya tetap pakai target ini).`,
      );
    }
  } catch {
    // non-fatal
  }

  printOk(`Tersimpan: URL + pengaturan → environments/${state.envName}.env`);
  printInfo(`Ganti target nanti: npm run env:use -- <nama>  lalu  npm run env:edit`);
  markPhase(state, 1);
}

// ─── Phase 2: Kredensial ─────────────────────────────────────────────────────

async function phase2(state: WizardState): Promise<void> {
  phaseHeader(2, 'Akun login untuk testing');
  const envLabel = state.envName || 'local';
  process.stdout.write(`\n  Disimpan ke: environments/${envLabel}.env  (target: ${envLabel})\n`);
  process.stdout.write('  Isi akun yang sudah ada di aplikasi (bukan invent akun baru).\n\n');
  process.stdout.write('  Aturan isi:\n');
  process.stdout.write('  • Password wajib.\n');
  process.stdout.write('  • Minimal satu identitas: email, username, atau nomor telepon.\n');
  process.stdout.write(
    '  • Boleh diisi semua; sistem memilih urutan: email → username → telepon\n',
  );
  process.stdout.write('    (kecuali kamu pilih preferensi manual).\n');
  process.stdout.write('  • Setelah setup, nilai dienkripsi. Ubah nanti: npm run env:edit\n\n');

  const { multiRole } = await prompts({
    type: 'confirm',
    name: 'multiRole',
    message: 'Apakah perlu lebih dari satu jenis akun (mis. admin + finance)?',
    initial: false,
  });
  if (multiRole === undefined) {
    printWarn('Dibatalkan.');
    return;
  }

  async function promptIdentity(label: string): Promise<{
    email: string;
    username: string;
    phone: string;
    password: string;
    loginIdPref: string;
  } | null> {
    // Step 1: tanya identifier dulu (satu field yang dipakai untuk login)
    process.stdout.write(`\n  [${label}] Isi identifier yang dipakai untuk login:\n`);
    process.stdout.write('  (Email, username, atau nomor telepon — isi salah satu saja)\n\n');
    const idAns = await prompts([
      {
        type: 'text',
        name: 'email',
        message: `[${label}] Email (Enter untuk lewati):`,
      },
      {
        type: 'text',
        name: 'username',
        message: `[${label}] Username (Enter untuk lewati):`,
      },
      {
        type: 'text',
        name: 'phone',
        message: `[${label}] Nomor telepon (Enter untuk lewati):`,
      },
    ]);
    const email = String(idAns.email ?? '').trim();
    const username = String(idAns.username ?? '').trim();
    const phone = String(idAns.phone ?? '').trim();
    if (!email && !username && !phone) {
      printWarn('Isi minimal satu: email, username, atau nomor telepon.');
      return null;
    }

    // Step 2: password
    const pwAns = await prompts({
      type: 'password',
      name: 'password',
      message: `[${label}] Password:`,
      validate: (v: string) => v.length > 0 || 'Password wajib diisi',
    });
    if (!pwAns.password) return null;

    // Auto-derive loginIdPref: jika hanya satu field yang diisi, pakai itu.
    // Jika lebih dari satu, tanya pilihan ringkas.
    let loginIdPref: string;
    const filledCount = [email, username, phone].filter(Boolean).length;
    if (filledCount === 1) {
      loginIdPref = email ? 'email' : username ? 'username' : 'phone';
      printInfo(`Kolom login akan menggunakan: ${loginIdPref}`);
    } else {
      const prefAns = await prompts({
        type: 'select',
        name: 'loginIdPref',
        message: `[${label}] Kolom login yang mau diisi pertama kali:`,
        choices: [
          ...(email ? [{ title: `Email (${email})`, value: 'email' }] : []),
          ...(username ? [{ title: `Username (${username})`, value: 'username' }] : []),
          ...(phone ? [{ title: `Nomor telepon (${phone})`, value: 'phone' }] : []),
          { title: 'Otomatis (coba email → username → telepon)', value: 'auto' },
        ],
        initial: 0,
      });
      loginIdPref = String(prefAns.loginIdPref ?? 'auto');
    }

    return {
      password: String(pwAns.password),
      email,
      username,
      phone,
      loginIdPref,
    };
  }

  const collected: WizardRoleInput[] = [];

  if (!multiRole) {
    const c = await promptIdentity('user');
    if (!c) {
      printWarn('Dibatalkan.');
      return;
    }
    collected.push({
      name: 'user',
      fields: {
        password: c.password,
        email: c.email || undefined,
        username: c.username || undefined,
        phone: c.phone || undefined,
        loginIdPref: c.loginIdPref,
      },
    });
  } else {
    let addMore = true;
    let idx = 0;
    while (addMore) {
      idx++;
      process.stdout.write('\n  -- Akun ke-' + idx + ' ' + '─'.repeat(48) + '\n');
      const r = await prompts({
        type: 'text',
        name: 'roleName',
        message: 'Nama jenis akun (contoh: user, finance, super-admin):',
        validate: (v: string) => {
          const n = v.trim().toLowerCase();
          if (n === 'general') {
            return 'Jangan pakai "general". Untuk akun default tulis "user".';
          }
          if (n === 'default') return 'Tulis "user" (bukan "default").';
          return (
            isValidRoleName(n) || 'Hanya huruf kecil, angka, dan tanda hubung (contoh: super-admin)'
          );
        },
      });
      if (!r.roleName) break;
      const id = await promptIdentity(canonicalRoleName(String(r.roleName)));
      if (!id) {
        printWarn('Akun ini dibatalkan.');
        break;
      }
      collected.push({
        name: String(r.roleName),
        fields: {
          password: id.password,
          email: id.email || undefined,
          username: id.username || undefined,
          phone: id.phone || undefined,
          loginIdPref: id.loginIdPref,
        },
      });
      const { more } = await prompts({
        type: 'confirm',
        name: 'more',
        message: 'Tambah jenis akun lagi?',
        initial: false,
      });
      addMore = !!more;
    }
  }

  if (collected.length === 0) {
    printWarn('Belum ada akun yang disimpan.');
    return;
  }

  // Multi N=1 / missing user bridge — single normalize call
  let mirrorToUser: boolean | undefined;
  let mirrorFromRole: string | undefined;

  const hasUser = collected.some((r) => canonicalRoleName(r.name) === 'user');
  const only = collected.length === 1 ? canonicalRoleName(collected[0].name) : null;

  if (only && only !== 'user') {
    const { mirror } = await prompts({
      type: 'confirm',
      name: 'mirror',
      message: `Hanya ada akun "${only}". Salin juga ke akun default "user" agar login biasa / mode general tetap jalan?`,
      initial: true,
    });
    mirrorToUser = !!mirror;
  } else if (collected.length >= 2 && !hasUser) {
    const { mirror } = await prompts({
      type: 'confirm',
      name: 'mirror',
      message:
        'Belum ada akun default "user". Salin dari akun pertama agar login biasa tetap jalan?',
      initial: true,
    });
    mirrorToUser = !!mirror;
    if (mirrorToUser) {
      mirrorFromRole = canonicalRoleName(collected[0].name);
    }
  }

  const finalNorm = normalizeWizardRoles(collected, {
    mirrorToUser,
    mirrorFromRole,
    appEnv: state.envName || 'local',
  });

  writeEnvSection(state.envName || 'local', finalNorm.envUpserts, 'Kredensial QA / per role');
  for (const w of finalNorm.warnings) printWarn(w);

  state.roles = finalNorm.roles.map((r) => ({
    name: r.name,
    authFile: r.authFile,
  }));
  printOk(
    `Akun tersimpan di environments/${state.envName || 'local'}.env (${state.roles.map((r) => r.name).join(', ')})`,
  );
  markPhase(state, 2);
}

// ─── Phase 3: Install ─────────────────────────────────────────────────────────

async function phase3(state: WizardState): Promise<boolean> {
  phaseHeader(3, 'Install package, browser & tools');

  process.stdout.write('\n  Langkah ini mengunduh file dari internet.\n');
  process.stdout.write('  Pastikan koneksi internet stabil (bisa 5–15 menit total).\n');
  process.stdout.write('  Yang diunduh: package npm & browser Chromium (~150MB).\n');
  process.stdout.write('  Build tools MCP biasanya lokal (jarang unduhan besar).\n\n');

  // Step 1: npm install
  const hasModules = fs.existsSync(path.join(ROOT, 'node_modules', '@playwright', 'test'));
  if (hasModules) {
    printOk('Package project sudah terpasang — lewati npm install');
  } else {
    process.stdout.write('\n  1/3  npm install — unduh package project\n');
    process.stdout.write('  Estimasi 1–3 menit. Jangan putus internet.\n');
    const r = runCmd('npm install');
    if (r.ok) {
      printOk('npm install selesai');
    } else {
      printError({
        title: 'npm install gagal',
        detail: r.output.split('\n')[0],
        hint: 'Cek koneksi internet, lalu jalankan lagi: npm run setup:wizard -- --from-phase=3',
        exitCode: EXIT.FIXABLE,
      });
      return false;
    }
  }

  // Step 2: playwright install chromium
  process.stdout.write('\n  2/3  Unduh browser Chromium untuk testing\n');
  process.stdout.write('  Ukuran ~150MB — butuh internet lancar (bisa 2–5 menit).\n');

  // OS detection + sudo hint
  const osInfo = detectOS();
  if (osInfo.platform === 'unknown') {
    printWarn('OS tidak dikenali — lanjut dengan default.');
  } else {
    process.stdout.write(
      '\n  Terdeteksi OS: ' + osInfo.platform + ' (shell: ' + osInfo.shellName + ')\n',
    );
    if (osInfo.needsSudo) {
      printWarn('Install library sistem butuh akses admin (sudo).');
      printWarn('Kamu mungkin diminta password sudo.');
      if (!FLAGS.dryRun) {
        const { useSudo } = await prompts({
          type: 'select',
          name: 'useSudo',
          message: 'Cara install browser:',
          choices: [
            { title: 'Pakai sudo (disarankan)', value: 'sudo' },
            { title: 'Tanpa sudo (browser saja, library sistem manual)', value: 'nosudo' },
          ],
        });
        if (useSudo === 'sudo') {
          printInfo('Menggunakan sudo. Masukkan password jika diminta.');
        } else {
          printInfo('Tanpa system deps. Browser terpasang, tapi mungkin perlu library manual.');
        }
      }
    } else if (osInfo.platform === 'windows') {
      printInfo('Windows: jika gagal, coba buka terminal sebagai Administrator.');
    } else {
      printOk('Berjalan sebagai admin — tidak butuh sudo');
    }
  }

  if (FLAGS.dryRun) {
    printInfo('[dry-run] skip actual playwright install');
  } else {
    const pwCmd = osInfo.needsSudo
      ? 'sudo npx playwright install --with-deps chromium'
      : 'npx playwright install --with-deps chromium';
    const pw = runCmd(pwCmd);
    if (pw.ok) {
      printOk('Browser Chromium siap');
    } else {
      printWarn('Install browser gagal atau sebagian: ' + pw.output.split('\n')[0]);
      printWarn('Cek internet / coba lagi: npx playwright install chromium');
    }
  }

  // Step 3: mcp:build — WAJIB (local compile, biasanya tanpa unduhan besar)
  process.stdout.write('\n  3/3  Build tools MCP (dipakai Hermes nanti)\n');
  process.stdout.write('  Ini compile lokal — biasanya cepat, jarang butuh unduhan besar.\n');
  process.stdout.write('  Hasilnya: Hermes bisa baca requirement & laporan test.\n');
  const mcp = runCmd('npm run mcp:build');
  if (mcp.ok) {
    printOk('Build MCP selesai (mcp-server/dist siap)');
  } else {
    const errLine =
      mcp.output.split('\n').find((l: string) => l.toLowerCase().includes('error')) ??
      mcp.output.split('\n')[0];
    printError({
      title: 'Build MCP gagal',
      detail: errLine,
      hint: 'Coba: npm run mcp:build. Jika berulang, hubungi maintainer framework.',
      exitCode: EXIT.ESCALATE,
    });
    const { cont } = await prompts({
      type: 'confirm',
      name: 'cont',
      message: 'Lanjut meski build MCP gagal? (tools di Hermes belum siap)',
      initial: false,
    });
    if (!cont) return false;
  }

  markPhase(state, 3);
  return true;
}

// ─── Phase 4: Hermes + MCP Setup ──────────────────────────────────────────────

async function phase4(state: WizardState): Promise<void> {
  phaseHeader(4, 'Cek Hermes & koneksi tools');

  process.stdout.write('\n  Bedanya dengan langkah install tadi:\n');
  process.stdout.write('  • Phase 3 = tools MCP sudah di-build di folder project (file siap).\n');
  process.stdout.write('  • Phase 4 = cek file config + minta kamu pastikan Hermes\n');
  process.stdout.write('    benar-benar terhubung ke tools itu (wizard tidak bisa klik\n');
  process.stdout.write('    tombol di dalam aplikasi Hermes).\n\n');

  // Auto-check what we can verify without Hermes UI
  let filesOk = true;
  const mcpJson = path.join(ROOT, '.mcp.json');
  if (fs.existsSync(mcpJson)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(mcpJson, 'utf-8')) as {
        servers?: unknown[];
        mcpServers?: Record<string, unknown>;
      };
      // Support both shapes: { servers: [] } and { mcpServers: { name: {...} } }
      const serverCount =
        parsed.servers?.length ?? (parsed.mcpServers ? Object.keys(parsed.mcpServers).length : 0);
      if (serverCount >= 3) {
        printOk(`Config tools (.mcp.json) OK — ${serverCount} server terdaftar`);
      } else if (serverCount > 0) {
        printWarn(`.mcp.json ada tapi hanya ${serverCount} server (biasanya 3)`);
        filesOk = false;
      } else {
        printWarn('.mcp.json ada tapi daftar server kosong / format tidak dikenali');
        filesOk = false;
      }
    } catch {
      printWarn('.mcp.json tidak valid JSON');
      filesOk = false;
    }
  } else {
    printError({
      title: '.mcp.json tidak ditemukan',
      detail: 'File config tools seharusnya ada di root project.',
      hint: 'Restore dari git, atau: npm run mcp:config',
      exitCode: EXIT.ESCALATE,
    });
    filesOk = false;
  }

  const mcpDist = path.join(ROOT, 'tools', 'mcp', 'dist', 'index-mcp.js');
  if (fileExistsAndNonEmpty(mcpDist)) {
    printOk('Build MCP dari Phase 3 terdeteksi (tools/mcp/dist siap)');
  } else {
    printWarn('Build MCP belum ada — jalankan: npm run mcp:build');
    filesOk = false;
  }

  // Optional: health check for more signal
  process.stdout.write('\n  Menjalankan health check singkat...\n');
  const hc = runCmd('npx tsx scripts/health-check-cli.ts');
  if (hc.ok) {
    printOk('Health check CLI selesai (lihat ringkas di bawah bila ada peringatan)');
  } else {
    printWarn('Health check ada keluhan — cek output di bawah');
  }
  hc.output
    .split('\n')
    .filter((l: string) => l.trim())
    .slice(0, 12)
    .forEach((l: string) => process.stdout.write('    ' + l.trim() + '\n'));

  process.stdout.write('\n  Yang perlu kamu cek di aplikasi Hermes (1 menit):\n\n');
  process.stdout.write('  1. Buka Hermes di folder project ini.\n');
  process.stdout.write('  2. Lihat status MCP / tools: idealnya 3 server Connected.\n');
  process.stdout.write('  3. Jika belum: Reload MCP Servers, tunggu Connected.\n');
  process.stdout.write('     Docs: https://hermes-agent.nousresearch.com/docs\n\n');

  if (!filesOk) {
    printWarn('File project belum lengkap — perbaiki dulu sebelum mengandalkan Hermes.');
  }

  const { verified } = await prompts({
    type: 'select',
    name: 'verified',
    message: 'Di Hermes, status tools MCP sekarang?',
    choices: [
      { title: 'Sudah Connected (3 server) — lanjut', value: 'yes' },
      { title: 'Belum sempat cek / skip dulu (bisa cek nanti)', value: 'skip' },
      { title: 'Ada error — tampilkan cara perbaiki', value: 'error' },
    ],
  });

  if (verified === 'error') {
    process.stdout.write('\n  Cara perbaiki jika Hermes belum connect:\n\n');
    process.stdout.write('  1. Build ulang tools: npm run mcp:build\n');
    process.stdout.write('  2. Cek kesehatan: npm run health:check\n');
    process.stdout.write('  3. Di Hermes: Reload MCP Servers\n');
    process.stdout.write('  4. Masih gagal: npm run mcp:config lalu restart Hermes\n\n');
  } else if (verified === 'yes') {
    printOk('Catatan: tools di Hermes dilaporkan Connected');
  } else {
    printInfo('Dilewati. Sebelum pipeline, pastikan MCP Connected di Hermes.');
  }

  state.mcpVerified = verified === 'yes';
  markPhase(state, 4);
}

// ─── Phase 5: Auth Setup ──────────────────────────────────────────────────────

async function phase5(state: WizardState): Promise<void> {
  phaseHeader(5, 'Simpan sesi login (auth)');

  const envLabel = state.envName || 'local';
  process.stdout.write(`\n  Tujuan: simpan sesi login ke folder .auth/${envLabel}/\n`);
  process.stdout.write('  supaya test berikutnya tidak perlu ketik login berulang.\n\n');
  process.stdout.write('  Pilih cara login aplikasi kamu:\n');
  process.stdout.write('  • Form biasa — ada kolom user/email + password + tombol Login.\n');
  process.stdout.write('    Nanti browser dibuka dan diisi pakai akun dari Phase 2.\n');
  process.stdout.write('  • SSO — login lewat Google/Microsoft/dll (wizard belum otomatis).\n');
  process.stdout.write('  • Tanpa login — semua halaman publik.\n\n');

  const { mechanism } = await prompts({
    type: 'select',
    name: 'mechanism',
    message: 'Bagaimana cara login di aplikasi ini?',
    choices: [
      {
        title: 'Form biasa (user/email + password) — disarankan, wizard bantu isi',
        value: 'form',
      },
      {
        title: 'SSO / OAuth (Google, Microsoft, dsb.) — belum otomatis di wizard',
        value: 'sso',
      },
      { title: 'Tidak ada login (semua halaman publik)', value: 'none' },
    ],
  });

  if (mechanism === undefined) {
    printWarn('Dibatalkan.');
    return;
  }

  state.loginMechanism = mechanism as LoginMechanism;

  if (mechanism === 'none') {
    printInfo('Tanpa login. Test berjalan tanpa sesi tersimpan.');
    state.authSetupDone = true;
    markPhase(state, 5);
    return;
  }

  if (mechanism === 'sso') {
    const base = state.baseUrl || 'https://your-app.example.com';
    const loginPath = state.loginUrl || '/login';
    process.stdout.write('\n  SSO belum siap diotomatisasi wizard.\n');
    process.stdout.write('  Setup akun/file env tetap jalan; sesi login SSO\n');
    process.stdout.write('  perlu dibantu Hermes setelah wizard selesai.\n');
    process.stdout.write('  Jika SSO minta OTP/CAPTCHA, set lewat env:edit:\n');
    process.stdout.write('    AUTH_CHALLENGE_MODE=otp-browser | captcha-browser\n\n');
    process.stdout.write('  Salin prompt ini ke Hermes:\n');
    process.stdout.write('  ' + hr('-', 60) + '\n');
    const ssoPrompt = [
      `Tolong buatkan / perbaiki src/support/auth.setup.ts untuk login SSO/OAuth.`,
      `BASE_URL=${base}, path login ${loginPath}, APP_ENV=${envLabel}.`,
      `Simpan storage state ke .auth/${envLabel}/user.json (dan role lain bila ada).`,
      `Pakai handlePostLoginChallenge dari src/support/human-challenge.ts setelah login.`,
      `Jelaskan langkah manual sekali (klik provider, OTP/CAPTCHA, izin) lalu cara re-run:`,
      `npm run auth:setup:headed`,
    ].join(' ');
    for (const line of ssoPrompt.match(/.{1,58}/g) ?? [ssoPrompt]) {
      process.stdout.write('  ' + line + '\n');
    }
    process.stdout.write('  ' + hr('-', 60) + '\n\n');
    printInfo('Lanjut wizard tanpa sesi SSO. Jalankan prompt di atas setelah setup.');
    state.authSetupDone = false;
    markPhase(state, 5);
    return;
  }

  // Form login
  process.stdout.write('\n  Form biasa: nanti browser dibuka, diisi akun dari Phase 2\n');
  process.stdout.write('  (password + email/username/telepon yang sudah kamu masukkan),\n');
  process.stdout.write('  lalu sesi disimpan. Kamu tidak perlu mengisi ulang di sini.\n\n');

  const loginInfo = await prompts([
    {
      type: 'text',
      name: 'loginUrl',
      message: 'Path halaman login (contoh: /login):',
      initial: state.loginUrl ?? '/login',
      validate: (v: string) => v.startsWith('/') || 'Harus diawali /  contoh: /login',
    },
    {
      type: 'text',
      name: 'successUrlPath',
      message: 'Path setelah login berhasil (contoh: /dashboard):',
      initial: state.successUrlPath ?? '/dashboard',
      validate: (v: string) => v.startsWith('/') || 'Harus diawali /  contoh: /dashboard',
    },
  ]);

  if (!loginInfo.successUrlPath) {
    printWarn('Dibatalkan.');
    return;
  }

  state.loginUrl = loginInfo.loginUrl;
  state.successUrlPath = loginInfo.successUrlPath;

  // Optional field hints — membantu Generator live-verify selector form login.
  // Digabung jadi satu konfirmasi; hanya tanya detail jika user mau.
  process.stdout.write('\n  Opsional: beri petunjuk teks label form login supaya generator\n');
  process.stdout.write('  bisa temukan kolom yang tepat (berguna jika form punya label unik).\n');
  process.stdout.write('  Sebagian besar kasus tidak perlu — cukup Enter untuk lewati.\n\n');

  const { wantHints } = await prompts({
    type: 'confirm',
    name: 'wantHints',
    message: 'Isi petunjuk label form login? (Enter = Tidak, lewati saja)',
    initial: false,
  });

  let loginFieldHints: string[] = [];
  let passwordFieldHints: string[] = [];
  let submitButtonHints: string[] = [];

  if (wantHints) {
    const hintAnswers = await prompts([
      {
        type: 'text',
        name: 'loginFieldHints',
        message: 'Teks label kolom login/email/username (pisah koma, kosong = auto):',
        initial: '',
      },
      {
        type: 'text',
        name: 'passwordFieldHints',
        message: 'Teks label kolom password (pisah koma, kosong = auto):',
        initial: '',
      },
      {
        type: 'text',
        name: 'submitButtonHints',
        message: 'Teks tombol login/masuk (pisah koma, kosong = auto):',
        initial: '',
      },
    ]);
    loginFieldHints = parseHintList(hintAnswers.loginFieldHints);
    passwordFieldHints = parseHintList(hintAnswers.passwordFieldHints);
    submitButtonHints = parseHintList(hintAnswers.submitButtonHints);
  }

  state.loginFieldHints = loginFieldHints;
  state.passwordFieldHints = passwordFieldHints;
  state.submitButtonHints = submitButtonHints;

  // Langkah tambahan setelah password (OTP / CAPTCHA) — human challenge
  process.stdout.write('\n  Beberapa aplikasi minta OTP atau CAPTCHA setelah password.\n');
  process.stdout.write(
    '  Framework bisa bantu (assisted) saat simpan sesi — bukan full auto di CI.\n\n',
  );

  const { extraStep } = await prompts({
    type: 'select',
    name: 'extraStep',
    message: 'Setelah password, apakah ada langkah tambahan?',
    choices: [
      { title: 'Tidak (langsung masuk dashboard)', value: 'none' },
      {
        title: 'OTP / kode verifikasi — isi di browser (disarankan)',
        value: 'otp-browser',
      },
      {
        title: 'OTP / kode verifikasi — ketik di terminal (boleh tanpa UI browser)',
        value: 'otp-stdin',
      },
      {
        title: 'CAPTCHA / "bukan robot" — selesaikan di browser (terminal tidak bisa)',
        value: 'captcha-browser',
      },
      {
        title: 'Auto deteksi (OTP: browser dulu, fallback terminal; CAPTCHA: browser)',
        value: 'auto',
      },
    ],
    initial: 0,
  });
  if (extraStep === undefined) {
    printWarn('Dibatalkan.');
    return;
  }

  const challengeMode = String(extraStep || 'none');
  // Lazy require to avoid circular weight in wizard cold path
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { challengeModeEnvUpserts } = require('../../src/support/human-challenge') as {
    challengeModeEnvUpserts: (
      mode: string,
      current?: { headless?: string; slowMo?: string },
    ) => Record<string, string>;
  };

  let otpInputSel = '';
  let otpSubmitSel = '';
  if (
    challengeMode === 'otp-browser' ||
    challengeMode === 'otp-stdin' ||
    challengeMode === 'auto'
  ) {
    const { advanced } = await prompts({
      type: 'confirm',
      name: 'advanced',
      message: 'Atur lokasi kolom OTP secara manual? (biasanya tidak perlu, Enter untuk lewati)',
      initial: false,
    });
    if (advanced) {
      process.stdout.write('\n  Petunjuk: lihat kode sumber halaman OTP di browser,\n');
      process.stdout.write('  cari <input> untuk kode OTP dan tombol submit-nya.\n');
      process.stdout.write('  Contoh: input[name="otp"] atau button[type="submit"]\n\n');
      const selAns = await prompts([
        {
          type: 'text',
          name: 'otpInput',
          message: 'Penanda kolom kode OTP (contoh: input[name="otp"], kosong = auto):',
          initial: '',
        },
        {
          type: 'text',
          name: 'otpSubmit',
          message: 'Penanda tombol verifikasi OTP (contoh: button[type="submit"], kosong = auto):',
          initial: '',
        },
      ]);
      otpInputSel = String(selAns.otpInput ?? '').trim();
      otpSubmitSel = String(selAns.otpSubmit ?? '').trim();
    }
  }

  const envUpserts = challengeModeEnvUpserts(challengeMode as 'none', {
    headless: 'true',
    slowMo: '0',
  });
  writeEnvSection(
    state.envName || 'local',
    {
      ...envUpserts,
      AUTH_CHALLENGE_TIMEOUT_MS: '180000',
      ...(otpInputSel ? { AUTH_OTP_INPUT_SELECTOR: otpInputSel } : {}),
      ...(otpSubmitSel ? { AUTH_OTP_SUBMIT_SELECTOR: otpSubmitSel } : {}),
      AUTH_LOGIN_URL_PATH: String(loginInfo.loginUrl),
      AUTH_SUCCESS_URL_PATH: String(loginInfo.successUrlPath),
    },
    'Human challenge (OTP/CAPTCHA) + login paths',
  );
  printOk(
    `Langkah tambahan login: ${challengeMode}` +
      (envUpserts.HEADLESS === 'false' ? ' (browser terlihat)' : ''),
  );

  const appEnv = state.envName || 'local';
  const defaultAuth = `.auth/${appEnv}/user.json`;
  const roles =
    state.roles.length > 0
      ? state.roles.map((r) => ({
          name: r.name,
          // Prefer scoped path if role was stored legacy-unscoped
          authFile: r.authFile.includes(`/${appEnv}/`)
            ? r.authFile
            : r.authFile.startsWith('.auth/')
              ? `.auth/${appEnv}/${r.name === 'default' ? 'user' : r.name}.json`
              : r.authFile,
        }))
      : [{ name: 'user', authFile: defaultAuth }];

  // Keep state.roles aligned with scoped paths
  state.roles = roles;

  // Generate auth.setup.ts
  writeAuthSetup(
    { roles, loginUrl: loginInfo.loginUrl, successUrlPath: loginInfo.successUrlPath },
    AUTH_SETUP_OUT,
  );
  printOk('src/support/auth.setup.ts dibuat');

  // Pastikan .auth/{APP_ENV}/ dir ada
  const authDir = path.join(ROOT, '.auth', appEnv);
  if (!fs.existsSync(authDir)) fs.mkdirSync(authDir, { recursive: true });

  // Tanya apakah mau jalankan auth setup sekarang
  const needsHeaded =
    challengeMode === 'otp-browser' ||
    challengeMode === 'captcha-browser' ||
    challengeMode === 'auto';
  const runMsg = needsHeaded
    ? 'Jalankan login sekarang (browser terlihat) untuk menyimpan sesi?'
    : 'Jalankan login sekarang untuk menyimpan sesi?';
  const { runNow } = await prompts({
    type: 'confirm',
    name: 'runNow',
    message: runMsg,
    initial: true,
  });

  if (runNow) {
    if (challengeMode === 'otp-browser' || challengeMode === 'auto') {
      process.stdout.write(
        '\n  Siapkan HP/email untuk OTP. Browser akan dibuka; isi kode di halaman atau Resume Inspector.\n',
      );
    } else if (challengeMode === 'captcha-browser') {
      process.stdout.write(
        '\n  Selesaikan CAPTCHA di browser (terminal tidak bisa), lalu Resume di Inspector.\n',
      );
    } else if (challengeMode === 'otp-stdin') {
      process.stdout.write('\n  Siapkan kode OTP — akan diminta di terminal ini.\n');
    } else {
      process.stdout.write('\n  Membuka browser & menyimpan sesi login...\n');
    }

    // Ensure child process sees challenge env (file may still be plaintext pre Phase 6)
    const childEnv: NodeJS.ProcessEnv = {
      ...process.env,
      APP_ENV: appEnv,
      AUTH_CHALLENGE_MODE: challengeMode,
      ...(envUpserts.HEADLESS ? { HEADLESS: envUpserts.HEADLESS } : {}),
      ...(envUpserts.SLOW_MO ? { SLOW_MO: envUpserts.SLOW_MO } : {}),
    };
    if (needsHeaded) {
      childEnv.HEADLESS = 'false';
    }

    const headedFlag = needsHeaded ? ' --headed' : '';
    // Interactive OTP/CAPTCHA needs real TTY + console (not piped stdio)
    const interactiveAuth = challengeMode !== 'none';
    const result = runCmd(
      `npx playwright test src/support/auth.setup.ts --project=setup --workers=1 --reporter=line${headedFlag}`,
      { env: childEnv, inheritStdio: interactiveAuth },
    );
    if (result.ok || result.output.includes('passed')) {
      printOk('Login & simpan sesi berhasil');
      for (const role of roles) {
        if (fs.existsSync(path.join(ROOT, role.authFile))) {
          printOk(role.authFile + ' tersimpan');
        }
      }
      state.authSetupDone = true;
    } else {
      printWarn('Login / simpan sesi gagal atau sebagian.');
      printWarn(result.output.split('\n').slice(0, 3).join(' | '));
      process.stdout.write('\n  ─────────────────────────────────────────────────────────────\n');
      process.stdout.write('  Minta bantuan Hermes untuk memperbaiki form login.\n');
      process.stdout.write('  Salin prompt di bawah ini dan paste ke Hermes chat:\n\n');
      const hermesFix =
        'Tolong perbaiki src/support/auth.setup.ts — login gagal di ' +
        (state.baseUrl ?? '') +
        loginInfo.loginUrl +
        ' (AUTH_CHALLENGE_MODE=' +
        challengeMode +
        '). Buka halaman login dengan snapshot_page dulu.';
      process.stdout.write('  >>> ' + hermesFix + '\n');
      process.stdout.write('  ─────────────────────────────────────────────────────────────\n\n');
    }
  } else {
    printInfo(
      'Dilewati. Jalankan nanti: npm run auth:setup' +
        (needsHeaded ? '  atau  npm run auth:setup:headed' : ''),
    );
  }

  markPhase(state, 5);
}

// ─── Phase 6: Verify + Encrypt ────────────────────────────────────────────────

async function phase6(state: WizardState): Promise<void> {
  phaseHeader(6, 'Cek akhir & enkripsi');
  process.stdout.write('\n  Mengecek setup dan mengamankan file akun...\n\n');

  // setup:check
  const sc = runCmd('npx tsx setup-check.ts');
  if (sc.ok) {
    printOk('setup:check lulus');
  } else {
    const lines = sc.output
      .split('\n')
      .filter((l: string) => l.includes('FAIL') || l.includes('WARN') || l.includes('ERR'))
      .slice(0, 5);
    printWarn('setup:check ada peringatan:');
    lines.forEach((l: string) => process.stdout.write('    ' + l.trim() + '\n'));
  }

  // health:check
  const hc = runCmd('npx tsx scripts/health-check-cli.ts');
  const hcLines = hc.output.split('\n').slice(0, 20);
  hcLines.forEach((l: string) => {
    if (l.trim()) process.stdout.write('  ' + l.trim() + '\n');
  });

  process.stdout.write('\n');
  printInfo("Peringatan 'json_results belum ada' normal sebelum test pertama dijalankan.");

  // Encrypt active APP_ENV profile file
  const activeEnv = state.envName || 'local';
  const activeEnvFile = envFilePath(activeEnv);
  const relEnv = `environments/${activeEnv}.env`;
  if (fs.existsSync(activeEnvFile) && !isEncryptedEnv(activeEnvFile)) {
    process.stdout.write(`\n  Mengamankan (enkripsi) file akun di ${relEnv}...\n`);
    const enc = runCmd(`npx @dotenvx/dotenvx encrypt -f "${relEnv}"`);
    if (enc.ok) {
      printOk(`File akun diamankan: ${relEnv}`);
      printInfo('Kunci disimpan di: ~/.dotenvx-keys/qa-playwright-kit/');
      printInfo('Ubah akun nanti: npm run env:edit');
    } else {
      printWarn('Enkripsi gagal: ' + enc.output.split('\n')[0]);
      printWarn(`File masih teks biasa. Jangan commit ${relEnv} ke git.`);
    }
  } else if (isEncryptedEnv(activeEnvFile)) {
    printOk(`File akun sudah terenkripsi (${relEnv})`);
  } else {
    printWarn(`${relEnv} belum ada — enkripsi dilewati`);
  }

  markPhase(state, 6);
  process.stdout.write('\n  Status: SETUP SELESAI\n');
}

// ─── Phase 7: Pipeline Conductor ─────────────────────────────────────────────

const LOGIN_REQ_REL = 'requirements/login.md';
const LOGIN_REQ_ABS = path.join(ROOT, LOGIN_REQ_REL);

function phase7ReadinessSummary(state: WizardState): void {
  process.stdout.write('\n  Status setelah setup:\n\n');

  // Env profile (target aktif)
  const activeEnv = state.envName || 'local';
  const activeEnvFile = envFilePath(activeEnv);
  const relEnv = `environments/${activeEnv}.env`;
  if (fileExistsAndNonEmpty(activeEnvFile)) {
    if (isEncryptedEnv(activeEnvFile)) {
      printOk(`${relEnv} terenkripsi (target: ${activeEnv})`);
    } else {
      printWarn(`${relEnv} masih teks biasa (seharusnya terenkripsi di Phase 6)`);
    }
  } else {
    printWarn(`${relEnv} belum ada`);
  }

  // MCP dist
  const mcpDist = path.join(ROOT, 'tools', 'mcp', 'dist', 'index-mcp.js');
  if (fileExistsAndNonEmpty(mcpDist)) {
    printOk('tools/mcp/dist siap');
  } else {
    printWarn('tools/mcp/dist belum ada — jalankan: npm run mcp:build');
  }

  // Auth file
  if (state.roles.length > 0 && state.loginMechanism === 'form') {
    for (const role of state.roles) {
      const p = path.join(ROOT, role.authFile);
      if (fileExistsAndNonEmpty(p) && fs.statSync(p).size > 100) {
        printOk(`${role.authFile} tersimpan (${fs.statSync(p).size} bytes)`);
      } else {
        printWarn(
          `${role.authFile} kosong / tidak ada — login authenticated akan gagal sampai Phase 5 diulang`,
        );
      }
    }
  } else if (state.loginMechanism === 'sso') {
    printInfo('Login mechanism SSO — auth.setup.ts belum di-generate. Minta Hermes.');
  } else if (state.loginMechanism === 'none') {
    printInfo('Login mechanism: none — semua halaman publik');
  } else {
    printWarn('Login mechanism belum dipilih (Phase 5 dilewati)');
  }

  process.stdout.write('\n');
}

function phase7ScaffoldLoginRequirement(
  state: WizardState,
  absPath: string,
  relPath: string,
): 'written' | 'previewed' {
  const appEnv = state.envName || 'local';
  const scaffolderRoles: ScaffolderRole[] =
    state.roles.length > 0
      ? state.roles.map((r) => ({ name: r.name, authFile: r.authFile }))
      : [{ name: 'user', authFile: `.auth/${appEnv}/user.json` }];

  const mechanism: LoginMechanism = state.loginMechanism ?? 'form';

  const content = buildLoginRequirement({
    projectName: state.projectName || 'Target App',
    baseUrl: state.baseUrl || 'http://localhost:3000',
    loginUrl: state.loginUrl || '/login',
    successUrlPath: state.successUrlPath || '/dashboard',
    roles: scaffolderRoles,
    mechanism,
    loginFieldHints: state.loginFieldHints,
    passwordFieldHints: state.passwordFieldHints,
    submitButtonHints: state.submitButtonHints,
  });

  if (FLAGS.dryRun) {
    process.stdout.write(`\n  [dry-run] would write ${relPath} (${content.length} chars)\n`);
    return 'previewed';
  }

  if (fs.existsSync(absPath)) {
    process.stdout.write(`\n  File ${relPath} sudah ada. Backup ke .bak lalu tulis ulang.\n`);
    const bak = absPath + '.bak';
    fs.copyFileSync(absPath, bak);
    printInfo(`Backup: ${path.basename(bak)}`);
    fs.writeFileSync(absPath, content, 'utf-8');
    printOk(`${relPath} ditulis ulang`);
    return 'written';
  }

  fs.writeFileSync(absPath, content, 'utf-8');
  printOk(`${relPath} dibuat (${content.length} chars, Path A, no POM)`);
  return 'written';
}

function phase7(state: WizardState): void {
  phaseHeader(7, 'Langkah berikutnya');

  // 1) Readiness snapshot
  phase7ReadinessSummary(state);

  // 2) Scaffold login requirement (Path A, real per project)
  const scaffoldResult = phase7ScaffoldLoginRequirement(state, LOGIN_REQ_ABS, LOGIN_REQ_REL);
  void scaffoldResult;

  // 3) Print conductor — SATU prompt Hermes
  process.stdout.write('\n');
  process.stdout.write('  ' + hr('=', 64) + '\n');
  process.stdout.write('  LANGKAH BERIKUTNYA (urut dari atas)\n');
  process.stdout.write('  ' + hr('=', 64) + '\n\n');

  process.stdout.write('  1. Pastikan Hermes Agent membuka folder project ini.\n');
  process.stdout.write('     (File → Open Folder atau buka Hermes dari terminal project)\n\n');
  process.stdout.write('  2. Cek MCP di Hermes: harus ada 3 server Connected.\n');
  process.stdout.write('     Jika belum: klik Reload di panel MCP, tunggu hijau.\n\n');
  process.stdout.write(
    '  3. Buka ' + LOGIN_REQ_REL + ' — file requirement login website kamu (bukan sample).\n',
  );
  process.stdout.write('     File ini sudah berisi URL, path login, dan role dari wizard.\n\n');
  process.stdout.write('  4. Salin prompt di bawah → paste ke kolom chat Hermes → Enter:\n\n');

  // Single prompt — site-specific: snapshot catalog then full pipeline.
  const loginUrl = state.loginUrl || '/login';
  const baseUrl = state.baseUrl || 'http://localhost:3000';
  const mechanism = state.loginMechanism ?? 'form';
  const snapshotUrl = mechanism === 'none' ? baseUrl + '/' : baseUrl + loginUrl;
  const featureName = mechanism === 'none' ? 'public' : 'auth';
  const pageName = mechanism === 'none' ? 'home' : 'login';

  const prompt = [
    `Run full pipeline in automatic mode for ${LOGIN_REQ_REL} (orchestrator: AGENTS.md).`,
    `This is the REAL project login requirement (APP_ENV=${state.envName || 'local'}, BASE_URL=${baseUrl}), not a sample file.`,
    `BEFORE Plan/Generate: call snapshot_page (qa-playwright-kit) with url=${snapshotUrl}, featureName=${featureName}, pageName=${pageName}.`,
    `Use the resulting selector-catalog/${featureName}/${pageName}.json locators (Path A, no POM).`,
    `Live-verify labels/selectors on the real page — every website differs.`,
    `Resume from last checkpoint if reports/pipeline-state.json exists.`,
    `Return summary, unresolvedFailures, catalog path, and dashboard/report path.`,
  ].join(' ');

  process.stdout.write('     ' + hr('-', 60) + '\n');
  for (const line of prompt.match(/.{1,58}/g) ?? [prompt]) {
    process.stdout.write('     ' + line + '\n');
  }
  process.stdout.write('     ' + hr('-', 60) + '\n\n');

  process.stdout.write('     Atau jalankan via terminal:\n');
  process.stdout.write('     npm run qa:run -- ' + LOGIN_REQ_REL + '\n\n');

  process.stdout.write('  5. Setelah pipeline selesai, buka laporan:\n');
  process.stdout.write('     npm run qa:run -- --open-dashboard\n');
  process.stdout.write('     (atau buka manual: reports/custom-dashboard.html)\n\n');

  process.stdout.write('  ' + hr('-', 64) + '\n');
  process.stdout.write('  Catatan singkat:\n');
  process.stdout.write(
    '   - requirements/login.md     = requirement website kamu (hasil wizard)\n',
  );
  process.stdout.write('   - requirements/sample-*.md  = contoh format saja (latihan)\n');
  process.stdout.write('   - Ganti akun / password: npm run env:edit\n');
  process.stdout.write('   - Ganti target server: npm run env:use -- <nama>\n');
  process.stdout.write('   - Panduan gagal pipeline: docs/POST-PIPELINE.md\n');
  process.stdout.write('  ' + hr('-', 64) + '\n\n');

  markPhase(state, 7);
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  banner();

  // Resume atau mulai baru
  let state = loadState();
  let startPhase = FLAGS.fromPhase ?? 0;

  // Apply --from-phase: clear completion state for earlier phases
  if (FLAGS.fromPhase !== null && state) {
    state.completedPhases = state.completedPhases.filter((p) => p >= FLAGS.fromPhase!);
    printInfo('Memulai dari Phase ' + FLAGS.fromPhase + ' (sesuai --from-phase flag)');
  }

  if (FLAGS.dryRun) {
    printInfo(
      'Mode --dry-run aktif: tidak ada file yang ditulis, tidak ada command yang dijalankan.',
    );
  }

  if (state) {
    const lastPhase = Math.max(...state.completedPhases, -1);
    if (lastPhase >= 0 && lastPhase < TOTAL_PHASES) {
      process.stdout.write(
        '  Ditemukan progress sebelumnya (Phase ' + lastPhase + ' selesai).\n\n',
      );
      const { resume } = await prompts({
        type: 'select',
        name: 'resume',
        message: 'Lanjut dari mana?',
        choices: [
          { title: 'Lanjut dari Phase ' + (lastPhase + 1), value: 'resume' },
          { title: 'Ulang fase tertentu saja', value: 'pick' },
          { title: 'Mulai dari awal (reset semua)', value: 'restart' },
        ],
      });
      if (resume === 'restart') {
        if (fs.existsSync(STATE_FILE)) fs.unlinkSync(STATE_FILE);
        state = null;
        startPhase = 0;
      } else if (resume === 'pick') {
        const phaseLabels = [
          { title: '0 — Pre-flight check', value: 0 },
          { title: '1 — Project & target (URL)', value: 1 },
          { title: '2 — Akun & kredensial', value: 2 },
          { title: '3 — Install dependencies', value: 3 },
          { title: '4 — Cek Hermes & tools', value: 4 },
          { title: '5 — Simpan sesi login (auth)', value: 5 },
          { title: '6 — Cek akhir & enkripsi', value: 6 },
          { title: '7 — Langkah berikutnya', value: 7 },
        ].filter((p) => p.value <= lastPhase + 1);
        const { picked } = await prompts({
          type: 'select',
          name: 'picked',
          message: 'Pilih fase yang mau diulang:',
          choices: phaseLabels,
        });
        if (picked === undefined) {
          printWarn('Dibatalkan.');
          process.exit(0);
        }
        // Clear completion flag for picked phase and all after it
        state.completedPhases = state.completedPhases.filter((p) => p < picked);
        startPhase = picked;
      } else {
        startPhase = lastPhase + 1;
      }
    }
  }

  if (!state) state = defaultState();

  // Ctrl+C handler — simpan state sebelum keluar
  process.on('SIGINT', () => {
    process.stdout.write('\n\n  Wizard dihentikan. Progress tersimpan di .wizard-state.json\n');
    process.stdout.write('  Lanjutkan kapan saja dengan: npm run setup:wizard\n\n');
    if (state) saveState(state);
    process.exit(0);
  });

  // Phase 0: Pre-flight (selalu jalankan)
  if (startPhase === 0) {
    const ok = await phase0(state);
    if (!ok) {
      process.stdout.write('\n  Setup dihentikan karena prasyarat tidak terpenuhi.\n\n');
      process.exit(EXIT.FIXABLE);
    }
    markPhase(state, 0);
  }

  // Phase 1: Project + Environment
  if (startPhase <= 1 && !state.completedPhases.includes(1)) {
    await phase1(state);
  } else if (state.completedPhases.includes(1)) {
    printOk(`[Phase 1] Project & target (${state.envName || 'local'}) sudah ada — skip`);
  }

  // Phase 2: Kredensial
  if (startPhase <= 2 && !state.completedPhases.includes(2)) {
    await phase2(state);
  } else if (state.completedPhases.includes(2)) {
    printOk('[Phase 2] Akun login sudah dikonfigurasi — skip');
    printInfo('Mau ganti / tambah akun? Jalankan: npm run env:edit');
    printInfo('Atau ulang Phase 2: npm run setup:wizard -- --from-phase=2');
  }

  // Phase 3: Install
  if (startPhase <= 3 && !state.completedPhases.includes(3)) {
    const ok = await phase3(state);
    if (!ok) {
      process.stdout.write('\n  Setup dihentikan karena instalasi gagal.\n');
      process.stdout.write('  Perbaiki error di atas lalu jalankan: npm run setup:wizard\n\n');
      saveState(state);
      process.exit(EXIT.ESCALATE);
    }
  } else if (state.completedPhases.includes(3)) {
    printOk('[Phase 3] Dependencies sudah terinstall — skip');
  }

  // Phase 4: MCP + Hermes
  if (startPhase <= 4 && !state.completedPhases.includes(4)) {
    await phase4(state);
  } else if (state.completedPhases.includes(4)) {
    printOk('[Phase 4] MCP setup sudah dikonfigurasi — skip');
  }

  // Phase 5: Auth setup
  if (startPhase <= 5 && !state.completedPhases.includes(5)) {
    await phase5(state);
  } else if (state.completedPhases.includes(5)) {
    printOk('[Phase 5] Auth setup sudah selesai — skip');
  }

  // Phase 6: Verify + Encrypt
  await phase6(state);

  // Phase 7: Next steps
  phase7(state);

  // Bersihkan state file — setup selesai
  if (fs.existsSync(STATE_FILE)) fs.unlinkSync(STATE_FILE);
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  printError({
    title: 'Unexpected error di setup wizard',
    detail: msg,
    hint: 'Hubungi Framework Maintainer jika ini berulang.',
    exitCode: EXIT.ESCALATE,
  });
  process.exit(EXIT.ESCALATE);
});
