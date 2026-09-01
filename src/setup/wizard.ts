/**
 * Setup Wizard — core orchestrator.
 *
 * Interactive CLI wizard that guides users through:
 * 1. Language selection (Indonesian default, English opt-in)
 * 2. APP_ENV selection
 * 3. BASE_URL configuration
 * 4. Role credential entry (re-try on mismatch; back navigation)
 * 5. Auth challenge mode
 * 6. File write + validation
 *
 * Non-interactive mode (--check) validates existing setup without prompting.
 *
 * @module src/setup/wizard
 */

import { type AppEnv, resolveAppEnv } from '../utils/app-env';
import { type ChallengeMode } from '../support/human-challenge';
import { type WizardRoleInput } from '../shared/utils/role-credentials';
import { logger } from '../utils/logger';
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
import {
  buildLoginRequirement,
  loginStateFromWizard,
  writeLoginRequirementFile,
} from '../../tools/scripts/wizard-login-template';
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
  /** Relative path of generated requirements/login.md (interactive run only) */
  loginRequirementPath?: string;
}

// ─── Main orchestrator ───────────────────────────────────────────────────────

/**
 * Run the setup wizard.
 *
 * Flow:
 * 1. Detect existing config → if exists, ask update or skip
 * 2. Prompt language (unless pinned via --lang)
 * 3. Prompt APP_ENV (default: resolve from existing)
 * 4. Prompt BASE_URL + validate reachable
 * 5. Prompt role credentials (back/mismatch handled inside prompts)
 * 6. Prompt AUTH_CHALLENGE_MODE
 * 7. Prompt encryption
 * 8. Write env file
 * 9. Validate
 * 10. Print summary
 */
export async function runSetupWizard(options?: WizardOptions): Promise<WizardResult> {
  const opts = options ?? {};

  let lang: WizardLang = opts.lang ?? DEFAULT_LANG;

  // ─── Step 1: Resolve APP_ENV ────────────────────────────────────────────
  let appEnv: AppEnv;

  if (opts.appEnv) {
    appEnv = opts.appEnv;
  } else {
    const resolved = resolveAppEnv({ repoRoot: process.cwd() });
    appEnv = resolved.appEnv;
  }

  // ─── Check-only mode ────────────────────────────────────────────────────
  if (opts.checkOnly) {
    return runCheckOnly(appEnv, lang);
  }

  // ─── Step 2: Language (skipped when pinned via --lang) ──────────────────
  if (!opts.lang) {
    lang = await promptLanguage();
  }

  // ─── Step 2b: Playwright browser availability ───────────────────────────
  await ensureBrowsers(lang);

  // ─── Step 3: Detect existing ────────────────────────────────────────────
  const existing = readExistingEnv(appEnv);

  if (existing) {
    const envPath = resolveEnvPath(appEnv);
    const shouldUpdate = await confirmOverwrite(lang, envPath);
    if (!shouldUpdate) {
      logger.info(
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
      };
    }
  }

  // ─── Step 4: Prompt APP_ENV (skip when pinned via --env) ────────────────
  appEnv = opts.appEnv ?? (await promptAppEnv(lang, appEnv));

  // ─── Step 5: Prompt BASE_URL ────────────────────────────────────────────
  const existingUrl =
    existing && !isEncryptedValue(existing['BASE_URL']) ? existing['BASE_URL'] : undefined;
  const baseUrl = await promptBaseUrl(lang, existingUrl);

  // ─── Step 6: Prompt roles ───────────────────────────────────────────────
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

  // ─── Step 7: Prompt challenge mode ──────────────────────────────────────
  const existingChallenge = existing?.['AUTH_CHALLENGE_MODE'];
  const challengeMode = await promptChallengeMode(lang, existingChallenge);

  // ─── Step 7b: Preview (masked) + confirm before write ───────────────────
  printPreview({ lang, appEnv, baseUrl, roles: roleInputs, challengeMode });
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

  // ─── Step 8: Write env file ─────────────────────────────────────────────
  const writeResult = writeEnvFile({
    appEnv,
    baseUrl,
    roles: roleInputs,
    challengeMode,
  });

  logger.info(
    t(
      lang,
      `✅ File env ditulis: ${writeResult.envFilePath}`,
      `✅ Env file written: ${writeResult.envFilePath}`,
    ),
  );
  if (writeResult.keysPreserved > 0) {
    logger.info(
      t(
        lang,
        `   ${writeResult.keysPreserved} key lama dipertahankan`,
        `   Preserved ${writeResult.keysPreserved} existing keys`,
      ),
    );
  }

  // ─── Step 8b: Write requirements/login.md from this env + challenge ────
  const loginState = loginStateFromWizard({
    baseUrl,
    appEnv,
    roles: roleNames,
    challengeMode,
    loginIdPref: roleInputs[0]?.fields.loginIdPref,
    loginUrl:
      existing && !isEncryptedValue(existing['AUTH_LOGIN_URL_PATH'])
        ? existing['AUTH_LOGIN_URL_PATH']
        : undefined,
    successUrlPath:
      existing && !isEncryptedValue(existing['AUTH_SUCCESS_URL_PATH'])
        ? existing['AUTH_SUCCESS_URL_PATH']
        : undefined,
  });
  const loginFile = writeLoginRequirementFile(process.cwd(), loginState);
  const loginMarkdown = loginFile.skipped
    ? fs.readFileSync(loginFile.absolutePath, 'utf-8')
    : buildLoginRequirement(loginState, { generated: true });
  logger.info(
    t(
      lang,
      loginFile.skipped
        ? `ℹ ${loginFile.relativePath} sudah ada (bukan auto-generated) — tidak ditimpa`
        : `✅ Requirement login ditulis: ${loginFile.relativePath} (mode ${challengeMode})`,
      loginFile.skipped
        ? `ℹ ${loginFile.relativePath} already exists (not auto-generated) — left intact`
        : `✅ Login requirement written: ${loginFile.relativePath} (mode ${challengeMode})`,
    ),
  );

  // ─── Step 9: Sync Agent Skills & MCP Configs ────────────────────────────
  const agentSync = syncAgentSkillsAndMcp(process.cwd());
  if (agentSync.skillsSynced.length > 0) {
    logger.info(
      t(
        lang,
        `✅ Agent skills disinkronkan: ${agentSync.skillsSynced.join(', ')}`,
        `✅ Agent skills synced: ${agentSync.skillsSynced.join(', ')}`,
      ),
    );
  }
  if (agentSync.mcpConfigsGenerated) {
    logger.info(
      t(
        lang,
        '✅ Config MCP lintas platform dibuat (.cursor, .kiro, claude)',
        '✅ Cross-platform MCP configs generated (.cursor, .kiro, claude)',
      ),
    );
  }

  // ─── Step 10: Validate ──────────────────────────────────────────────────
  const freshEnv = readExistingEnv(appEnv);
  const validation = await validateSetup(appEnv, freshEnv, writeResult.envFilePath, lang);

  // ─── Step 11: Print summary ─────────────────────────────────────────────
  printSummary({
    lang,
    appEnv,
    baseUrl,
    roles: roleNames,
    challengeMode,
    writeResult,
    validation,
    agentSync,
    loginRequirementPath: loginFile.relativePath,
    loginMarkdown,
  });

  return {
    envFilePath: writeResult.envFilePath,
    roles: roleNames,
    isNewSetup: writeResult.isNewFile,
    validation,
    loginRequirementPath: loginFile.relativePath,
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

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
  console.log('');
  console.log(
    `─── ${t(lang, 'Pratinjau (disamarkan)', 'Preview (masked)')} ─────────────────────────────`,
  );
  console.log(`  APP_ENV=${appEnv}`);
  console.log(`  BASE_URL=${baseUrl}`);
  console.log(
    `  HEADLESS=${challengeMode === 'otp-browser' || challengeMode === 'captcha-browser' || challengeMode === 'auto' ? 'false' : 'true'}`,
  );
  console.log(`  AUTH_CHALLENGE_MODE=${challengeMode}`);
  for (const r of roles) {
    const prefix = r.name === 'user' ? 'TEST_USER' : r.name.toUpperCase().replace(/-/g, '_');
    if (r.fields.email) console.log(`  ${prefix}_EMAIL=${r.fields.email}`);
    if (r.fields.username) console.log(`  ${prefix}_USERNAME=${r.fields.username}`);
    if (r.fields.phone) console.log(`  ${prefix}_PHONE=${r.fields.phone}`);
    console.log(`  ${prefix}_PASSWORD=${maskPassword(r.fields.password)}`);
    if (r.fields.loginIdPref) console.log(`  ${prefix}_LOGIN_ID_PREF=${r.fields.loginIdPref}`);
  }
  console.log('────────────────────────────────────────────────');
}

function detectExistingRoles(envMap: Record<string, string>): string[] {
  const roles = new Set<string>();
  roles.add('user'); // always present

  for (const key of Object.keys(envMap)) {
    const m = /^([A-Z0-9_]+?)_(EMAIL|USERNAME|PHONE|PASSWORD)$/.exec(key);
    if (!m) continue;
    const prefix = m[1];
    if (prefix === 'TEST_USER' || prefix === 'DOTENV') continue;
    if (prefix.endsWith('_LOGIN_ID')) continue;
    roles.add(prefix.toLowerCase().replace(/_/g, '-'));
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
  };
}

function printSummary(data: {
  lang: WizardLang;
  appEnv: AppEnv;
  baseUrl: string;
  roles: string[];
  challengeMode: ChallengeMode;
  writeResult: EnvWriteResult;
  validation: ValidationResult;
  agentSync?: AgentSyncResult;
  loginRequirementPath?: string;
  loginMarkdown?: string;
}): void {
  const { lang } = data;
  console.log('');
  console.log('═══════════════════════════════════════════════════');
  console.log(`  ${t(lang, 'Setup Wizard — Ringkasan', 'Setup Wizard — Summary')}`);
  console.log('═══════════════════════════════════════════════════');
  console.log(`  APP_ENV:     ${data.appEnv}`);
  console.log(`  BASE_URL:    ${data.baseUrl}`);
  console.log(`  ${t(lang, 'Roles', 'Roles')}:       ${data.roles.join(', ')}`);
  console.log(`  ${t(lang, 'Challenge', 'Challenge')}:   ${data.challengeMode}`);
  console.log(`  Env file:    ${data.writeResult.envFilePath}`);
  console.log(
    `  ${t(lang, 'Dapat diakses', 'Reachable')}:   ${data.validation.reachable ? '✅' : '❌'}`,
  );
  console.log(
    `  ${t(lang, 'Role siap', 'Ready roles')}: ${data.validation.rolesReady.join(', ') || t(lang, 'tidak ada', 'none')}`,
  );
  if (data.agentSync && data.agentSync.skillsSynced.length > 0) {
    const dests = ['.agents/skills'];
    if (data.agentSync.hermesProfileSkillsDir) dests.push('hermes profile');
    console.log(`  Skills:      ${data.agentSync.skillsSynced.join(', ')} (${dests.join(', ')})`);
  }
  if (data.agentSync?.mcpConfigsGenerated) {
    console.log('  MCP Configs: .cursor, .kiro, claude (generated)');
  }
  if (data.validation.rolesEncrypted.length > 0) {
    console.log(
      t(
        lang,
        `  Terenkripsi: ${data.validation.rolesEncrypted.join(', ')} (update via: npm run env:edit)`,
        `  Encrypted:   ${data.validation.rolesEncrypted.join(', ')} (update via: npm run env:edit)`,
      ),
    );
  }
  console.log('');

  if (data.validation.warnings.length > 0) {
    console.log(`  ⚠ ${t(lang, 'Peringatan', 'Warnings')}:`);
    for (const w of data.validation.warnings) {
      console.log(`    - ${w}`);
    }
    console.log('');
  }

  if (data.loginRequirementPath) {
    console.log(`  ${t(lang, 'Requirement', 'Requirement')}: ${data.loginRequirementPath}`);
  }
  console.log('');

  if (data.challengeMode !== 'none') {
    console.log(
      `  ℹ ${t(
        lang,
        'Langkah berikutnya: buat session login, lalu paste prompt Hermes:',
        'Next step: materialize login sessions, then paste the Hermes prompt:',
      )}`,
    );
    console.log('    npm run auth:setup');
  } else {
    console.log(
      `  ℹ ${t(
        lang,
        'Langkah berikutnya: paste prompt Hermes di bawah (atau npm run qa:run):',
        'Next step: paste the Hermes prompt below (or npm run qa:run):',
      )}`,
    );
  }

  if (data.loginRequirementPath && data.loginMarkdown) {
    const prompt = buildAgentPrompt(data.loginRequirementPath, data.loginMarkdown);
    console.log('');
    console.log('  ─────────────────────────────────');
    console.log(
      t(
        lang,
        '  Salin prompt di bawah ini dan paste ke Hermes chat:',
        '  Copy the prompt below and paste it into Hermes chat:',
      ),
    );
    console.log('');
    for (const line of prompt.trimEnd().split('\n')) {
      console.log(`  >>> ${line}`);
    }
    console.log('  ─────────────────────────────────');
  }

  console.log('═══════════════════════════════════════════════════');
  console.log('');
}
