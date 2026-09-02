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

export type LoginMechanism = 'form' | 'sso' | 'none';

export interface RoleSpec {
  /** Role name (lowercase-hyphen). Misal: 'user', 'admin', 'finance'. Never 'general'. */
  name: string;
  /** Path ke auth state file. Misal: '.auth/local/user.json'. */
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

const DEFAULT_LOGIN_FIELDS = ['email', 'username', 'user'];
const DEFAULT_PASSWORD_FIELDS = ['password', 'pass', 'kata sandi'];
const DEFAULT_SUBMIT_BUTTONS = ['Masuk', 'Login', 'Sign in', 'Log in'];
const DEFAULT_LOGOUT_BUTTONS = ['Logout', 'Keluar', 'Sign out'];

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

function envPrefixFor(role: RoleSpec): string {
  const n = canonicalRole(role.name);
  return n === 'user' ? 'TEST_USER' : n.toUpperCase().replace(/-/g, '_');
}

function credentialKey(
  roleName: string,
  field: 'email' | 'username' | 'phone' | 'password',
): string {
  return `credential:${canonicalRole(roleName)}.${field}`;
}

function identifierCredential(roleName: string, pref?: 'email' | 'username' | 'phone'): string {
  return credentialKey(roleName, pref ?? 'email');
}

function formatList(items: string[]): string {
  if (items.length === 0) return '';
  if (items.length === 1) return `\`${items[0]}\``;
  if (items.length === 2) return `\`${items[0]}\` atau \`${items[1]}\``;
  return (
    items
      .slice(0, -1)
      .map((i) => `\`${i}\``)
      .join(', ') + `, atau \`${items[items.length - 1]}\``
  );
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

function scenarioBlock(opts: {
  heading: string;
  testId: string;
  covers: string;
  priority?: string;
  layer?: string;
  role?: string;
  precondition: string;
  inputLines: string[];
  steps: string[];
  results: string[];
}): string {
  const roleLine = opts.role ? `- **Role:** \`${opts.role}\`\n` : '';
  return (
    `### ${opts.heading}\n\n` +
    `- **Test ID:** \`${opts.testId}\`\n` +
    `- **Covers:** ${opts.covers}\n` +
    roleLine +
    `- **Prioritas skenario:** \`${opts.priority ?? 'high'}\`\n` +
    `- **Layer terdampak:** \`${opts.layer ?? 'FE BE'}\`\n\n` +
    `**Prekondisi:** ${opts.precondition}\n\n` +
    `**Input Data:**\n\n` +
    opts.inputLines.map((l) => `- ${l}`).join('\n') +
    `\n\n` +
    `**Langkah:**\n\n` +
    opts.steps.map((s, i) => `${i + 1}. ${s}`).join('\n') +
    `\n\n` +
    `**Hasil yang Diharapkan:**\n\n` +
    opts.results.map((r) => `- ${r}`).join('\n') +
    `\n`
  );
}

function challengeManualScenario(
  state: LoginTemplateState,
  mode: ChallengeMode,
  roleName: string,
  loginFields: string,
  passwordFields: string,
  submitButtons: string,
  identCred: string,
  scIndex: number,
): string {
  const loginUrl = state.loginUrl;
  const successUrlPath = state.successUrlPath;
  const headings: Record<Exclude<ChallengeMode, 'none'>, string> = {
    auto: 'Verifikasi OTP atau CAPTCHA (auto-detect) (@manual)',
    'otp-browser': 'Verifikasi OTP di Browser (@manual)',
    'otp-stdin': 'Verifikasi OTP di Terminal (@manual)',
    'captcha-browser': 'Verifikasi CAPTCHA di Browser (@manual)',
  };
  const extraStep: Record<Exclude<ChallengeMode, 'none'>, string> = {
    auto: 'Selesaikan OTP atau CAPTCHA yang muncul (mode auto: CAPTCHA di browser; OTP di browser jika headed, fallback terminal jika TTY)',
    'otp-browser': 'Isi kode OTP di kolom yang tampil di browser (jangan ketik OTP di terminal)',
    'otp-stdin': 'Ketik kode OTP di terminal saat diminta (halaman browser tetap terbuka)',
    'captcha-browser': 'Selesaikan CAPTCHA di browser (terminal tidak bisa mengisi CAPTCHA)',
  };
  const reason: Record<Exclude<ChallengeMode, 'none'>, string> = {
    auto: 'OTP/CAPTCHA tidak diotomasi di pipeline — skenario tetap (@manual). AUTH_CHALLENGE_MODE=auto hanya membantu `npm run auth:setup` mendeteksi tantangan lalu pause di browser atau terminal.',
    'otp-browser':
      'Kode OTP berasal dari perangkat/SMS/email manusia — tidak diotomasi di pipeline. AUTH_CHALLENGE_MODE=otp-browser hanya membantu `npm run auth:setup` (headed) menyimpan sesi `.auth/{APP_ENV}/<role>.json`.',
    'otp-stdin':
      'Kode OTP diketik manusia di terminal — tidak diotomasi di pipeline. AUTH_CHALLENGE_MODE=otp-stdin hanya membantu `npm run auth:setup` (TTY wajib) menyimpan sesi.',
    'captcha-browser':
      'CAPTCHA tidak bisa diisi dari terminal atau CI — skenario tetap (@manual). AUTH_CHALLENGE_MODE=captcha-browser hanya membantu `npm run auth:setup:headed` pause di browser sampai manusia selesai.',
  };
  if (mode === 'none') return '';
  const heading = headings[mode];
  const scLabel = String(scIndex).padStart(2, '0');
  const tcId = String(scIndex).padStart(3, '0');
  return (
    `\n---\n\n` +
    scenarioBlock({
      heading: `SC-${scLabel}: ${heading}`,
      testId: `TC-LOGIN-${tcId}`,
      covers: '`AC-07`, `AC-08`',
      priority: 'medium',
      layer: 'FE',
      role: roleName,
      precondition: `Pengguna di \`${state.baseUrl}${loginUrl}\`, kredensial valid, AUTH_CHALLENGE_MODE=${mode}.`,
      inputLines: [
        `identifier: ${identCred}`,
        `password: ${credentialKey(roleName, 'password')}`,
        `challengeMode: literal:${mode}`,
      ],
      steps: [
        `Buka halaman login`,
        `Isi field login (${loginFields})`,
        `Isi field password (${passwordFields})`,
        `Klik tombol submit (${submitButtons})`,
        extraStep[mode],
      ],
      results: [
        `Setelah tantangan selesai, URL pathname mengandung \`${successUrlPath}\` **DAN TIDAK** mengandung \`${loginUrl}\``,
        `Form login tidak terlihat lagi`,
        reason[mode],
      ],
    })
  );
}

function formScenarios(state: LoginTemplateState, challengeMode: ChallengeMode): string {
  const primaryRole = state.roles[0] ?? {
    name: 'user',
    authFile: '.auth/local/user.json',
  };
  const roleName = canonicalRole(primaryRole.name);
  const envPrefix = envPrefixFor({ ...primaryRole, name: roleName });
  const loginFields = formatList(state.loginFieldHints ?? DEFAULT_LOGIN_FIELDS);
  const passwordFields = formatList(state.passwordFieldHints ?? DEFAULT_PASSWORD_FIELDS);
  const submitButtons = formatList(state.submitButtonHints ?? DEFAULT_SUBMIT_BUTTONS);
  const loginUrl = state.loginUrl;
  const successUrlPath = state.successUrlPath;
  const authFile =
    primaryRole.authFile.includes('/') && primaryRole.authFile.includes('.auth/')
      ? primaryRole.authFile
      : `.auth/{APP_ENV}/${roleName}.json`;

  const identCred = identifierCredential(roleName, state.loginIdPref);
  const includeAutoSuccess = challengeMode === 'none';
  let sc = 1;
  const take = (): { heading: (title: string) => string; testId: string } => {
    const n = sc;
    sc += 1;
    const label = String(n).padStart(2, '0');
    return {
      heading: (title: string) => `SC-${label}: ${title}`,
      testId: `TC-LOGIN-${String(n).padStart(3, '0')}`,
    };
  };

  const stayOnLogin = [
    `URL tetap mengandung \`${loginUrl}\` (tidak redirect ke \`${successUrlPath}\`)`,
    'Tombol submit kembali enabled (tidak stuck loading)',
  ];

  const id1 = take();
  const scEmptyIdent = scenarioBlock({
    heading: id1.heading('Submit dengan Identifier Kosong (@failure)'),
    testId: id1.testId,
    covers: '`AC-01`',
    priority: 'high',
    layer: 'FE',
    role: roleName,
    precondition: `Pengguna di \`${state.baseUrl}${loginUrl}\`, belum login.`,
    inputLines: ['identifier: literal:', `password: ${credentialKey(roleName, 'password')}`],
    steps: [
      'Buka halaman login',
      'Biarkan field login kosong',
      `Isi field password (${passwordFields})`,
      `Klik tombol submit (${submitButtons})`,
    ],
    results: [
      stayOnLogin[0]!,
      'Pesan validasi tampil di dekat field identifier',
      'Request otentikasi tidak dikirim',
      stayOnLogin[1]!,
    ],
  });

  const id2 = take();
  const scEmptyPass = scenarioBlock({
    heading: id2.heading('Submit dengan Password Kosong (@failure)'),
    testId: id2.testId,
    covers: '`AC-02`',
    priority: 'high',
    layer: 'FE',
    role: roleName,
    precondition: `Pengguna di \`${state.baseUrl}${loginUrl}\`, belum login.`,
    inputLines: [`identifier: ${identCred}`, 'password: literal:'],
    steps: [
      'Buka halaman login',
      `Isi field login (${loginFields})`,
      'Biarkan field password kosong',
      `Klik tombol submit (${submitButtons})`,
    ],
    results: [
      stayOnLogin[0]!,
      'Pesan validasi tampil di dekat field password',
      'Request otentikasi tidak dikirim',
      stayOnLogin[1]!,
    ],
  });

  const id3 = take();
  const scBothEmpty = scenarioBlock({
    heading: id3.heading('Submit dengan Identifier dan Password Kosong (@failure)'),
    testId: id3.testId,
    covers: '`AC-03`',
    priority: 'high',
    layer: 'FE',
    role: roleName,
    precondition: `Pengguna di \`${state.baseUrl}${loginUrl}\`, belum login.`,
    inputLines: ['identifier: literal:', 'password: literal:'],
    steps: [
      'Buka halaman login',
      'Biarkan field login kosong',
      'Biarkan field password kosong',
      `Klik tombol submit (${submitButtons})`,
    ],
    results: [
      stayOnLogin[0]!,
      'Pesan validasi tampil di dekat field identifier',
      'Pesan validasi tampil di dekat field password',
      'Request otentikasi tidak dikirim',
    ],
  });

  const id4 = take();
  const scWhitespace = scenarioBlock({
    heading: id4.heading('Submit dengan Identifier Hanya Spasi (@failure)'),
    testId: id4.testId,
    covers: '`AC-04`',
    priority: 'medium',
    layer: 'FE',
    role: roleName,
    precondition: `Pengguna di \`${state.baseUrl}${loginUrl}\`, belum login.`,
    inputLines: ['identifier: literal:   ', `password: ${credentialKey(roleName, 'password')}`],
    steps: [
      'Buka halaman login',
      'Isi field login dengan karakter spasi saja (nilai di Input Data)',
      `Isi field password (${passwordFields})`,
      `Klik tombol submit (${submitButtons})`,
    ],
    results: [
      stayOnLogin[0]!,
      'Pesan validasi tampil di dekat field identifier (spasi diperlakukan kosong)',
      'Request otentikasi tidak dikirim',
    ],
  });

  const id5 = take();
  const scMalformed = scenarioBlock({
    heading: id5.heading('Submit dengan Identifier Format Tidak Valid (@failure)'),
    testId: id5.testId,
    covers: '`AC-05`',
    priority: 'medium',
    layer: 'FE',
    role: roleName,
    precondition: `Pengguna di \`${state.baseUrl}${loginUrl}\`, belum login. Identifier fiktif, bukan akun real.`,
    inputLines: [
      'identifier: literal:bukan-email-atau-phone',
      `password: ${credentialKey(roleName, 'password')}`,
    ],
    steps: [
      'Buka halaman login',
      `Isi field login (${loginFields})`,
      `Isi field password (${passwordFields})`,
      `Klik tombol submit (${submitButtons})`,
    ],
    results: [
      stayOnLogin[0]!,
      'Pesan validasi format tampil di dekat field identifier',
      'Request otentikasi tidak dikirim, atau ditolak di UI tanpa redirect',
    ],
  });

  const id6 = take();
  const scFictional = scenarioBlock({
    heading: id6.heading('Login Gagal dengan User Fiktif (@failure)'),
    testId: id6.testId,
    covers: '`AC-06`',
    priority: 'high',
    role: roleName,
    precondition:
      `Aplikasi berjalan di \`${state.baseUrl}\`. Akun \`qa.invalid.user.not.exists\` ` +
      `**tidak ada** di sistem (user fiktif — jangan pakai password salah pada akun real).`,
    inputLines: [
      'identifier: literal:qa.invalid.user.not.exists',
      'password: literal:WrongPasswordInvalid!',
    ],
    steps: [
      'Buka halaman login',
      `Isi field login (${loginFields})`,
      `Isi field password (${passwordFields})`,
      `Klik tombol submit (${submitButtons})`,
    ],
    results: [
      stayOnLogin[0]!,
      'Pesan error yang observable tampil di halaman (mis. "Email atau password salah")',
      stayOnLogin[1]!,
      `Akun role \`${roleName}\` **tidak terkunci** — user fiktif di luar scope lockout`,
    ],
  });

  const scSuccess = includeAutoSuccess
    ? (() => {
        const id7 = take();
        return scenarioBlock({
          heading: id7.heading('Login Berhasil dengan Kredensial Valid (@success)'),
          testId: id7.testId,
          covers: '`AC-07`',
          role: roleName,
          precondition:
            `Akun \`${envPrefix}_EMAIL\` (atau USERNAME/PHONE) terdaftar di aplikasi ` +
            `(lihat \`config/environments/{APP_ENV}.env\` — JANGAN tulis nilainya di sini).`,
          inputLines: [
            `identifier: ${identCred}`,
            `password: ${credentialKey(roleName, 'password')}`,
          ],
          steps: [
            'Buka halaman login',
            `Isi field login (${loginFields})`,
            `Isi field password (${passwordFields})`,
            `Klik tombol submit (${submitButtons})`,
          ],
          results: [
            `URL pathname mengandung \`${successUrlPath}\` **DAN TIDAK** mengandung \`${loginUrl}\``,
            'Form login tidak terlihat lagi (sudah diganti konten dashboard/beranda)',
            `Session tersimpan di \`${authFile}\` (atau \`.auth/{APP_ENV}/${roleName}.json\`) via auth.setup`,
            'Tidak ada pesan error yang tampil di halaman',
          ],
        });
      })()
    : '';
  const extra = challengeManualScenario(
    state,
    challengeMode,
    roleName,
    loginFields,
    passwordFields,
    submitButtons,
    identCred,
    sc,
  );
  if (challengeMode !== 'none') {
    sc += 1;
  }

  const negatives =
    scEmptyIdent +
    `\n---\n\n` +
    scEmptyPass +
    `\n---\n\n` +
    scBothEmpty +
    `\n---\n\n` +
    scWhitespace +
    `\n---\n\n` +
    scMalformed +
    `\n---\n\n` +
    scFictional;

  const acOffset = challengeMode !== 'none' ? 1 : 0;

  const tier2Scenarios = (() => {
    const ac = (n: number) => `\`AC-${String(n + acOffset).padStart(2, '0')}\``;

    const id8 = take();
    const scTogglePass = scenarioBlock({
      heading: id8.heading('Toggle Visibilitas Password Show dan Hide (@ui)'),
      testId: id8.testId,
      covers: ac(8),
      priority: 'medium',
      layer: 'FE',
      role: roleName,
      precondition: `Pengguna berada di halaman \`${state.baseUrl}${loginUrl}\`.`,
      inputLines: ['password: literal:MySecretPassword123!'],
      steps: [
        'Buka halaman login',
        'Isi field password dengan `MySecretPassword123!`',
        'Periksa tipe input password sebelum toggle',
        'Klik icon atau tombol show password',
        'Periksa tipe input password setelah toggle aktif',
        'Klik icon atau tombol hide password sekali lagi',
        'Periksa tipe input password setelah toggle nonaktif',
      ],
      results: [
        'Field password awalnya memiliki atribut `type="password"`',
        'Setelah tombol show diklik, atribut input berubah menjadi `type="text"` dan nilai password terlihat di UI',
        'Setelah tombol hide diklik kembali, atribut input kembali menjadi `type="password"`',
        'Teks nilai password yang telah diinput tidak terhapus atau berubah',
      ],
    });

    const id9 = take();
    const scTrimWhitespace = scenarioBlock({
      heading: id9.heading(
        'Login Berhasil dengan Identifier Mengandung Spasi Awal dan Akhir (@success)',
      ),
      testId: id9.testId,
      covers: ac(9),
      priority: 'high',
      layer: 'FE BE',
      role: roleName,
      precondition: 'Akun pengguna valid terdaftar di sistem.',
      inputLines: [
        'identifier: literal:  test.user@example.com  ',
        `password: ${credentialKey(roleName, 'password')}`,
      ],
      steps: [
        'Buka halaman login',
        'Isi field login dengan email yang memiliki karakter spasi di awal dan akhir (`  test.user@example.com  `)',
        'Isi field password dengan password valid',
        `Klik tombol submit (${submitButtons})`,
      ],
      results: [
        'Sistem otomatis melakukan trim pada nilai identifier tanpa menampilkan error validasi spasi',
        `URL pathname diarahkan ke \`${successUrlPath}\``,
        'Form login tidak terlihat lagi di halaman',
      ],
    });

    const id10 = take();
    const scEnterSubmit = scenarioBlock({
      heading: id10.heading('Submit Form Login via Penekanan Tombol Keyboard Enter (@success)'),
      testId: id10.testId,
      covers: ac(10),
      priority: 'high',
      layer: 'FE',
      role: roleName,
      precondition: `Pengguna di \`${state.baseUrl}${loginUrl}\`, belum login.`,
      inputLines: [`identifier: ${identCred}`, `password: ${credentialKey(roleName, 'password')}`],
      steps: [
        'Buka halaman login',
        `Isi field login (${loginFields})`,
        `Isi field password (${passwordFields})`,
        'Tekan tombol `Enter` pada keyboard saat kursor masih aktif di field password tanpa mengklik tombol submit',
      ],
      results: [
        'Form login ter-submit secara otomatis via event keyboard',
        `URL pathname berpindah ke \`${successUrlPath}\` dan tidak lagi berada di \`${loginUrl}\``,
        'Tidak ada pesan error yang tampil',
      ],
    });

    const id11 = take();
    const scRememberMe = scenarioBlock({
      heading: id11.heading('Interaksi Checkbox Ingat Saya Remember Me (@ui)'),
      testId: id11.testId,
      covers: ac(11),
      priority: 'low',
      layer: 'FE',
      role: roleName,
      precondition: `Pengguna berada di halaman \`${state.baseUrl}${loginUrl}\`.`,
      inputLines: ['rememberMe: literal:true'],
      steps: [
        'Buka halaman login',
        'Periksa status awal checkbox "Ingat Saya" atau "Remember Me"',
        'Klik checkbox "Ingat Saya" untuk mencentang',
        'Periksa status checkbox setelah diklik',
        'Klik kembali checkbox "Ingat Saya" untuk membatalkan centang',
        'Periksa status akhir checkbox',
      ],
      results: [
        'Checkbox "Ingat Saya" tampil di area form login',
        'Saat pertama diklik, elemen checkbox berstatus `checked` (tercentang)',
        'Saat diklik kedua kali, elemen checkbox kembali berstatus `unchecked` (tidak tercentang)',
        'Tidak memicu reload halaman atau validasi error',
      ],
    });

    const id12 = take();
    const scCaseInsensitive = scenarioBlock({
      heading: id12.heading(
        'Login Berhasil dengan Identifier Huruf Kapital Case-Insensitive (@success)',
      ),
      testId: id12.testId,
      covers: ac(12),
      priority: 'high',
      layer: 'FE BE',
      role: roleName,
      precondition: 'Akun pengguna terdaftar dengan email huruf kecil atau campuran.',
      inputLines: [
        'identifier: literal:TEST.USER@EXAMPLE.COM',
        `password: ${credentialKey(roleName, 'password')}`,
      ],
      steps: [
        'Buka halaman login',
        'Isi field login dengan email berhuruf kapital penuh (`TEST.USER@EXAMPLE.COM`)',
        'Isi field password dengan password valid',
        `Klik tombol submit (${submitButtons})`,
      ],
      results: [
        'Sistem mengenali email secara case-insensitive tanpa memunculkan error "User tidak ditemukan"',
        `URL pathname berhasil berpindah ke \`${successUrlPath}\``,
        'Dashboard ter-render dengan session aktif',
      ],
    });

    const id13 = take();
    const scSecondaryLinks = scenarioBlock({
      heading: id13.heading(
        'Verifikasi Keberadaan dan Validitas Tautan Lupa Password dan Registrasi (@ui)',
      ),
      testId: id13.testId,
      covers: ac(13),
      priority: 'medium',
      layer: 'FE',
      role: roleName,
      precondition: `Pengguna berada di halaman \`${state.baseUrl}${loginUrl}\`.`,
      inputLines: [
        'forgotPasswordHref: literal:/forgot-password',
        'registerHref: literal:/register',
      ],
      steps: [
        'Buka halaman login',
        'Periksa keberadaan elemen tautan "Lupa Kata Sandi?" atau "Forgot Password?"',
        'Periksa nilai atribut `href` pada tautan lupa kata sandi',
        'Periksa keberadaan elemen tautan "Daftar" atau "Sign Up"',
        'Periksa nilai atribut `href` pada tautan pendaftaran',
      ],
      results: [
        'Tautan lupa kata sandi tampil di halaman login dan atribut `href` mengarah ke path lupa password (misal `/forgot-password` atau memicu modal reset)',
        'Tautan registrasi akun baru tampil di halaman login dan atribut `href` mengarah ke path registrasi (misal `/register` atau `/signup`)',
        'Kedua tautan terlihat jelas dan berstatus enabled',
      ],
    });

    return [
      scTogglePass,
      scTrimWhitespace,
      scEnterSubmit,
      scRememberMe,
      scCaseInsensitive,
      scSecondaryLinks,
    ].join('\n---\n\n');
  })();

  const tier3Scenarios = (() => {
    const ac = (n: number) => `\`AC-${String(n + acOffset).padStart(2, '0')}\``;
    const logoutButtons = formatList(DEFAULT_LOGOUT_BUTTONS);

    const id14 = take();
    const scDeepLink = scenarioBlock({
      heading: id14.heading(
        'Akses Halaman Protected Tanpa Login Mengarahkan ke Login (@access-restriction)',
      ),
      testId: id14.testId,
      covers: ac(14),
      priority: 'high',
      layer: 'FE BE',
      role: roleName,
      precondition: `Pengguna belum login (tidak ada sesi tersimpan). Aplikasi memiliki area protected setelah login (mis. \`${successUrlPath}\`).`,
      inputLines: ['protectedPath: literal:/dashboard'],
      steps: [
        'Buka langsung path protected dari address bar (nilai di Input Data)',
        'Tunggu aplikasi selesai melakukan redirect',
      ],
      results: [
        `URL diarahkan ke halaman login (pathname mengandung \`${loginUrl}\`)`,
        'Konten halaman protected tidak ditampilkan sama sekali',
        'Tidak terjadi error 5xx atau halaman error',
      ],
    });

    const id15 = take();
    const scReloadSession = scenarioBlock({
      heading: id15.heading('Sesi Tetap Aktif Setelah Reload Halaman (@success)'),
      testId: id15.testId,
      covers: ac(15),
      priority: 'high',
      layer: 'FE BE',
      role: roleName,
      precondition: `Kredensial valid tersedia. Pengguna sudah login sukses dan berada di \`${successUrlPath}\`.`,
      inputLines: [`identifier: ${identCred}`, `password: ${credentialKey(roleName, 'password')}`],
      steps: [
        'Login dengan kredensial valid',
        'Reload halaman (refresh browser)',
        'Periksa status login pada halaman yang termuat ulang',
      ],
      results: [
        'Setelah reload, pengguna tetap dalam keadaan login (form login tidak tampil)',
        `URL tetap berada di area \`${successUrlPath}\``,
        'Elemen khas pengguna yang sudah login (menu/nama akun) masih tampil',
      ],
    });

    const id16 = take();
    const scBrowserBack = scenarioBlock({
      heading: id16.heading('Navigasi Back Browser Setelah Login Tidak Mengakhiri Sesi (@success)'),
      testId: id16.testId,
      covers: ac(16),
      priority: 'medium',
      layer: 'FE',
      role: roleName,
      precondition: `Kredensial valid tersedia. Pengguna sudah login sukses ke \`${successUrlPath}\`.`,
      inputLines: [`identifier: ${identCred}`, `password: ${credentialKey(roleName, 'password')}`],
      steps: [
        'Login dengan kredensial valid',
        'Tekan tombol back pada browser',
        'Akses kembali path sukses dari address bar (nilai di Input Data)',
      ],
      results: [
        'Pengguna tetap dalam keadaan login — aplikasi tidak meminta login ulang',
        `Akses ulang \`${successUrlPath}\` berhasil tanpa form login`,
      ],
    });

    const id17 = take();
    const scDoubleSubmit = scenarioBlock({
      heading: id17.heading('Klik Ganda Tombol Submit Tidak Memproses Login Dua Kali (@ui)'),
      testId: id17.testId,
      covers: ac(17),
      priority: 'medium',
      layer: 'FE',
      role: roleName,
      precondition: `Pengguna di \`${state.baseUrl}${loginUrl}\`, kredensial valid.`,
      inputLines: [`identifier: ${identCred}`, `password: ${credentialKey(roleName, 'password')}`],
      steps: [
        'Isi field login dan password dengan kredensial valid',
        'Klik tombol submit dua kali secara cepat (double click)',
        'Tunggu proses otentikasi selesai',
      ],
      results: [
        'Tombol submit menjadi disabled atau menampilkan indikator loading selama proses',
        'Tidak terjadi error duplikasi atau kegagalan yang tampil di UI',
        'Pengguna berada di area sukses setelah proses selesai',
      ],
    });

    const id18 = take();
    const scXssIdentifier = scenarioBlock({
      heading: id18.heading(
        'Identifier Berisi Karakter HTML dan Script Tidak Dieksekusi (@failure)',
      ),
      testId: id18.testId,
      covers: ac(18),
      priority: 'medium',
      layer: 'FE BE',
      role: roleName,
      precondition: `Pengguna di \`${state.baseUrl}${loginUrl}\`. Nilai identifier di bawah adalah markup fiktif, bukan akun real.`,
      inputLines: [
        'identifier: literal:`<script>alert("xss")</script>`',
        `password: ${credentialKey(roleName, 'password')}`,
      ],
      steps: [
        'Isi field login dengan literal markup (nilai di Input Data)',
        `Isi field password (${passwordFields})`,
        `Klik tombol submit (${submitButtons})`,
      ],
      results: [
        'Nilai identifier dirender sebagai teks biasa (di-escape), bukan dieksekusi sebagai script',
        'Tidak ada dialog/alert browser yang muncul',
        `Tetap berada di \`${loginUrl}\` dengan pesan validasi atau error`,
      ],
    });

    const id19 = take();
    const scLogout = scenarioBlock({
      heading: id19.heading(
        'Logout Mengakhiri Sesi dan Melindungi Halaman Kembali (@access-restriction)',
      ),
      testId: id19.testId,
      covers: ac(19),
      priority: 'low',
      layer: 'FE BE',
      role: roleName,
      precondition: `Kredensial valid tersedia. Pengguna sudah login sukses.`,
      inputLines: [`logoutButton: literal:(${DEFAULT_LOGOUT_BUTTONS.join(' | ')})`],
      steps: [
        'Login dengan kredensial valid',
        `Klik menu atau tombol logout (${logoutButtons})`,
        'Konfirmasi logout jika dialog konfirmasi tampil',
        'Akses ulang path sukses dari address bar',
      ],
      results: [
        `Setelah logout, aplikasi mengarahkan ke halaman login (\`${loginUrl}\`)`,
        `Akses ulang \`${successUrlPath}\` diarahkan kembali ke \`${loginUrl}\` — sesi benar-benar berakhir`,
      ],
    });

    return [
      scDeepLink,
      scReloadSession,
      scBrowserBack,
      scDoubleSubmit,
      scXssIdentifier,
      scLogout,
    ].join('\n---\n\n');
  })();

  return (
    `## Skenario Uji\n\n` +
    negatives +
    (includeAutoSuccess ? `\n---\n\n` + scSuccess : extra) +
    `\n---\n\n` +
    tier2Scenarios +
    `\n---\n\n` +
    tier3Scenarios
  );
}

function ssoScenarios(state: LoginTemplateState): string {
  return (
    `## Skenario Uji\n\n` +
    scenarioBlock({
      heading: 'SC-01: Login via SSO (@manual)',
      testId: 'TC-LOGIN-SSO-001',
      covers: '`AC-01`, `AC-02`',
      layer: 'FE',
      precondition: `SSO provider (Google/Microsoft/OAuth) sudah terkonfigurasi di \`${state.baseUrl}\`.`,
      inputLines: ['provider: literal:sso'],
      steps: [
        'Buka halaman login',
        'Klik tombol SSO (label spesifik aplikasi)',
        'Pilih akun SSO yang sesuai',
        'Selesaikan alur OAuth sampai kembali ke aplikasi',
      ],
      results: [
        `URL pathname mengandung \`${state.successUrlPath}\` **DAN TIDAK** mengandung \`${state.loginUrl}\``,
        'User teridentifikasi sesuai akun SSO yang dipilih',
        'Tidak bisa diotomasi: popup OAuth, MFA, dan consent screen provider eksternal tidak dijalankan dari CI. Tracking: `npm run manual:check`.',
      ],
    }) +
    `\n---\n\n` +
    `## Catatan untuk Hermes\n\n` +
    `Aplikasi ini memakai SSO. Setelah setup selesai, minta Hermes:\n\n` +
    `> \`Tolong buat tests/auth.setup.ts untuk SSO login di ${state.baseUrl}${state.loginUrl}\`\n\n` +
    `Setelah auth.setup.ts siap, requirement ini bisa diotomasi dengan ` +
    `menambahkan storageState per-role (\`.auth/{APP_ENV}/<role>.json\`) dan menghapus tag \`(@manual)\`.\n\n`
  );
}

function noneScenarios(state: LoginTemplateState): string {
  return (
    `## Skenario Uji\n\n` +
    scenarioBlock({
      heading: 'SC-01: Halaman Utama Termuat Tanpa Login (@success)',
      testId: 'TC-PUBLIC-001',
      covers: '`AC-01`, `AC-02`',
      layer: 'FE',
      precondition: `Aplikasi berjalan di \`${state.baseUrl}\` tanpa mekanisme login.`,
      inputLines: [`url: literal:${state.baseUrl}/`],
      steps: ['Buka halaman utama', 'Tunggu halaman termuat (konten visible)'],
      results: [
        'URL bukan halaman error (status bukan 4xx/5xx)',
        'Body halaman memiliki konten visible (text content > 0)',
        'Tidak ada form login yang tampil (mechanism: none)',
      ],
    })
  );
}

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
    `- Report: \`artifacts/reports/pipeline-report-*.md\` + \`artifacts/reports/custom-dashboard.html\`\n`
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
