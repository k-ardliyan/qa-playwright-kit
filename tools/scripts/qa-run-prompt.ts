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

export interface AgentPromptOptions {
  baseUrl?: string;
  appEnv?: string;
}

/**
 * Build Hermes paste prompt tailored to the requirement (not always login-centric).
 */
export function buildAgentPrompt(
  reqRelPath: string,
  markdown: string,
  lang: WizardLang,
  options?: AgentPromptOptions,
): string {
  const hints = parseRequirementPromptHints(markdown);
  const loginLike = isLoginRequirement(reqRelPath, markdown);
  const startHint = hints.startPage || '/';

  const rawBaseUrl = (options?.baseUrl || process.env.BASE_URL || '').trim();
  const baseUrl = rawBaseUrl.replace(/\/+$/, '');
  const appEnv = (options?.appEnv || process.env.APP_ENV || 'local').trim();

  const targetUrl = baseUrl
    ? `${baseUrl}${startHint.startsWith('/') ? startHint : '/' + startHint}`
    : `BASE_URL${startHint.startsWith('/') ? startHint : '/' + startHint}`;

  const featureName = loginLike ? 'auth' : 'default';
  const pageName = startHint.replace(/^\//, '') || (loginLike ? 'login' : 'home');

  const executionGuidance = t(
    lang,
    `[ARAHAN EKSEKUSI]\n` +
      `Jalankan pipeline dalam mode otomatis untuk ${reqRelPath} (orchestrator: AGENTS.md).\n` +
      `Lanjutkan pengerjaan secara mandiri sampai tuntas hingga laporan akhir terbit. Jika menemukan kendala di tengah jalan (error konfigurasi, selector DOM berbeda, linter, atau test failure), jangan berhenti: langsung lakukan diagnosa dan perbaikan di tempat (in-flight fix / self-heal), lalu lanjutkan eksekusi pipeline sampai selesai.`,
    `[EXECUTION GUIDANCE]\n` +
      `Run the pipeline in automatic mode for ${reqRelPath} (orchestrator: AGENTS.md).\n` +
      `Proceed autonomously to completion until the final report is generated. If any issues arise along the way (config errors, DOM selector mismatches, linter or test failures), do not stop: diagnose and fix them in-flight (self-heal), then resume and finish the pipeline run.`,
  );

  const preflight = t(
    lang,
    `[PRE-FLIGHT & VALIDASI]\n` +
      `Alur awal: panggil health_check (Phase 0). Jika ada warning/error ringan, perbaiki konfigurasi di tempat lalu jalankan validasi/kompilasi requirement via compile_requirement atau validate_requirement (Phase 0.5). Simpan rolesInScope dan metadata sebelum masuk ke fase Plan.`,
    `[PRE-FLIGHT & VALIDATION]\n` +
      `Initial flow: call health_check (Phase 0). If any minor warning/error occurs, fix configuration in-place then validate/compile the requirement via compile_requirement or validate_requirement (Phase 0.5). Store rolesInScope and metadata before entering the Plan stage.`,
  );

  const uiInspectionLines: string[] = [
    t(lang, '[INSPEKSI UI & DISCOVERY]', '[UI INSPECTION & DISCOVERY]'),
  ];

  if (loginLike) {
    uiInspectionLines.push(
      t(lang, 'Ini requirement LOGIN / first-auth.', 'This is a LOGIN / first-auth requirement.'),
      t(
        lang,
        `Sebelum Plan/Generate: panggil snapshot_page di URL target: ${targetUrl} (featureName: "${featureName}", pageName: "${pageName}").`,
        `BEFORE Plan/Generate: call snapshot_page on target URL: ${targetUrl} (featureName: "${featureName}", pageName: "${pageName}").`,
      ),
      t(
        lang,
        'Gunakan locator dari selector-catalog (Path A, tanpa POM); live-verify karena setiap website berbeda.',
        'Use selector-catalog locators (Path A, no POM); live-verify — every website differs.',
      ),
      t(
        lang,
        'Jika form/input belum ketemu atau namanya berbeda di DOM (mis. id/placeholder kustom), lakukan live debug & inspection via snapshot_page (MCP qa-playwright-kit) atau browser_snapshot / browser_generate_locator (MCP playwright) untuk mendapatkan selector yang tepat.',
        'If form inputs are not found or have unexpected names in the DOM (e.g. custom id/placeholder), perform live debug & inspection via snapshot_page (qa-playwright-kit MCP) or browser_snapshot / browser_generate_locator (playwright MCP) to discover accurate selectors.',
      ),
    );
    if (hints.challengeMode && hints.challengeMode !== 'none') {
      uiInspectionLines.push(
        t(
          lang,
          `Tantangan setelah password terdeteksi. Jika file .auth/${appEnv} belum ada, jalankan npm run auth:setup (OTP/CAPTCHA: auth:setup:headed) dulu — skenario challenge tetap (@manual).`,
          `A post-password challenge was detected. If .auth/${appEnv} files are missing, run npm run auth:setup (OTP/CAPTCHA: auth:setup:headed) first — challenge scenarios stay (@manual).`,
        ),
      );
    }
  } else if (hints.authState === 'authenticated') {
    const roles = hints.roleScope || 'user (default)';
    uiInspectionLines.push(
      t(
        lang,
        `Auth state: authenticated. Roles in scope: ${roles}.`,
        `Auth state: authenticated. Roles in scope: ${roles}.`,
      ),
      t(
        lang,
        `Pastikan .auth/${appEnv}/<role>.json ada (npm run auth:setup) sebelum Execute.`,
        `Ensure .auth/${appEnv}/<role>.json exists (npm run auth:setup) before Execute.`,
      ),
      t(
        lang,
        `Sebelum Plan/Generate: snapshot_page di URL target: ${targetUrl} (featureName: "${featureName}", pageName: "${pageName}") jika selector-catalog belum ada/stale.`,
        `BEFORE Plan/Generate: snapshot_page on target URL: ${targetUrl} (featureName: "${featureName}", pageName: "${pageName}") when catalog is missing/stale.`,
      ),
      t(
        lang,
        'Prefer inline locator dari selector-catalog (Path A) kecuali metadata mendaftar POM.',
        'Prefer Path A inline locators from selector-catalog unless POM is listed in metadata.',
      ),
    );
  } else {
    uiInspectionLines.push(
      t(
        lang,
        `Auth state: ${hints.authState === 'unauthenticated' ? 'unauthenticated' : 'unknown (cek Metadata)'}.`,
        `Auth state: ${hints.authState === 'unauthenticated' ? 'unauthenticated' : 'unknown (check Metadata)'}.`,
      ),
      t(
        lang,
        `Sebelum Plan/Generate: snapshot_page di URL target: ${targetUrl} (featureName: "${featureName}", pageName: "${pageName}") jika selector-catalog belum ada/stale.`,
        `BEFORE Plan/Generate: snapshot_page on target URL: ${targetUrl} (featureName: "${featureName}", pageName: "${pageName}") when catalog is missing/stale.`,
      ),
      t(
        lang,
        'Jangan terapkan instruksi khusus login.md-only kecuali requirement ini benar-benar tentang login.',
        'Do NOT apply login.md-only instructions unless this requirement is actually about login.',
      ),
    );
  }

  const dataContract = t(
    lang,
    `[KONTRAK DATA & STEP]\n` +
      `- Kontrak kolom dashboard: Test Step = teks Langkah verbatim (aksi UI saja). Input Data = isi Input Data via setTestMetadata.inputData. Expected = Hasil yang Diharapkan verbatim.\n` +
      `- [CEK KETAT] Langsung dari requirement, jangan masukkan email, username, phone, password, OTP, kode, nomor rekaman, atau nilai kredensial ke dalam judul test.step. Semua nilai contoh/seed/credential/fixture Wajib hanya di blok Input Data atau setTestMetadata.inputData.\n` +
      `- Jadikan Input Data sebagai sumber tunggal untuk nilai uji. Jika Planner/Generator menemukan token email/password/phone/OTP/numeric literal di dalam langkah/step, pindahkan ke Input Data; jangan mencetaknya di Test Step.`,
    `[DATA CONTRACT & STEP TITLES]\n` +
      `- Dashboard column contract: Test Step = Langkah verbatim (UI actions only). Input Data = Input Data content via setTestMetadata.inputData. Expected = Expected Result verbatim.\n` +
      `- [HARD RULE] From the requirement, do NOT place email, username, phone, password, OTP, code, record number, or credential values into test.step titles. All sample/seed/credential/fixture values MUST stay in the Input Data block or setTestMetadata.inputData only.\n` +
      `- Treat Input Data as the single source of truth for test values. If Planner/Generator finds email/password/phone/OTP/numeric-literal tokens inside a step, move it to Input Data; do not render it in Test Step.`,
  );

  const codeQuality = t(
    lang,
    `[KUALITAS KODE]\n` +
      `- Zero \`any\` (gunakan \`Page\`/\`Locator\`). Import wajib dari \`./fixtures\` / \`@/support/test-metadata\` (bukan \`../src/\`).\n` +
      `- Tanpa \`if/catch\` kondisional di assertion (wajib deterministik \`expect(locator).toBeVisible()\`).\n` +
      `- Tanpa helper global \`any\` — pakai locator semantik (\`getByRole\`, \`getByLabel\`) atau POM.\n` +
      `- Kode wajib lolos \`npx eslint <spec>\` dan \`npx tsc --noEmit\` bersih.`,
    `[CODE QUALITY]\n` +
      `- Zero \`any\` (use \`Page\`/\`Locator\`). Import strictly from \`./fixtures\` / \`@/support/test-metadata\` (no \`../src/\`).\n` +
      `- No conditional \`if/catch\` inside assertions (must be deterministic \`expect(locator).toBeVisible()\`).\n` +
      `- No loose \`any\` helpers — use semantic locators (\`getByRole\`, \`getByLabel\`) or POM.\n` +
      `- Generated code must pass \`npx eslint <spec>\` and \`npx tsc --noEmit\` cleanly.`,
  );

  const reporting = t(
    lang,
    `[LAPORAN & PENYELESAIAN]\n` +
      `- Resume dari artifacts/reports/pipeline-state.json HANYA jika requirementPath-nya cocok dengan file ini; jika tidak, mulai run baru.\n` +
      `- Pipeline: Health Check (0) → Validate Req (0.5) → Plan (1) → Generate (2) → Execute (3) → Heal (4, maks 3 siklus) → Report (5) → archive_report.\n` +
      `- Tutup respon akhir dengan: summary pass/fail, daftar file spec/plan/report yang dibuat, QA decision, dan instruksi "Jalankan \`npm run dashboard\` untuk melihat laporan interaktif".`,
    `[REPORTING & COMPLETION]\n` +
      `- Resume from artifacts/reports/pipeline-state.json ONLY if its requirementPath matches this file; otherwise start a fresh run.\n` +
      `- Pipeline: Health Check (0) → Validate Req (0.5) → Plan (1) → Generate (2) → Execute (3) → Heal (4, max 3 cycles) → Report (5) → archive_report.\n` +
      `- End your final response with: pass/fail summary, list of generated spec/plan/report files, QA decision, and instruction "Run \`npm run dashboard\` to open the interactive dashboard".`,
  );

  const sections = [
    executionGuidance,
    preflight,
    uiInspectionLines.join('\n'),
    dataContract,
    codeQuality,
    reporting,
  ];

  return `${sections.join('\n\n')}\n`;
}
