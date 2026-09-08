/// <reference types="node" />
/**
 * wizard-login-scenarios — Scenario generators for wizard-login-template.
 *
 * Extracted from wizard-login-template to keep files cohesive and maintainable.
 *
 * @module scripts/wizard-login-scenarios
 */

import type { ChallengeMode } from '../../src/support/human-challenge';
import {
  type LoginTemplateState,
  type RoleSpec,
  canonicalRole,
  envPrefixFor,
} from './wizard-login-template';

export const DEFAULT_LOGIN_FIELDS = ['email', 'username', 'user'];
export const DEFAULT_PASSWORD_FIELDS = ['password', 'pass', 'kata sandi'];
export const DEFAULT_SUBMIT_BUTTONS = ['Masuk', 'Login', 'Sign in', 'Log in'];
export const DEFAULT_LOGOUT_BUTTONS = ['Logout', 'Keluar', 'Sign out'];

export function credentialKey(
  roleName: string,
  field: 'email' | 'username' | 'phone' | 'password',
): string {
  return `credential:${canonicalRole(roleName)}.${field}`;
}

export function identifierCredential(
  roleName: string,
  pref?: 'email' | 'username' | 'phone',
): string {
  return credentialKey(roleName, pref ?? 'email');
}

export function formatList(items: string[]): string {
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

export function scenarioBlock(opts: {
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

export function challengeManualScenario(
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

export function formScenarios(state: LoginTemplateState, challengeMode: ChallengeMode): string {
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
        'Isi field password dengan nilai dari Input Data',
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
        'Isi field login dengan nilai email ber-spasi dari Input Data',
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
        'Isi field login dengan nilai email kapital dari Input Data',
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

export function ssoScenarios(state: LoginTemplateState): string {
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
    `> \`Sesuaikan src/support/auth.setup.ts untuk SSO login di ${state.baseUrl}${state.loginUrl}; pertahankan tests/auth.setup.ts sebagai entrypoint setup Playwright.\`\n\n` +
    '`tests/auth.setup.ts` adalah entrypoint project setup yang mengimpor implementasi dari ' +
    '`src/support/auth.setup.ts`. Sesuaikan implementasi di `src/support/auth.setup.ts`, ' +
    'bukan mengganti entrypoint, lalu tambahkan storageState per-role (`.auth/{APP_ENV}/<role>.json`) ' +
    'dan hapus tag `(@manual)` setelah alur SSO dapat dijalankan otomatis.\n\n'
  );
}

export function noneScenarios(state: LoginTemplateState): string {
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
