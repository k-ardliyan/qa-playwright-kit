/// <reference types="node" />
/**
 * wizard-login-template — Render requirements/login.md from WizardState.
 *
 * Pure function: no I/O, no network. Unit-testable.
 * Renderer untuk requirements/login.md. Tidak di-wire ke src/setup saat ini.
 *
 * File ini = requirement REAL per project (BASE_URL + path + roles dari wizard),
 * BUKAN sample format di requirements/sample-*.md.
 *
 * Vocabulary:
 * - Credential role default = **user** (TEST_USER_*)
 * - Pipeline mode **general** = non-role-aware (auth → user), not an env role name
 *
 * @module scripts/wizard-login-template
 */

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

function canonicalRole(name: string): string {
  const n = name.trim().toLowerCase();
  if (n === 'default' || n === 'general' || n === '') return 'user';
  return n;
}

function envPrefixFor(role: RoleSpec): string {
  const n = canonicalRole(role.name);
  return n === 'user' ? 'TEST_USER' : n.toUpperCase().replace(/-/g, '_');
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

function frontmatter(title: string): string {
  return (
    `${title}\n\n` +
    `<!--\n` +
    `  AUTO-GENERATED oleh setup Phase 7 dari nilai REAL project (BASE_URL, login path, roles).\n` +
    `  Ini BUKAN sample format — sample ada di requirements/sample-*.md.\n` +
    `  Locator berbeda per website: Generator WAJIB snapshot_page dulu, lalu live-verify selector.\n` +
    `  Jangan tulis password/secret di file ini.\n` +
    `-->\n\n`
  );
}

function metadata(state: LoginTemplateState, halamanAwal: string): string {
  const tags = `#auth #ui #smoke`;
  const lines: string[] = [
    '## Metadata',
    '',
    `- **Tags:** ${tags}`,
    `- **Prioritas:** high`,
    `- **Auth state:** unauthenticated`,
    `- **Halaman awal:** ${halamanAwal}`,
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

function formScenarios(state: LoginTemplateState): string {
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

  return (
    `## Skenario Uji\n\n` +
    `### SC-01: Login Gagal dengan User Fiktif (@failure)\n\n` +
    `- **Test ID:** TC-LOGIN-001\n` +
    `- **Prioritas skenario:** high\n` +
    `- **Layer terdampak:** FE BE\n\n` +
    `**Prekondisi:** Aplikasi berjalan di \`${state.baseUrl}\`. Akun \`qa.invalid.user.not.exists\` ` +
    `**tidak ada** di sistem (user fiktif, bukan password salah pada akun real).\n\n` +
    `**Input Data:**\n\n` +
    `- field login: \`qa.invalid.user.not.exists\`\n` +
    `- field password: \`WrongPasswordInvalid!\`\n\n` +
    `**Langkah:**\n\n` +
    `1. Buka \`${state.baseUrl}${loginUrl}\`\n` +
    `2. Isi field login (${loginFields}) dengan \`qa.invalid.user.not.exists\`\n` +
    `3. Isi field password (${passwordFields}) dengan \`WrongPasswordInvalid!\`\n` +
    `4. Klik tombol submit (${submitButtons})\n\n` +
    `**Hasil yang Diharapkan:**\n\n` +
    `- URL tetap mengandung \`${loginUrl}\` (tidak redirect ke \`${successUrlPath}\`)\n` +
    `- Pesan error yang observable tampil di halaman (mis. "Email atau password salah")\n` +
    `- Tombol submit kembali enabled (tidak stuck loading)\n` +
    `- Akun role \`${roleName}\` **tidak terkunci** — user fiktif di luar scope lockout\n\n` +
    `---\n\n` +
    `### SC-02: Login Berhasil dengan Kredensial Valid (@success)\n\n` +
    `- **Test ID:** TC-LOGIN-002\n` +
    `- **Prioritas skenario:** high\n` +
    `- **Layer terdampak:** FE BE\n\n` +
    `**Prekondisi:** Akun \`${envPrefix}_EMAIL\` (atau USERNAME/PHONE) terdaftar di aplikasi ` +
    `(lihat \`environments/{APP_ENV}.env\` — JANGAN tulis nilainya di sini).\n\n` +
    `**Input Data:**\n\n` +
    `- field login: nilai env \`${envPrefix}_EMAIL\` (atau USERNAME/PHONE sesuai preferensi)\n` +
    `- field password: nilai env \`${envPrefix}_PASSWORD\`\n\n` +
    `**Langkah:**\n\n` +
    `1. Buka \`${state.baseUrl}${loginUrl}\`\n` +
    `2. Isi field login (${loginFields}) dengan \`\${${envPrefix}_EMAIL}\`\n` +
    `3. Isi field password (${passwordFields}) dengan \`\${${envPrefix}_PASSWORD}\`\n` +
    `4. Klik tombol submit (${submitButtons})\n\n` +
    `**Hasil yang Diharapkan:**\n\n` +
    `- URL pathname mengandung \`${successUrlPath}\` **DAN TIDAK** mengandung \`${loginUrl}\`\n` +
    `- Form login tidak terlihat lagi (sudah diganti konten dashboard/beranda)\n` +
    `- Session tersimpan di \`${authFile}\` (atau \`.auth/{APP_ENV}/${roleName}.json\`) via auth.setup\n` +
    `- Tidak ada pesan error yang tampil\n\n`
  );
}

function ssoScenarios(state: LoginTemplateState): string {
  return (
    `## Skenario Uji\n\n` +
    `### SC-01: Login via SSO (@manual)\n\n` +
    `- **Test ID:** TC-LOGIN-SSO-001\n` +
    `- **Prioritas skenario:** high\n` +
    `- **Layer terdampak:** FE\n\n` +
    `**Prekondisi:** SSO provider (Google/Microsoft/OAuth) sudah terkonfigurasi di aplikasi.\n\n` +
    `**Langkah:**\n\n` +
    `1. Buka \`${state.baseUrl}${state.loginUrl}\`\n` +
    `2. Klik tombol SSO (label spesifik aplikasi)\n` +
    `3. Pilih akun SSO yang sesuai\n` +
    `4. Selesaikan alur OAuth sampai kembali ke aplikasi\n\n` +
    `**Hasil yang Diharapkan:**\n\n` +
    `- URL pathname mengandung \`${state.successUrlPath}\` **DAN TIDAK** mengandung \`${state.loginUrl}\`\n` +
    `- User teridentifikasi sesuai akun SSO yang dipilih\n\n` +
    `**Alasan manual:** SSO/OAuth membutuhkan interaksi dengan provider eksternal ` +
    `(popup, MFA, consent screen) yang tidak bisa diotomasi dari Playwright tanpa ` +
    `stub provider. Jalankan via \`npm run manual:check\` untuk tracking.\n\n` +
    `---\n\n` +
    `### Catatan untuk Hermes\n\n` +
    `Aplikasi ini memakai SSO. Setelah setup selesai, minta Hermes:\n\n` +
    `> \`Tolong buat src/support/auth.setup.ts untuk SSO login di ${state.baseUrl}${state.loginUrl}\`\n\n` +
    `Setelah auth.setup.ts siap, requirement ini bisa diotomasi dengan ` +
    `menambahkan storageState per-role (\`.auth/{APP_ENV}/<role>.json\`) dan menghapus tag \`(@manual)\`.\n\n`
  );
}

function noneScenarios(state: LoginTemplateState): string {
  return (
    `## Skenario Uji\n\n` +
    `### SC-01: Halaman Utama Termuat Tanpa Login (@success)\n\n` +
    `- **Test ID:** TC-PUBLIC-001\n` +
    `- **Prioritas skenario:** high\n` +
    `- **Layer terdampak:** FE\n\n` +
    `**Prekondisi:** Aplikasi berjalan di \`${state.baseUrl}\` tanpa mekanisme login.\n\n` +
    `**Input Data:**\n\n` +
    `- URL: \`${state.baseUrl}/\`\n\n` +
    `**Langkah:**\n\n` +
    `1. Buka \`${state.baseUrl}/\`\n` +
    `2. Tunggu halaman termuat (networkidle)\n\n` +
    `**Hasil yang Diharapkan:**\n\n` +
    `- URL bukan halaman error (status bukan 4xx/5xx)\n` +
    `- Body halaman memiliki konten visible (text content > 0)\n` +
    `- Tidak ada form login yang tampil (mechanism: none)\n\n`
  );
}

function footer(state: LoginTemplateState): string {
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
  return (
    `---\n\n` +
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
    `**2) Role & env**\n\n` +
    `- Akun kredensial default: role **\`user\`** (\`TEST_USER_*\`) — dipakai mode pipeline **general**\n` +
    `- Role aktif di requirement ini: \`${roleName}\` (roles: ${roleList})\n` +
    `- Multi-role: tambah via \`npm run env:edit\` + metadata Role scope (jangan buat role bernama \`general\`)\n` +
    `- Auth file: \`.auth/{APP_ENV}/<role>.json\` (helper: \`authStatePath('<role>')\`)\n` +
    `- Kredensial hanya dari env (\`TEST_USER_*\` / \`{ROLE}_*\`) — jangan hardcode secret\n` +
    `- Selector environment: **APP_ENV** saja (\`npm run env:status\` / \`env:use\`)\n\n` +
    `**3) Output pipeline**\n\n` +
    `- Plan: \`specs/login-test-plan.md\`\n` +
    `- Spec: \`src/tests/login*.spec.ts\`\n` +
    `- Report: \`reports/pipeline-report-*.md\` + \`reports/custom-dashboard.html\`\n`
  );
}

export function buildLoginRequirement(state: LoginTemplateState): string {
  const projectLabel = state.projectName || 'Target App';
  const title =
    state.mechanism === 'none'
      ? `# REQ-AUTH-001: Smoke Publik — ${projectLabel}`
      : `# REQ-AUTH-001: Login — ${projectLabel}`;

  let body = '';
  const halamanAwal = state.mechanism === 'none' ? '/' : state.loginUrl;

  body += frontmatter(title);
  body += metadata(state, halamanAwal);
  body += `## Kriteria Penerimaan\n\n`;

  if (state.mechanism === 'form') {
    const roleName = canonicalRole(state.roles[0]?.name ?? 'user');
    body +=
      `- Login gagal dengan kredensial invalid menampilkan pesan error observable dan tetap di halaman login\n` +
      `- Login berhasil dengan kredensial valid me-redirect ke path \`${state.successUrlPath}\` ` +
      `(assert pathname, bukan URL dengan \`?redirect=\`)\n` +
      `- Session tersimpan setelah login berhasil di \`.auth/{APP_ENV}/${roleName}.json\`\n` +
      `- Field form login menggunakan label/placeholder sesuai aplikasi (dideteksi Generator)\n` +
      `- Akun role \`${roleName}\` **tidak terkunci** setelah SC-01 (user fiktif)\n\n`;
    body += formScenarios(state);
  } else if (state.mechanism === 'sso') {
    body +=
      `- Login via SSO berhasil dan me-redirect ke path \`${state.successUrlPath}\`\n` +
      `- Session SSO tersimpan (browser cookies / id_token)\n\n`;
    body += ssoScenarios(state);
  } else {
    body +=
      `- Halaman utama \`${state.baseUrl}/\` termuat tanpa error\n` +
      `- Aplikasi tidak menampilkan form login (mechanism: none)\n` +
      `- Body halaman berisi konten visible\n\n`;
    body += noneScenarios(state);
  }

  body += footer(state);
  return body;
}
