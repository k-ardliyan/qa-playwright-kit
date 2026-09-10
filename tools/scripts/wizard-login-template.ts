/// <reference types="node" />
/**
 * wizard-login-template — Render requirements/login.md from WizardState.
 *
 * Renderer + optional write of requirements/login.md.
 * Wired from src/setup/wizard.ts after env write. Also used to emit
 * committed catalogs at requirements/auth/login-<challengeMode>.md.
 *
 * Vocabulary:
 * - Credential role default = **user** (TEST_USER_*)
 * - Pipeline mode **general** = non-role-aware (auth → user), not an env role name
 * - OTP/CAPTCHA scenarios stay (@manual) — AUTH_CHALLENGE_MODE only helps auth:setup
 *
 * @module scripts/wizard-login-template
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ChallengeMode } from '../../src/support/human-challenge';
import { formScenarios, ssoScenarios, noneScenarios } from './wizard-login-scenarios';

export type LoginMechanism = 'form' | 'sso' | 'none';

export interface RoleSpec {
  /** Role name (lowercase-hyphen). Misal: 'user', 'admin', 'finance'. Never 'general'. */
  name: string;
  /** Path ke auth state file. Misal: '.auth/{APP_ENV}/user.json'. */
  authFile: string;
}

export interface LoginTemplateState {
  projectName: string;
  baseUrl: string;
  loginUrl: string; // e.g. '/login'
  successUrlPath: string; // e.g. '/dashboard'
  roles: RoleSpec[];
  mechanism: LoginMechanism;
  /** AUTH_CHALLENGE_MODE from wizard. Ignored when mechanism is sso/none. */
  challengeMode?: ChallengeMode;
  /** LOGIN_ID_PREF for primary role — drives credential:<role>.<field>. */
  loginIdPref?: 'email' | 'username' | 'phone';
  /** Opsional: hint field login (email/username/phone). */
  loginFieldHints?: string[];
  /** Opsional: hint field password. */
  passwordFieldHints?: string[];
  /** Opsional: hint tombol submit. */
  submitButtonHints?: string[];
}

const CHALLENGE_REQ_ID: Record<ChallengeMode, string> = {
  none: 'REQ-AUTH-NONE',
  auto: 'REQ-AUTH-AUTO',
  'otp-browser': 'REQ-AUTH-OTP-BROWSER',
  'otp-stdin': 'REQ-AUTH-OTP-STDIN',
  'captcha-browser': 'REQ-AUTH-CAPTCHA',
};

export function canonicalRole(name: string): string {
  const n = name.trim().toLowerCase();
  if (n === 'default' || n === 'general' || n === '') return 'user';
  return n;
}

export function envPrefixFor(role: RoleSpec): string {
  const n = canonicalRole(role.name);
  return n === 'user' ? 'TEST_USER' : n.toUpperCase().replace(/-/g, '_');
}

function resolveChallenge(state: LoginTemplateState): ChallengeMode {
  if (state.mechanism !== 'form') return 'none';
  return state.challengeMode ?? 'none';
}

function frontmatter(title: string, challengeMode: ChallengeMode, generated: boolean): string {
  const origin = generated
    ? '  AUTO-GENERATED oleh setup wizard dari nilai REAL project (BASE_URL, login path, roles, AUTH_CHALLENGE_MODE).\n'
    : `  Catalog AUTH_CHALLENGE_MODE=${challengeMode}. Setup wizard menulis requirements/login.md dari mode yang dipilih.\n`;
  return (
    `${title}\n\n` +
    `<!--\n` +
    origin +
    `  Locator berbeda per website: Generator WAJIB snapshot_page dulu, lalu live-verify selector.\n` +
    `  Jangan tulis password/secret di file ini.\n` +
    `  OTP/CAPTCHA di requirement tetap (@manual). AUTH_CHALLENGE_MODE hanya membantu npm run auth:setup.\n` +
    `-->\n\n`
  );
}

function metadata(state: LoginTemplateState, halamanAwal: string, feature: string): string {
  const tags = `#auth #ui #smoke #login`;
  const lines: string[] = [
    '## Metadata',
    '',
    `- **Tags:** ${tags}`,
    `- **Prioritas:** high`,
    `- **Auth state:** unauthenticated`,
    `- **Halaman awal:** ${halamanAwal}`,
    `- **Module:** auth`,
    `- **Feature:** ${feature}`,
  ];

  if (state.mechanism !== 'none' && state.roles.length > 1) {
    const roleNames = state.roles.map((r) => canonicalRole(r.name)).join(', ');
    lines.push(`- **Role scope:** ${roleNames}`);
    lines.push(
      `- **Access expectation:** tiap role ${roleNames} bisa login dengan kredensial masing-masing`,
    );
  }

  return lines.join('\n') + '\n\n';
}

export * from './wizard-login-scenarios';

function footer(state: LoginTemplateState, challengeMode: ChallengeMode): string {
  const roleName = canonicalRole(state.roles[0]?.name ?? 'user');
  const roleList =
    state.roles.length > 0 ? state.roles.map((r) => canonicalRole(r.name)).join(', ') : 'user';
  const loginUrl = state.loginUrl || '/login';
  const catalogHint =
    state.mechanism === 'none' ? `selector-catalog/public/home` : `selector-catalog/auth/login`;
  const snapshotUrl =
    state.mechanism === 'none' ? `${state.baseUrl}/` : `${state.baseUrl}${loginUrl}`;
  const featureName = state.mechanism === 'none' ? 'public' : 'auth';
  const pageName = state.mechanism === 'none' ? 'home' : 'login';

  // IMPORTANT: jangan pakai heading ### di sini — validator requirement
  // menganggap ### sebagai skenario (butuh Langkah/Hasil).
  const challengeNote =
    challengeMode === 'none'
      ? `- AUTH_CHALLENGE_MODE=none — tidak ada OTP/CAPTCHA setelah password\n`
      : `- AUTH_CHALLENGE_MODE=${challengeMode} — bantu sesi via \`npm run auth:setup\` / \`auth:setup:headed\`; skenario tantangan tetap (@manual)\n`;

  return (
    `\n---\n\n` +
    `## Catatan Pipeline (wajib diikuti Hermes)\n\n` +
    `**1) Capture locator catalog dulu (per website)**\n\n` +
    `Setiap app punya form/label berbeda. Jangan hardcode selector generik.\n\n` +
    `- Panggil \`snapshot_page\` (qa-playwright-kit):\n` +
    `  - url: \`${snapshotUrl}\`\n` +
    `  - featureName: \`${featureName}\`\n` +
    `  - pageName: \`${pageName}\`\n` +
    `- Catalog: \`${catalogHint}.{json,aria.yml}\`\n` +
    `- Generator pakai locator dari catalog + live verify (playwright-cli / browser_* MCP)\n` +
    `- Path A (default): inline locator dari catalog — **tanpa POM**\n` +
    `- Path B (opsional nanti): \`generate_page_object\` + register fixture\n\n` +
    `**2) Role, env, challenge**\n\n` +
    `- Role aktif di requirement ini: \`${roleName}\` (roles: ${roleList})\n` +
    `- Multi-role: tambah via \`npm run env:edit\` + metadata Role scope\n` +
    `- Auth file: \`.auth/{APP_ENV}/<role>.json\` (helper: \`authStatePath('<role>')\`)\n` +
    `- Kredensial hanya dari env (\`TEST_USER_*\` / \`{ROLE}_*\`) — jangan hardcode secret\n` +
    `- Selector environment: **APP_ENV** saja (\`npm run env:status\` / \`env:use\`)\n` +
    challengeNote +
    `\n` +
    `**3) Dashboard columns (jangan campur)**\n\n` +
    `- **Test Step** = teks langkah skenario verbatim (aksi UI). Dilarang menaruh nilai Input Data di judul \`test.step\`.\n` +
    `- **Input Data** = blok input skenario (\`credential:\` / \`literal:\` / \`seed:\` / \`fixture:\`) via \`setTestMetadata.inputData\`.\n` +
    `- **Expected** = hasil yang diharapkan verbatim. Pass: \`captureActualResult\` = string yang sama.\n\n` +
    `**4) Output pipeline**\n\n` +
    `- Plan: \`specs/login-test-plan.md\`\n` +
    `- Spec: \`tests/login*.spec.ts\`\n` +
    `- Report: \`artifacts/reports/pipeline-report-*.md\` (interaktif: \`npm run dashboard\`)\n`
  );
}

function formAcceptance(state: LoginTemplateState, challengeMode: ChallengeMode): string {
  const roleName = canonicalRole(state.roles[0]?.name ?? 'user');
  const lines: string[] = [
    `- **AC-01:** Form login menolak submit ketika field identifier (email/username/phone) kosong.`,
    `- **AC-02:** Form login menolak submit ketika field password kosong.`,
    `- **AC-03:** Form login menolak submit ketika identifier dan password kosong.`,
    `- **AC-04:** Form login menolak identifier yang hanya spasi (diperlakukan kosong).`,
    `- **AC-05:** Form login menolak identifier dengan format tidak valid (bukan email/username/phone yang diterima aplikasi).`,
    `- **AC-06:** Login gagal dengan user fiktif menampilkan pesan error observable, tetap di halaman login, dan akun role \`${roleName}\` tidak terkunci.`,
    `- **AC-07:** Login berhasil dengan kredensial valid me-redirect ke path \`${state.successUrlPath}\` ` +
      `(assert pathname, bukan URL dengan \`?redirect=\`) dan session tersimpan di \`.auth/{APP_ENV}/${roleName}.json\`.`,
  ];
  let nextAc = 8;
  if (challengeMode !== 'none') {
    lines.push(
      `- **AC-${String(nextAc).padStart(2, '0')}:** Setelah password, tantangan ${challengeMode} diselesaikan manusia; skenario ditandai (@manual) ` +
        `karena OTP/CAPTCHA tidak diotomasi di pipeline (AUTH_CHALLENGE_MODE hanya untuk auth:setup).`,
    );
    nextAc++;
  }
  lines.push(
    `- **AC-${String(nextAc).padStart(2, '0')}:** Form login menyediakan tombol/icon toggle show/hide password yang mengubah atribut type input antara password dan text.`,
    `- **AC-${String(nextAc + 1).padStart(2, '0')}:** Sistem secara otomatis memotong (trim) karakter spasi di awal dan akhir identifier pada saat submit sehingga login dengan kredensial valid tetap berhasil.`,
    `- **AC-${String(nextAc + 2).padStart(2, '0')}:** Form login dapat di-submit menggunakan penekanan tombol keyboard Enter ketika fokus berada pada input field.`,
    `- **AC-${String(nextAc + 3).padStart(2, '0')}:** Checkbox "Ingat Saya" (Remember Me) dapat di-toggle status checked dan unchecked-nya oleh pengguna.`,
    `- **AC-${String(nextAc + 4).padStart(2, '0')}:** Identifier email bersifat case-insensitive sehingga input kredensial valid berhuruf kapital tetap berhasil login ke \`${state.successUrlPath}\`.`,
    `- **AC-${String(nextAc + 5).padStart(2, '0')}:** Tautan bantuan sekunder seperti "Lupa Kata Sandi?" dan "Daftar Akun" tampil di halaman login dengan URL target yang valid.`,
    `- **AC-${String(nextAc + 6).padStart(2, '0')}:** Mengakses halaman protected tanpa sesi mengarahkan pengguna ke halaman login tanpa menampilkan konten protected (deep-link protection).`,
    `- **AC-${String(nextAc + 7).padStart(2, '0')}:** Setelah login sukses, reload halaman tidak mengakhiri sesi — pengguna tetap login di \`${state.successUrlPath}\`.`,
    `- **AC-${String(nextAc + 8).padStart(2, '0')}:** Navigasi back browser setelah login tidak mengakhiri sesi; akses ulang area sukses tidak meminta login ulang.`,
    `- **AC-${String(nextAc + 9).padStart(2, '0')}:** Klik ganda pada tombol submit tidak memproses otentikasi dua kali (tombol disabled atau menampilkan loading selama proses).`,
    `- **AC-${String(nextAc + 10).padStart(2, '0')}:** Identifier berisi markup/script dirender sebagai teks (di-escape), tidak dieksekusi, dan submit ditolak.`,
    `- **AC-${String(nextAc + 11).padStart(2, '0')}:** Logout mengakhiri sesi; akses halaman protected setelah logout diarahkan kembali ke \`${state.loginUrl}\`.`,
  );
  return lines.join('\n') + '\n\n';
}

export function projectNameFromUrl(baseUrl: string): string {
  try {
    return new URL(baseUrl).hostname.replace(/^www\./, '') || 'Target App';
  } catch {
    return 'Target App';
  }
}

/** Placeholder state for committed catalogs under requirements/auth/login-<mode>.md. */
export function catalogLoginState(mode: ChallengeMode): LoginTemplateState {
  return {
    projectName: 'Target App',
    baseUrl: 'https://app.example.com',
    loginUrl: '/login',
    successUrlPath: '/dashboard',
    roles: [{ name: 'user', authFile: '.auth/{APP_ENV}/user.json' }],
    mechanism: 'form',
    challengeMode: mode,
  };
}

export function loginStateFromWizard(opts: {
  baseUrl: string;
  appEnv: string;
  roles: string[];
  challengeMode: ChallengeMode;
  loginUrl?: string;
  successUrlPath?: string;
  loginIdPref?: string;
}): LoginTemplateState {
  const roles = (opts.roles.length > 0 ? opts.roles : ['user']).map((name) => {
    const n = canonicalRole(name);
    return { name: n, authFile: `.auth/${opts.appEnv}/${n}.json` };
  });
  return {
    projectName: projectNameFromUrl(opts.baseUrl),
    baseUrl: opts.baseUrl.replace(/\/$/, ''),
    loginUrl: ensureLeadingSlash(opts.loginUrl, '/login'),
    successUrlPath: ensureLeadingSlash(opts.successUrlPath, '/dashboard'),
    roles,
    mechanism: 'form',
    challengeMode: opts.challengeMode,
    loginIdPref: parseLoginIdPref(opts.loginIdPref),
  };
}

function parseLoginIdPref(raw: string | undefined): 'email' | 'username' | 'phone' | undefined {
  return raw === 'email' || raw === 'username' || raw === 'phone' ? raw : undefined;
}

function ensureLeadingSlash(raw: string | undefined, fallback: string): string {
  const v = raw?.trim();
  if (!v) return fallback;
  return v.startsWith('/') ? v : `/${v}`;
}

const AUTOGEN_MARKER = 'AUTO-GENERATED oleh setup wizard';

function isAutogeneratedLogin(content: string): boolean {
  return content.includes(AUTOGEN_MARKER);
}

/** Write generated login.md under repoRoot/requirements/login.md. Returns relative path. */
export function writeLoginRequirementFile(
  repoRoot: string,
  state: LoginTemplateState,
): { relativePath: string; absolutePath: string; skipped: boolean } {
  const relativePath = 'requirements/login.md';
  const absolutePath = path.join(repoRoot, relativePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  if (fs.existsSync(absolutePath)) {
    const existing = fs.readFileSync(absolutePath, 'utf-8');
    if (!isAutogeneratedLogin(existing)) {
      return { relativePath, absolutePath, skipped: true };
    }
  }
  fs.writeFileSync(absolutePath, buildLoginRequirement(state, { generated: true }), 'utf-8');
  return { relativePath, absolutePath, skipped: false };
}

export function buildLoginRequirement(
  state: LoginTemplateState,
  opts?: { generated?: boolean },
): string {
  const challengeMode = resolveChallenge(state);
  const generated = opts?.generated !== false;
  const projectLabel = state.projectName || 'Target App';

  let title: string;
  let feature: string;
  if (state.mechanism === 'none') {
    title = `# REQ-AUTH-001: Smoke Publik — ${projectLabel}`;
    feature = 'public-home';
  } else if (state.mechanism === 'sso') {
    title = `# REQ-AUTH-001: Login SSO — ${projectLabel}`;
    feature = 'login-sso';
  } else if (generated) {
    title = `# REQ-AUTH-001: Login — ${projectLabel}`;
    feature = 'login';
  } else {
    title = `# ${CHALLENGE_REQ_ID[challengeMode]}: Login — ${challengeMode} — ${projectLabel}`;
    feature = `login-${challengeMode}`;
  }

  let body = '';
  const halamanAwal = state.mechanism === 'none' ? '/' : state.loginUrl;

  body += frontmatter(title, challengeMode, generated);
  body += metadata(state, halamanAwal, feature);
  body += `## Kriteria Penerimaan\n\n`;

  if (state.mechanism === 'form') {
    body += formAcceptance(state, challengeMode);
    body += formScenarios(state, challengeMode);
  } else if (state.mechanism === 'sso') {
    body +=
      `- **AC-01:** Login via SSO berhasil dan me-redirect ke path \`${state.successUrlPath}\`.\n` +
      `- **AC-02:** Session SSO tersimpan (browser cookies / id_token).\n\n`;
    body += ssoScenarios(state);
  } else {
    body +=
      `- **AC-01:** Halaman utama \`${state.baseUrl}/\` termuat tanpa error.\n` +
      `- **AC-02:** Aplikasi tidak menampilkan form login (mechanism: none) dan body berisi konten visible.\n\n`;
    body += noneScenarios(state);
  }

  body += footer(state, challengeMode);
  return body;
}
