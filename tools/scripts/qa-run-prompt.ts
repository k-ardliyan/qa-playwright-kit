/**
 * Hermes paste-prompt builder for qa:run (pure helpers — safe to unit test).
 */

import { type WizardLang, t } from '../../src/setup/i18n';

/** Lightweight metadata from requirement markdown for prompt tailoring. */
export function parseRequirementPromptHints(markdown: string): {
  authState: 'authenticated' | 'unauthenticated' | 'unknown';
  startPage: string | null;
  roleScope: string | null;
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
  return { authState, startPage, roleScope };
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
      'File katalog requirements/auth/login-<mode>.md sesuai AUTH_CHALLENGE_MODE; setup menulis requirements/login.md untuk situs live.',
      'Catalog files under requirements/auth/login-<mode>.md match AUTH_CHALLENGE_MODE; setup writes requirements/login.md for the live site.',
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
      'Kembalikan summary, unresolvedFailures, path katalog (jika ada), serta path dashboard/report.',
      'Return summary, unresolvedFailures, catalog path (if any), and dashboard/report path.',
    ),
  );

  return `${lines.join('\n')}\n`;
}
