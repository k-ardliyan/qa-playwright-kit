/**
 * Hermes paste-prompt builder for qa:run (pure helpers — safe to unit test).
 */

import { type WizardLang, t } from '../../src/setup/i18n';

/** Lightweight metadata from requirement markdown for prompt tailoring. */
export function parseRequirementPromptHints(markdown: string): {
  authState: 'authenticated' | 'unauthenticated' | 'unknown';
  startPage: string | null;
  roleScope: string | null;
  challengeMode: 'none' | 'auto' | 'otp-browser' | 'otp-stdin' | 'captcha-browser' | null;
} {
  const authRaw =
    markdown
      .match(/^\s*-\s+\*\*Auth state:\*\*\s*(.+)$/im)?.[1]
      ?.trim()
      .toLowerCase() ?? '';
  const authState =
    authRaw === 'authenticated'
      ? 'authenticated'
      : authRaw === 'unauthenticated'
        ? 'unauthenticated'
        : 'unknown';
  const startPage = markdown.match(/^\s*-\s+\*\*Halaman awal:\*\*\s*(\S+)/im)?.[1]?.trim() ?? null;
  const roleScope = markdown.match(/^\s*-\s+\*\*Role scope:\*\*\s*(.+)$/im)?.[1]?.trim() ?? null;
  const challengeRaw = markdown.match(
    /AUTH_CHALLENGE_MODE=(none|auto|otp-browser|otp-stdin|captcha-browser)/,
  )?.[1] as 'none' | 'auto' | 'otp-browser' | 'otp-stdin' | 'captcha-browser' | undefined;
  return { authState, startPage, roleScope, challengeMode: challengeRaw ?? null };
}

function isLoginRequirement(reqRelPath: string, markdown: string): boolean {
  const norm = reqRelPath.replace(/\\/g, '/').toLowerCase();
  if (/(^|\/)login\.md$/.test(norm) || /\/login[-_]/.test(norm)) return true;
  const title = markdown.match(/^#\s+REQ-[^:]+:\s*(.+)$/m)?.[1]?.toLowerCase() ?? '';
  return /\blogin\b|\bautentikasi\b|\bsign[\s-]?in\b/.test(title);
}

/**
 * Build Hermes paste prompt tailored to the requirement (not always login-centric).
 */
export function buildAgentPrompt(reqRelPath: string, markdown: string, lang: WizardLang): string {
  const hints = parseRequirementPromptHints(markdown);
  const loginLike = isLoginRequirement(reqRelPath, markdown);
  const startHint = hints.startPage || '/';
  const lines: string[] = [
    t(
      lang,
      `Jalankan pipeline dalam mode otomatis untuk ${reqRelPath} (orchestrator: AGENTS.md).`,
      `Run the pipeline in automatic mode for ${reqRelPath} (orchestrator: AGENTS.md).`,
    ),
    t(
      lang,
      'Langkah pertama: panggil health_check (qa-playwright-kit MCP). Jika ada check fail, STOP dan laporkan — jangan lanjut ke Plan.',
      'First step: call health_check (qa-playwright-kit MCP). If any check fails, STOP and report — do not continue to Plan.',
    ),
    t(
      lang,
      'Kontrak kolom dashboard: Test Step = teks Langkah verbatim (aksi UI saja). Input Data = isi Input Data via setTestMetadata.inputData. Expected = Hasil yang Diharapkan verbatim.',
      'Dashboard column contract: Test Step = Langkah verbatim (UI actions only). Input Data = Input Data content via setTestMetadata.inputData. Expected = Expected Result verbatim.',
    ),
  ];

  lines.push(
    t(
      lang,
      '[[ CEK KETAT ]] Langsung dari requirement, jangan masukkan email, username, phone, password, OTP, kode, nomor rekaman, atau nilai kredensial ke dalam judul test.step. Semua nilai contoh/seed/credential/fixture Wajib hanya di blok Input Data atau setTestMetadata.inputData.',
      '[[ HARD RULE ]] From the requirement, do NOT place email, username, phone, password, OTP, code, record number, or credential values into test.step titles. All sample/seed/credential/fixture values MUST stay in the Input Data block or setTestMetadata.inputData only.',
    ),
  );

  if (loginLike) {
    lines.push(
      t(lang, 'Ini requirement LOGIN / first-auth.', 'This is a LOGIN / first-auth requirement.'),
      t(
        lang,
        `Sebelum Plan/Generate: panggil snapshot_page di BASE_URL + path login (Halaman awal: ${startHint}).`,
        `BEFORE Plan/Generate: call snapshot_page on real BASE_URL + login path (Halaman awal: ${startHint}).`,
      ),
      t(
        lang,
        'Gunakan locator dari selector-catalog (Path A, tanpa POM); live-verify karena setiap website berbeda.',
        'Use selector-catalog locators (Path A, no POM); live-verify — every website differs.',
      ),
    );
    if (hints.challengeMode && hints.challengeMode !== 'none') {
      lines.push(
        t(
          lang,
          'Tantangan setelah password terdeteksi. Jika file .auth/{APP_ENV} belum ada, jalankan npm run auth:setup (OTP/CAPTCHA: auth:setup:headed) dulu — skenario challenge tetap (@manual).',
          'A post-password challenge was detected. If .auth/{APP_ENV} files are missing, run npm run auth:setup (OTP/CAPTCHA: auth:setup:headed) first — challenge scenarios stay (@manual).',
        ),
      );
    }
  } else if (hints.authState === 'authenticated') {
    const roles = hints.roleScope || 'user (default)';
    lines.push(
      t(
        lang,
        `Auth state: authenticated. Roles in scope: ${roles}.`,
        `Auth state: authenticated. Roles in scope: ${roles}.`,
      ),
      t(
        lang,
        'Pastikan .auth/{APP_ENV}/<role>.json ada (npm run auth:setup) sebelum Execute.',
        'Ensure .auth/{APP_ENV}/<role>.json exists (npm run auth:setup) before Execute.',
      ),
      t(
        lang,
        `Sebelum Plan/Generate: snapshot_page di BASE_URL + Halaman awal (${startHint}) jika selector-catalog belum ada/stale.`,
        `BEFORE Plan/Generate: snapshot_page on BASE_URL + Halaman awal (${startHint}) when catalog is missing/stale.`,
      ),
      t(
        lang,
        'Prefer inline locator dari selector-catalog (Path A) kecuali metadata mendaftar POM.',
        'Prefer Path A inline locators from selector-catalog unless POM is listed in metadata.',
      ),
    );
  } else {
    lines.push(
      t(
        lang,
        `Auth state: ${hints.authState === 'unauthenticated' ? 'unauthenticated' : 'unknown (cek Metadata)'}.`,
        `Auth state: ${hints.authState === 'unauthenticated' ? 'unauthenticated' : 'unknown (check Metadata)'}.`,
      ),
      t(
        lang,
        `Sebelum Plan/Generate: snapshot_page di BASE_URL + Halaman awal (${startHint}) jika selector-catalog belum ada/stale.`,
        `BEFORE Plan/Generate: snapshot_page on BASE_URL + Halaman awal (${startHint}) when catalog is missing/stale.`,
      ),
      t(
        lang,
        'Jangan terapkan instruksi khusus login.md-only kecuali requirement ini benar-benar tentang login.',
        'Do NOT apply login.md-only instructions unless this requirement is actually about login.',
      ),
    );
  }

  lines.push(
    t(
      lang,
      'Jadikan Input Data sebagai sumber tunggal untuk nilai uji. Jika Planner/Generator menemukan token email/password/phone/OTP/numeric literal di dalam langkah/step, pindahkan ke Input Data; jangan mencetaknya di Test Step.',
      'Treat Input Data as the single source of truth for test values. If Planner/Generator finds email/password/phone/OTP/numeric-literal tokens inside a step, move it to Input Data; do not render it in Test Step.',
    ),
    t(
      lang,
      '[[ KUALITAS KODE TYPESCRIPT & ESLINT ]]\n' +
        '- Zero `any` (gunakan `Page`/`Locator`). Import wajib dari `./fixtures` / `@/support/test-metadata` (bukan `../src/`).\n' +
        '- Tanpa `if/catch` kondisional di assertion (wajib deterministik `expect(locator).toBeVisible()`).\n' +
        '- Tanpa helper global `any` — pakai locator semantik (`getByRole`, `getByLabel`) atau POM.\n' +
        '- Kode wajib lolos `npx eslint <spec>` dan `npx tsc --noEmit` bersih.',
      '[[ TYPESCRIPT & ESLINT CODE QUALITY ]]\n' +
        '- Zero `any` (use `Page`/`Locator`). Import strictly from `./fixtures` / `@/support/test-metadata` (no `../src/`).\n' +
        '- No conditional `if/catch` inside assertions (must be deterministic `expect(locator).toBeVisible()`).\n' +
        '- No loose `any` helpers — use semantic locators (`getByRole`, `getByLabel`) or POM.\n' +
        '- Generated code must pass `npx eslint <spec>` and `npx tsc --noEmit` cleanly.',
    ),
    t(
      lang,
      'Resume dari reports/pipeline-state.json HANYA jika requirementPath-nya cocok dengan file ini; jika tidak, mulai run baru.',
      'Resume from reports/pipeline-state.json ONLY if its requirementPath matches this file; otherwise start a fresh run.',
    ),
    t(
      lang,
      'Pipeline: Plan → Generate → Execute → Heal (maks 3 siklus) → Report → archive_report.',
      'Pipeline: Plan → Generate → Execute → Heal (max 3 cycles) → Report → archive_report.',
    ),
    t(
      lang,
      'Tutup respon akhir dengan: summary pass/fail, daftar file spec/plan/report yang dibuat, QA decision, dan instruksi "Jalankan `npm run dashboard` untuk melihat laporan interaktif".',
      'End your final response with: pass/fail summary, list of generated spec/plan/report files, QA decision, and instruction "Run `npm run dashboard` to open the interactive dashboard".',
    ),
  );

  return `${lines.join('\n')}\n`;
}
