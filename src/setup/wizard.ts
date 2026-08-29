/**
 * Setup Wizard — core orchestrator.
 *
 * Interactive CLI wizard that guides users through:
 * 1. APP_ENV selection
 * 2. BASE_URL configuration
 * 3. Role credential entry
 * 4. Auth challenge mode
 * 5. File write + validation
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
  promptAppEnv,
  promptBaseUrl,
  promptRoleCredentials,
  promptRoles,
  promptChallengeMode,
  confirmOverwrite,
  type RoleFields,
} from './wizard-prompts';
import prompts from 'prompts';
import {
  writeEnvFile,
  readExistingEnv,
  isEncryptedValue,
  resolveEnvPath,
  type EnvWriteResult,
} from './wizard-writer';

import { validateSetup, type ValidationResult } from './wizard-validate';
import { syncAgentSkillsAndMcp, type AgentSyncResult } from './agent-sync';

// ─── Public types ────────────────────────────────────────────────────────────

export interface WizardOptions {
  /** Non-interactive mode: only validate, no prompts */
  checkOnly?: boolean;
  /** Override APP_ENV (default: resolve from existing) */
  appEnv?: AppEnv;
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
}

// ─── Main orchestrator ───────────────────────────────────────────────────────

/**
 * Run the setup wizard.
 *
 * Flow:
 * 1. Detect existing config → if exists, ask update or skip
 * 2. Prompt APP_ENV (default: resolve from existing)
 * 3. Prompt BASE_URL + validate reachable
 * 4. Prompt role credentials
 * 5. Prompt AUTH_CHALLENGE_MODE
 * 6. Prompt encryption
 * 7. Write env file
 * 8. Validate
 * 9. Print summary
 */
export async function runSetupWizard(options?: WizardOptions): Promise<WizardResult> {
  const opts = options ?? {};

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
    return runCheckOnly(appEnv);
  }

  // ─── Step 2: Detect existing ────────────────────────────────────────────
  const existing = readExistingEnv(appEnv);

  if (existing) {
    const envPath = resolveEnvPath(appEnv);
    const shouldUpdate = await confirmOverwrite(envPath);
    if (!shouldUpdate) {
      logger.info('Setup wizard cancelled — keeping existing config.');
      const validation = await validateSetup(appEnv, existing, envPath);
      return {
        envFilePath: envPath,
        roles: [],
        isNewSetup: false,
        validation,
      };
    }
  }

  // ─── Step 3: Prompt APP_ENV (skip when pinned via --env) ─────────────────
  appEnv = opts.appEnv ?? (await promptAppEnv(appEnv));

  // ─── Step 4: Prompt BASE_URL ────────────────────────────────────────────
  const existingUrl =
    existing && !isEncryptedValue(existing['BASE_URL']) ? existing['BASE_URL'] : undefined;
  const baseUrl = await promptBaseUrl(existingUrl);

  // ─── Step 5: Prompt roles ───────────────────────────────────────────────
  const existingRoles = existing ? detectExistingRoles(existing) : [];
  const roleNames = await promptRoles(existingRoles.length > 0 ? existingRoles : undefined);

  const roleInputs: WizardRoleInput[] = [];
  for (const role of roleNames) {
    const existingFields = existing ? getExistingRoleFields(existing, role) : undefined;
    const fields = await promptRoleCredentials(role, existingFields);
    roleInputs.push({ name: role, fields });
  }

  // ─── Step 6: Prompt challenge mode ──────────────────────────────────────
  const existingChallenge = existing?.['AUTH_CHALLENGE_MODE'];
  const challengeMode = await promptChallengeMode(existingChallenge);

  // ─── Step 6b: Preview (masked) + confirm before write ─────────────────────
  printPreview({ appEnv, baseUrl, roles: roleInputs, challengeMode });
  const { ok } = await prompts(
    {
      type: 'confirm',
      name: 'ok',
      message: 'Write these values to the env file?',
      initial: true,
    },
    {
      onCancel(): never {
        throw new Error('SETUP_WIZARD_CANCELLED');
      },
    },
  );
  if (!ok) throw new Error('SETUP_WIZARD_CANCELLED');

  // ─── Step 7: Write env file ─────────────────────────────────────────────
  const writeResult = writeEnvFile({
    appEnv,
    baseUrl,
    roles: roleInputs,
    challengeMode,
  });

  logger.info(`✅ Env file written: ${writeResult.envFilePath}`);
  if (writeResult.keysPreserved > 0) {
    logger.info(`   Preserved ${writeResult.keysPreserved} existing keys`);
  }

  // ─── Step 8: Sync Agent Skills & MCP Configs ────────────────────────────
  const agentSync = syncAgentSkillsAndMcp(process.cwd());
  if (agentSync.skillsSynced.length > 0) {
    logger.info(`✅ Agent skills synced: ${agentSync.skillsSynced.join(', ')}`);
  }
  if (agentSync.mcpConfigsGenerated) {
    logger.info('✅ Cross-platform MCP configs generated (.cursor, .kiro, claude)');
  }

  // ─── Step 9: Validate ───────────────────────────────────────────────────
  const freshEnv = readExistingEnv(appEnv);
  const validation = await validateSetup(appEnv, freshEnv, writeResult.envFilePath);

  // ─── Step 10: Print summary ─────────────────────────────────────────────
  printSummary({
    appEnv,
    baseUrl,
    roles: roleNames,
    challengeMode,
    writeResult,
    validation,
    agentSync,
  });

  return {
    envFilePath: writeResult.envFilePath,
    roles: roleNames,
    isNewSetup: writeResult.isNewFile,
    validation,
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function maskPassword(v: string): string {
  if (v.length <= 4) return '****';
  if (v.length <= 8) return `${v[0]!}****${v.slice(-1)}`;
  return `${v.slice(0, 2)}****${v.slice(-2)}`;
}

function printPreview(opts: {
  appEnv: AppEnv;
  baseUrl: string;
  roles: WizardRoleInput[];
  challengeMode: ChallengeMode;
}): void {
  console.log('');
  console.log('─── Preview (masked) ─────────────────────────────');
  console.log(`  APP_ENV=${opts.appEnv}`);
  console.log(`  BASE_URL=${opts.baseUrl}`);
  console.log(
    `  HEADLESS=${opts.challengeMode === 'otp-browser' || opts.challengeMode === 'captcha-browser' || opts.challengeMode === 'auto' ? 'false' : 'true'}`,
  );
  console.log(`  AUTH_CHALLENGE_MODE=${opts.challengeMode}`);
  for (const r of opts.roles) {
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

async function runCheckOnly(appEnv: AppEnv): Promise<WizardResult> {
  const existing = readExistingEnv(appEnv);
  const envPath = resolveEnvPath(appEnv);
  const validation = await validateSetup(appEnv, existing, envPath);

  // Sync / check skills and MCP
  const agentSync = syncAgentSkillsAndMcp(process.cwd());

  if (validation.valid) {
    console.log('✅ Setup is valid and ready for testing.');
  } else {
    console.log('❌ Setup has issues:');
    for (const err of validation.errors) {
      console.log(`   ERROR: ${err}`);
    }
  }

  if (validation.warnings.length > 0) {
    for (const w of validation.warnings) {
      console.log(`   ⚠ ${w}`);
    }
  }

  console.log(`   Reachable: ${validation.reachable ? '✅' : '❌'}`);
  console.log(`   Roles ready: ${validation.rolesReady.join(', ') || 'none'}`);
  if (agentSync.skillsSynced.length > 0) {
    const dest = agentSync.hermesProfileSkillsDir ? ` (${agentSync.hermesProfileSkillsDir})` : '';
    console.log(`   Skills synced: ${agentSync.skillsSynced.join(', ')}${dest}`);
  }
  if (agentSync.mcpConfigsGenerated) {
    console.log('   MCP configs: ready (.cursor, .kiro, claude)');
  }
  if (validation.rolesEncrypted.length > 0) {
    console.log(
      `   Encrypted roles: ${validation.rolesEncrypted.join(', ')} (update via: npm run env:edit)`,
    );
  }
  console.log(`   Roles incomplete: ${validation.rolesIncomplete.join(', ') || 'none'}`);

  return {
    envFilePath: envPath,
    roles: validation.rolesReady,
    isNewSetup: false,
    validation,
  };
}

function printSummary(data: {
  appEnv: AppEnv;
  baseUrl: string;
  roles: string[];
  challengeMode: ChallengeMode;
  writeResult: EnvWriteResult;
  validation: ValidationResult;
  agentSync?: AgentSyncResult;
}): void {
  console.log('');
  console.log('═══════════════════════════════════════════════════');
  console.log('  Setup Wizard — Summary');
  console.log('═══════════════════════════════════════════════════');
  console.log(`  APP_ENV:     ${data.appEnv}`);
  console.log(`  BASE_URL:    ${data.baseUrl}`);
  console.log(`  Roles:       ${data.roles.join(', ')}`);
  console.log(`  Challenge:   ${data.challengeMode}`);
  console.log(`  Env file:    ${data.writeResult.envFilePath}`);
  console.log(`  Reachable:   ${data.validation.reachable ? '✅' : '❌'}`);
  console.log(`  Ready roles: ${data.validation.rolesReady.join(', ') || 'none'}`);
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
      `  Encrypted:   ${data.validation.rolesEncrypted.join(', ')} (update via: npm run env:edit)`,
    );
  }
  console.log('');

  if (data.validation.warnings.length > 0) {
    console.log('  ⚠ Warnings:');
    for (const w of data.validation.warnings) {
      console.log(`    - ${w}`);
    }
    console.log('');
  }

  if (data.challengeMode !== 'none') {
    console.log('  ℹ Next step: Run auth setup to materialize sessions:');
    console.log('    npx playwright test --config src/support/auth.setup.ts');
  } else {
    console.log('  ℹ Next step: Run your first test:');
    console.log('    npx playwright test');
  }
  console.log('═══════════════════════════════════════════════════');
  console.log('');
}
