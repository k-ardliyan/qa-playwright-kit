/**
 * Setup Wizard — core orchestrator.
 *
 * Interactive CLI wizard that guides users through:
 * 1. Language selection (Indonesian default, English opt-in)
 * 2. APP_ENV selection (final target resolved once)
 * 3. Application BASE_URL configuration
 * 4. Role credential entry (re-try on mismatch; back navigation)
 * 5. Auth challenge mode (OTP/CAPTCHA)
 * 6. Confirmation, clean env generation, encryption & artifact verification
 *
 * Post-confirmation automated phases:
 * - Write requirements/login.md & sync agent skills/MCP
 * - REAL artifact verification (deps, decrypt roundtrip, browser, artifacts)
 * - Summary & agent paste prompt
 *
 * Secret keys (`*_PASSWORD` / `*_SECRET` / `*_TOKEN`) are encrypted automatically
 * after write. URLs, flags, identifiers stay plaintext.
 *
 * Non-interactive mode (--check) validates existing setup without prompting.
 *
 * @module src/setup/wizard
 */

import { type AppEnv, resolveAppEnv } from '../utils/app-env';
import { type ChallengeMode } from '../support/human-challenge';
import { type WizardRoleInput } from '../shared/utils/role-credentials';
import {
  promptLanguage,
  promptAppEnv,
  promptBaseUrl,
  promptRoleCredentials,
  promptRoles,
  promptChallengeMode,
  confirmOverwrite,
  type RoleFields,
  BACK,
} from './wizard-prompts';
import { type WizardLang, t, DEFAULT_LANG } from './i18n';
import prompts from 'prompts';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  writeEnvFile,
  readExistingEnv,
  isEncryptedValue,
  resolveEnvPath,
  type EnvWriteResult,
} from './wizard-writer';

import { validateSetup, type ValidationResult } from './wizard-validate';
import { syncAgentSkillsAndMcp, type AgentSyncResult } from './agent-sync';
import { ensureBrowsers } from './browser-check';
import { openTerminalFor } from './terminal';
import { verifySetupArtifacts, type SetupCheck } from './verify-setup';
import { printBanner, printChecklist, printSection, printStep, stepLine } from './ui';
import {
  buildLoginRequirement,
  loginStateFromWizard,
  writeLoginRequirementFile,
} from '../../tools/scripts/wizard-login-template';
import { writeAuthSetup } from '../../tools/scripts/wizard-auth-template';
import { buildAgentPrompt } from '../../tools/scripts/qa-run-prompt';

// ─── Public types ────────────────────────────────────────────────────────────

export interface WizardOptions {
  /** Non-interactive mode: only validate, no prompts */
  checkOnly?: boolean;
  /** Override APP_ENV (default: resolve from existing) */
  appEnv?: AppEnv;
  /** Language override (default: Indonesian unless prompted) */
  lang?: WizardLang;
}

export interface WizardResult {
  /** Absolute path of the env file */
  envFilePath: string;
  /** Roles that were configured */
  roles: string[];
  /** Whether this was a new setup */
  isNewSetup: boolean;
  /** Validation result after write */
  validation: ValidationResult;
  /** Real artifact checks (deps, decrypt roundtrip, browser, files) */
  checks: SetupCheck[];
  /** Relative path of generated requirements/login.md (interactive run only) */
  loginRequirementPath?: string;
}

const TOTAL_STEPS = 6;

// ─── Main orchestrator ───────────────────────────────────────────────────────

/**
 * Run the setup wizard.
 *
 * Flow:
 * 1. Prompt language (unless pinned via --lang)
 * 2. Resolve the FINAL APP_ENV once (--env > prompt, default from pin/OS)
 * 3. Detect existing config for that env → show current state → update or keep
 * 4. Offer Playwright Chromium install if missing (runs in a parallel terminal)
 * 5. Prompt BASE_URL + validate reachable
 * 6. Prompt role credentials (back/mismatch handled inside prompts)
 * 7. Prompt AUTH_CHALLENGE_MODE
 * 8. Preview (masked) + confirm → generate clean env → encrypt secrets
 * 9. Write requirements/login.md; sync agent skills/MCP
 * 10. Verify artifacts for real (deps, keys, decrypt roundtrip, browser, files)
 * 11. Summary + next steps + Hermes prompt
 *
 * Non-secret keys stay plaintext. Re-encrypt after env:edit uses the same helper.
 */
export async function runSetupWizard(options?: WizardOptions): Promise<WizardResult> {
  const opts = options ?? {};

  let lang: WizardLang = opts.lang ?? DEFAULT_LANG;

  // ─── Check-only mode (no prompts) ───────────────────────────────────────
  if (opts.checkOnly) {
    const appEnv = opts.appEnv ?? resolveAppEnv({ repoRoot: process.cwd() }).appEnv;
    return runCheckOnly(appEnv, lang);
  }

  printBanner(lang);
  stepLine(
    t(
      lang,
      `${TOTAL_STEPS} langkah singkat — bahasa, environment, URL, kredensial, challenge, verifikasi.`,
      `${TOTAL_STEPS} short steps — language, environment, URL, credentials, challenge, verification.`,
    ),
  );

  // ─── Step 1: Language (skipped when pinned via --lang) ──────────────────
  printStep(1, TOTAL_STEPS, lang, 'Bahasa', 'Language');
  if (!opts.lang) {
    lang = await promptLanguage();
  }

  // ─── Step 2: APP_ENV — final target resolved ONCE (--env > prompt) ──────
  printStep(2, TOTAL_STEPS, lang, 'Environment (APP_ENV)', 'Environment (APP_ENV)');
  const defaultAppEnv = resolveAppEnv({ repoRoot: process.cwd() }).appEnv;
  const appEnv: AppEnv = opts.appEnv ?? (await promptAppEnv(lang, defaultAppEnv));

  // ─── Existing config check for the FINAL env ────────────────────────────
  const existing = readExistingEnv(appEnv);
  const envPath = resolveEnvPath(appEnv);

  if (existing) {
    describeExistingEnv(lang, existing);
    const shouldUpdate = await confirmOverwrite(lang, envPath);
    if (!shouldUpdate) {
      stepLine(
        t(
          lang,
          'Setup wizard dibatalkan — config yang ada dipertahankan.',
          'Setup wizard cancelled — keeping existing config.',
        ),
      );
      const validation = await validateSetup(appEnv, existing, envPath, lang);
      return {
        envFilePath: envPath,
        roles: [],
        isNewSetup: false,
        validation,
        checks: [],
      };
    }
  }

  // ─── Playwright browser availability (install runs in parallel) ─────────
  await ensureBrowsers(lang);

  // ─── Step 3: Prompt BASE_URL ────────────────────────────────────────────
  printStep(3, TOTAL_STEPS, lang, 'URL aplikasi (BASE_URL)', 'Application BASE_URL');
  const existingUrl =
    existing && !isEncryptedValue(existing['BASE_URL']) ? existing['BASE_URL'] : undefined;
  const baseUrl = await promptBaseUrl(lang, existingUrl);

  // ─── Step 4: Prompt roles (credentials + login/redirect paths) ──────────
  printStep(4, TOTAL_STEPS, lang, 'Kredensial & halaman role', 'Role credentials & pages');
  const existingRoles = existing ? detectExistingRoles(existing) : [];
  const roleNames = await promptRoles(lang, existingRoles.length > 0 ? existingRoles : undefined);

  const roleInputs: WizardRoleInput[] = [];

  for (const role of roleNames) {
    let fields: RoleFields | typeof BACK | undefined;
    do {
      const existingFields = existing ? getExistingRoleFields(existing, role) : undefined;
      fields = await promptRoleCredentials(lang, role, existingFields);
    } while (fields === BACK);
    roleInputs.push({ name: role, fields });
  }

  // ─── Step 5: Prompt challenge mode ──────────────────────────────────────
  printStep(5, TOTAL_STEPS, lang, 'Mode challenge (OTP/CAPTCHA)', 'Challenge mode (OTP/CAPTCHA)');
  const existingChallenge = existing?.['AUTH_CHALLENGE_MODE'];
  const challengeMode = await promptChallengeMode(lang, existingChallenge);

  // ─── Step 6: Preview (masked) + confirm before write ────────────────────
  printStep(6, TOTAL_STEPS, lang, 'Konfirmasi & verifikasi', 'Confirm & verify');
  printPreview({
    lang,
    appEnv,
    baseUrl,
    roles: roleInputs,
    challengeMode,
  });
  const { ok } = await prompts(
    {
      type: 'confirm',
      name: 'ok',
      message: t(lang, 'Tulis nilai-nilai ini ke file env?', 'Write these values to the env file?'),
      initial: true,
    },
    {
      onCancel(): never {
        throw new Error('SETUP_WIZARD_CANCELLED');
      },
    },
  );
  if (!ok) throw new Error('SETUP_WIZARD_CANCELLED');

  // ─── Phase: write env + requirement + sync ──────────────────────────────
  printSection(lang, 'Menulis file', 'Writing files');

  const writeResult = writeEnvFile({
    appEnv,
    baseUrl,
    roles: roleInputs,
    challengeMode,
  });

  stepLine(
    t(
      lang,
      `✓ File env ditulis: ${shortPath(writeResult.envFilePath)}`,
      `✓ Env file written: ${shortPath(writeResult.envFilePath)}`,
    ),
  );
  if (writeResult.keysEncrypted.length > 0) {
    stepLine(
      t(
        lang,
        `✓ Secret terenkripsi: ${writeResult.keysEncrypted.join(', ')}`,
        `✓ Encrypted secrets: ${writeResult.keysEncrypted.join(', ')}`,
      ),
    );
  }
  if (writeResult.keysPreserved > 0) {
    stepLine(
      t(
        lang,
        `✓ ${writeResult.keysPreserved} key lama dipertahankan`,
        `✓ Preserved ${writeResult.keysPreserved} existing keys`,
      ),
    );
  }
  for (const w of writeResult.warnings ?? []) {
    stepLine(`⚠ ${w}`);
  }
  // ─── Write requirements/login.md from this env + challenge ──────────────
  const primaryRole = roleInputs[0];
  const loginState = loginStateFromWizard({
    baseUrl,
    appEnv,
    roles: roleNames,
    challengeMode,
    loginIdPref: primaryRole?.fields.loginIdPref,
    loginUrl: primaryRole?.fields.loginUrlPath || '/login',
    successUrlPath: primaryRole?.fields.successUrlPath || '/dashboard',
  });
  const loginFile = writeLoginRequirementFile(process.cwd(), loginState);
  const loginMarkdown = loginFile.skipped
    ? fs.readFileSync(loginFile.absolutePath, 'utf-8')
    : buildLoginRequirement(loginState, { generated: true });
  stepLine(
    t(
      lang,
      loginFile.skipped
        ? `✓ ${loginFile.relativePath} sudah ada (bukan auto-generated) — tidak ditimpa`
        : `✓ Requirement login ditulis: ${loginFile.relativePath} (mode ${challengeMode})`,
      loginFile.skipped
        ? `✓ ${loginFile.relativePath} already exists (not auto-generated) — left intact`
        : `✓ Login requirement written: ${loginFile.relativePath} (mode ${challengeMode})`,
    ),
  );

  // ─── Regenerate src/support/auth.setup.ts with real per-role paths ───────
  const authSetupOut = path.join(process.cwd(), 'src', 'support', 'auth.setup.ts');
  const authRoles = roleInputs.map((r) => ({
    name: r.name,
    authFile: `.auth/${appEnv}/${r.name}.json`,
    loginUrl: r.fields.loginUrlPath || '/login',
    successUrlPath: r.fields.successUrlPath || '/dashboard',
  }));
  const authWrite = writeAuthSetup(
    {
      roles: authRoles,
      loginUrl: primaryRole?.fields.loginUrlPath || '/login',
      successUrlPath: primaryRole?.fields.successUrlPath || '/dashboard',
    },
    authSetupOut,
  );
  stepLine(
    t(
      lang,
      authWrite.skipped
        ? `✓ Setup autentikasi: src/support/auth.setup.ts memiliki kustomisasi QA (// CUSTOM_AUTH_FLOW) — tidak ditimpa`
        : `✓ Setup autentikasi di-update: src/support/auth.setup.ts (${roleNames.length} role)`,
      authWrite.skipped
        ? `✓ Auth setup: src/support/auth.setup.ts has custom QA flow (// CUSTOM_AUTH_FLOW) — left intact`
        : `✓ Auth setup updated: src/support/auth.setup.ts (${roleNames.length} role)`,
    ),
  );

  // ─── Sync Agent Skills & MCP Configs ────────────────────────────────────
  const agentSync = syncAgentSkillsAndMcp(process.cwd());
  if (agentSync.skillsSynced.length > 0) {
    stepLine(
      t(
        lang,
        `✓ Agent skills disinkronkan: ${agentSync.skillsSynced.join(', ')}`,
        `✓ Agent skills synced: ${agentSync.skillsSynced.join(', ')}`,
      ),
    );
  }
  if (agentSync.mcpConfigsGenerated) {
    stepLine(
      t(
        lang,
        '✓ Config MCP lintas platform dibuat (.cursor, .kiro, claude, .codex)',
        '✓ Cross-platform MCP configs generated (.cursor, .kiro, claude, .codex)',
      ),
    );
  }

  // ─── Phase: REAL artifact verification ──────────────────────────────────
  printSection(lang, 'Verifikasi artefak (nyata)', 'Artifact verification (real)');

  const checks = verifySetupArtifacts({
    repoRoot: process.cwd(),
    appEnv,
    envPath: writeResult.envFilePath,
    envMap: readExistingEnv(appEnv),
    roles: roleNames,
    lang,
    loginRequirementPath: loginFile.relativePath,
    skillsSynced: agentSync.skillsSynced.length > 0,
    mcpConfigsGenerated: agentSync.mcpConfigsGenerated,
  });
  printChecklist(checks.map(toChecklistItem));

  // ─── Validate (parse + reachability + roles) ────────────────────────────
  const freshEnv = readExistingEnv(appEnv);
  const validation = await validateSetup(appEnv, freshEnv, writeResult.envFilePath, lang);

  // ─── Summary ────────────────────────────────────────────────────────────
  printSummary({
    lang,
    appEnv,
    baseUrl,
    roles: roleInputs,
    challengeMode,
    writeResult,
    validation,
    agentSync,
    loginRequirementPath: loginFile.relativePath,
    loginMarkdown,
  });

  // ─── Offer to run auth:setup in a parallel terminal ─────────────────────
  if (roleNames.length > 0 && validation.reachable) {
    const authCmd = challengeMode === 'none' ? 'npm run auth:setup' : 'npm run auth:setup:headed';
    const { runAuth } = await prompts(
      {
        type: 'confirm',
        name: 'runAuth',
        message: t(
          lang,
          `Buka terminal baru untuk membuat session login (${authCmd})?`,
          `Open a new terminal to materialize login sessions (${authCmd})?`,
        ),
        initial: true,
      },
      {
        onCancel(): boolean {
          return false;
        },
      },
    );

    if (runAuth) {
      const ok = openTerminalFor(process.cwd(), authCmd);
      if (ok) {
        stepLine(
          t(
            lang,
            `✓ Terminal baru dibuka menjalankan ${authCmd}. Session tersimpan ke .auth/${appEnv}/.`,
            `✓ New terminal opened running ${authCmd}. Sessions saved to .auth/${appEnv}/.`,
          ),
        );
      }
    }
  }

  return {
    envFilePath: writeResult.envFilePath,
    roles: roleNames,
    isNewSetup: writeResult.isNewFile,
    validation,
    checks,
    loginRequirementPath: loginFile.relativePath,
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function shortPath(abs: string): string {
  const rel = abs.replace(/\\/g, '/').split('/node_modules/')[0] ?? abs;
  const cwd = process.cwd().replace(/\\/g, '/');
  return rel.startsWith(cwd) ? rel.slice(cwd.length + 1) : abs;
}

function toChecklistItem(check: SetupCheck): {
  label: string;
  status: 'pass' | 'warn' | 'fail';
  detail?: string;
  fix?: string;
} {
  return { label: check.label, status: check.status, detail: check.detail, fix: check.fix };
}

/**
 * Show what the existing env currently configures so the update/keep decision
 * is informed: BASE_URL, detected roles (with encrypted-password marker), and
 * challenge mode.
 */
function describeExistingEnv(lang: WizardLang, envMap: Record<string, string>): void {
  printSection(lang, 'Config saat ini', 'Current config');
  const baseUrl = envMap['BASE_URL'];
  if (baseUrl && !isEncryptedValue(baseUrl)) {
    stepLine(`  BASE_URL  : ${baseUrl}`);
  }
  const roles = detectExistingRoles(envMap);
  const roleParts = roles.map((role) => {
    const prefix = role === 'user' ? 'TEST_USER' : role.toUpperCase().replace(/-/g, '_');
    const pw = envMap[`${prefix}_PASSWORD`];
    return isEncryptedValue(pw) ? `${role} ${t(lang, '(terenkripsi)', '(encrypted)')}` : role;
  });
  stepLine(
    `  ${t(lang, 'Roles', 'Roles')}    : ${roleParts.join(', ') || t(lang, 'tidak ada', 'none')}`,
  );
  const challenge = envMap['AUTH_CHALLENGE_MODE'];
  if (challenge) {
    stepLine(`  ${t(lang, 'Challenge', 'Challenge')}: ${challenge}`);
  }
}

function maskPassword(v: string): string {
  if (v.length <= 4) return '****';
  if (v.length <= 8) return `${v[0]!}****${v.slice(-1)}`;
  return `${v.slice(0, 2)}****${v.slice(-2)}`;
}

function printPreview(opts: {
  lang: WizardLang;
  appEnv: AppEnv;
  baseUrl: string;
  roles: WizardRoleInput[];
  challengeMode: ChallengeMode;
}): void {
  const { lang, appEnv, baseUrl, roles, challengeMode } = opts;
  printSection(lang, 'Pratinjau (disamarkan)', 'Preview (masked)');
  stepLine(`  APP_ENV      ${appEnv}`);
  stepLine(`  BASE_URL     ${baseUrl}`);
  stepLine(
    `  HEADLESS     ${
      challengeMode === 'otp-browser' ||
      challengeMode === 'captcha-browser' ||
      challengeMode === 'auto'
        ? 'false'
        : 'true'
    }`,
  );
  stepLine(`  CHALLENGE    ${challengeMode}`);
  for (const r of roles) {
    const prefix = r.name === 'user' ? 'TEST_USER' : r.name.toUpperCase().replace(/-/g, '_');
    const id = r.fields.email ?? r.fields.username ?? r.fields.phone ?? '-';
    const login = r.fields.loginUrlPath || '/login';
    const redir = r.fields.successUrlPath || '/dashboard';
    stepLine(
      `  ${prefix.padEnd(13)}${id} / ${maskPassword(r.fields.password)}  [${login} → ${redir}]`,
    );
  }
}

function detectExistingRoles(envMap: Record<string, string>): string[] {
  const roles = new Set<string>();

  for (const key of Object.keys(envMap)) {
    const m =
      /^([A-Z0-9_]+?)_(EMAIL|USERNAME|PHONE|PASSWORD|LOGIN_ID_PREF|LOGIN_URL_PATH|SUCCESS_URL_PATH)$/.exec(
        key,
      );
    if (!m) continue;
    const prefix = m[1];
    if (prefix === 'DOTENV' || prefix === 'DOTENV_PUBLIC_KEY') continue;
    if (prefix.endsWith('_LOGIN_ID')) continue;
    if (prefix === 'TEST_USER') {
      roles.add('user');
    } else {
      roles.add(prefix.toLowerCase().replace(/_/g, '-'));
    }
  }

  return [...roles].sort();
}

function getExistingRoleFields(
  envMap: Record<string, string>,
  role: string,
): Partial<RoleFields> | undefined {
  const prefix = role === 'user' ? 'TEST_USER' : role.toUpperCase().replace(/-/g, '_');
  const fields: Partial<RoleFields> = {};

  if (envMap[`${prefix}_EMAIL`] && !isEncryptedValue(envMap[`${prefix}_EMAIL`]))
    fields.email = envMap[`${prefix}_EMAIL`];
  if (envMap[`${prefix}_USERNAME`] && !isEncryptedValue(envMap[`${prefix}_USERNAME`]))
    fields.username = envMap[`${prefix}_USERNAME`];
  if (envMap[`${prefix}_PHONE`] && !isEncryptedValue(envMap[`${prefix}_PHONE`]))
    fields.phone = envMap[`${prefix}_PHONE`];
  if (envMap[`${prefix}_PASSWORD`] && !isEncryptedValue(envMap[`${prefix}_PASSWORD`]))
    fields.password = envMap[`${prefix}_PASSWORD`];

  const pref = envMap[`${prefix}_LOGIN_ID_PREF`];
  if (pref === 'email' || pref === 'username' || pref === 'phone') {
    fields.loginIdPref = pref;
  }

  const roleLogin = envMap[`${prefix}_LOGIN_URL_PATH`];
  if (roleLogin && !isEncryptedValue(roleLogin)) {
    fields.loginUrlPath = roleLogin;
  }

  const roleSuccess = envMap[`${prefix}_SUCCESS_URL_PATH`];
  if (roleSuccess && !isEncryptedValue(roleSuccess)) {
    fields.successUrlPath = roleSuccess;
  }

  return Object.keys(fields).length > 0 ? fields : undefined;
}

async function runCheckOnly(appEnv: AppEnv, lang: WizardLang): Promise<WizardResult> {
  const existing = readExistingEnv(appEnv);
  const envPath = resolveEnvPath(appEnv);
  const validation = await validateSetup(appEnv, existing, envPath, lang);

  // Sync / check skills and MCP
  const agentSync = syncAgentSkillsAndMcp(process.cwd());

  if (validation.valid) {
    console.log(
      t(lang, '✅ Setup valid dan siap untuk testing.', '✅ Setup is valid and ready for testing.'),
    );
  } else {
    console.log(t(lang, '❌ Setup bermasalah:', '❌ Setup has issues:'));
    for (const err of validation.errors) {
      console.log(`   ERROR: ${err}`);
    }
  }

  if (validation.warnings.length > 0) {
    for (const w of validation.warnings) {
      console.log(`   ⚠ ${w}`);
    }
  }

  console.log(`   ${t(lang, 'Dapat diakses', 'Reachable')}: ${validation.reachable ? '✅' : '❌'}`);
  console.log(
    `   ${t(lang, 'Role siap', 'Roles ready')}: ${validation.rolesReady.join(', ') || t(lang, 'tidak ada', 'none')}`,
  );
  if (agentSync.skillsSynced.length > 0) {
    const dest = agentSync.hermesProfileSkillsDir ? ` (${agentSync.hermesProfileSkillsDir})` : '';
    console.log(`   Skills synced: ${agentSync.skillsSynced.join(', ')}${dest}`);
  }
  if (agentSync.mcpConfigsGenerated) {
    console.log('   MCP configs: ready (.cursor, .kiro, claude)');
  }
  if (validation.rolesEncrypted.length > 0) {
    console.log(
      t(
        lang,
        `   Role terenkripsi: ${validation.rolesEncrypted.join(', ')} (update via: npm run env:edit)`,
        `   Encrypted roles: ${validation.rolesEncrypted.join(', ')} (update via: npm run env:edit)`,
      ),
    );
  }
  console.log(
    `   ${t(lang, 'Role belum lengkap', 'Roles incomplete')}: ${validation.rolesIncomplete.join(', ') || t(lang, 'tidak ada', 'none')}`,
  );

  return {
    envFilePath: envPath,
    roles: validation.rolesReady,
    isNewSetup: false,
    validation,
    checks: [],
  };
}

function printSummary(data: {
  lang: WizardLang;
  appEnv: AppEnv;
  baseUrl: string;
  roles: WizardRoleInput[];
  challengeMode: ChallengeMode;
  writeResult: EnvWriteResult;
  validation: ValidationResult;
  agentSync?: AgentSyncResult;
  loginRequirementPath?: string;
  loginMarkdown?: string;
}): void {
  const { lang } = data;
  const line = '═'.repeat(54);
  console.log('');
  console.log(line);
  console.log(`  ${t(lang, 'Setup selesai — Ringkasan', 'Setup finished — Summary')}`);
  console.log(line);
  stepLine(`  APP_ENV      : ${data.appEnv}`);
  stepLine(`  BASE_URL     : ${data.baseUrl}`);
  stepLine(`  ${t(lang, 'Roles', 'Roles')}        : ${data.roles.map((r) => r.name).join(', ')}`);
  for (const r of data.roles) {
    const login = r.fields.loginUrlPath || '/login';
    const redir = r.fields.successUrlPath || '/dashboard';
    stepLine(`    • ${r.name.padEnd(12)}: login ${login} → redirect ${redir}`);
  }
  stepLine(`  ${t(lang, 'Challenge', 'Challenge')}    : ${data.challengeMode}`);
  stepLine(`  ${t(lang, 'Env file', 'Env file')}    : config/environments/${data.appEnv}.env`);
  stepLine(
    `  ${t(lang, 'Dapat diakses', 'Reachable')}   : ${data.validation.reachable ? '✅' : '❌'}`,
  );

  const roleSummary: string[] = [];
  if (data.validation.rolesReady.length > 0) {
    roleSummary.push(`${t(lang, 'siap', 'ready')}: ${data.validation.rolesReady.join(', ')}`);
  }
  if (data.validation.rolesEncrypted.length > 0) {
    roleSummary.push(
      `${t(lang, 'terenkripsi', 'encrypted')}: ${data.validation.rolesEncrypted.join(', ')} (${t(lang, 'dicek via decrypt', 'verified via decrypt')})`,
    );
  }
  if (data.validation.rolesIncomplete.length > 0) {
    roleSummary.push(
      `${t(lang, 'belum lengkap', 'incomplete')}: ${data.validation.rolesIncomplete.join(', ')}`,
    );
  }
  if (roleSummary.length > 0) {
    stepLine(`  ${t(lang, 'Roles', 'Roles')}        : ${roleSummary.join(' · ')}`);
  }

  console.log('');

  if (data.validation.warnings.length > 0) {
    stepLine(`  ⚠ ${t(lang, 'Peringatan', 'Warnings')}:`);
    for (const w of data.validation.warnings) {
      console.log(`      - ${w}`);
    }
    console.log('');
  }

  if (data.challengeMode !== 'none') {
    stepLine(`  ℹ ${t(lang, 'Langkah berikutnya:', 'Next steps:')}`);
    console.log('      1. npm run auth:setup');
    stepLine(
      t(
        lang,
        '       (buat sesi login; OTP/CAPTCHA: npm run auth:setup:headed)',
        '       (materialize sessions; OTP/CAPTCHA: npm run auth:setup:headed)',
      ),
    );
    console.log(
      `      2. ${t(lang, 'paste prompt Hermes di bawah (atau npm run qa:run)', 'paste the Hermes prompt below (or npm run qa:run)')}`,
    );
  } else {
    stepLine(`  ℹ ${t(lang, 'Langkah berikutnya:', 'Next steps:')}`);
    console.log(
      `      1. ${t(lang, 'paste prompt Hermes di bawah (atau npm run qa:run)', 'paste the Hermes prompt below (or npm run qa:run)')}`,
    );
  }

  if (data.loginRequirementPath) {
    stepLine(`  ${t(lang, 'Requirement', 'Requirement')}: ${data.loginRequirementPath}`);
  }

  if (data.loginRequirementPath && data.loginMarkdown) {
    const prompt = buildAgentPrompt(data.loginRequirementPath, data.loginMarkdown, lang, {
      baseUrl: data.baseUrl,
      appEnv: data.appEnv,
    });
    console.log('');
    console.log('  ' + '─'.repeat(52));
    stepLine(
      t(
        lang,
        'Salin SELURUH blok di bawah ini → paste ke Hermes chat:',
        'Copy the ENTIRE block below → paste into the Hermes chat:',
      ),
    );
    console.log('  ' + '─'.repeat(52));
    console.log('');
    console.log(prompt.trimEnd());
    console.log('');
    console.log('  ' + '─'.repeat(52));
  }

  console.log(line);
  console.log('');
}
