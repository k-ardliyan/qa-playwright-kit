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
import {
  roleCredentialKeys,
  roleToEnvPrefix,
  parseRolesFromEnvMap,
  type WizardRoleInput,
} from '../shared/utils/role-credentials';
import {
  promptLanguage,
  promptAppEnv,
  promptBaseUrl,
  promptRoleCredentials,
  promptRoles,
  promptChallengeMode,
  confirmOverwrite,
  confirmPrompt,
  type RoleFields,
  BACK,
  PREV,
} from './wizard-prompts';
import { intro, isInteractive, outro, requireTty, spinner } from './prompts/clack';
import { type WizardLang, t, DEFAULT_LANG } from './i18n';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  readExistingEnv,
  isEncryptedValue,
  resolveEnvPath,
  type EnvWriteResult,
} from './wizard-writer';

import { validateSetup, type ValidationResult } from './wizard-validate';
import type { AgentSyncResult } from './agent-sync';
import { LEARNED_SKILLS_DIR } from './agent-sync';
import { ensureBrowsers } from './browser-check';
import { copyText } from './prompt-dialog';
import { verifySetupArtifacts, authSessionStatus, type SetupCheck } from './verify-setup';
import { printBanner, printChecklist, printSection, printStep, stepLine } from './ui';
import { buildAgentPrompt } from '../../tools/scripts/qa-run-prompt';
import {
  formatRequirementValidationFailure,
  validateRequirementFile,
  type RequirementValidationResult,
} from './requirement-validation';
import { writeAndValidateLoginRequirement } from './tasks/requirement';
import { writeAuthSetupFile } from './tasks/auth-setup';
import { writeEnvAndPin } from './tasks/env-write';
import { syncAgentArtifacts } from './tasks/agent-sync';
import {
  authSetupScript,
  materializeAuthSession,
  type AuthSessionOutcome,
} from './tasks/auth-session';

// ─── Public types ────────────────────────────────────────────────────────────

export interface WizardOptions {
  /** Non-interactive mode: only validate, no prompts */
  checkOnly?: boolean;
  /** Override APP_ENV (default: resolve from existing) */
  appEnv?: AppEnv;
  /** Language override (default: Indonesian unless prompted) */
  lang?: WizardLang;
  /** Non-interactive run: every step must be resolvable from flags or the env file */
  headless?: boolean;
  /** Headless BASE_URL */
  baseUrl?: string;
  /** Headless role list (comma-separated on the CLI) */
  roles?: string[];
  /** Headless challenge mode */
  challengeMode?: ChallengeMode;
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
  /** Contract validation status for requirements/login.md. */
  loginRequirementValidation?: RequirementValidationResult;
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

  // ─── Check-only mode (no prompts) ───────────────────────────────────────
  if (opts.checkOnly) {
    const appEnv = opts.appEnv ?? resolveAppEnv({ repoRoot: process.cwd() }).appEnv;
    return runCheckOnly(appEnv, opts.lang ?? DEFAULT_LANG);
  }

  // Interactive runs need a real TTY: clack's `select` does not block on a
  // non-TTY stdin (it resolves to the first option), which would silently pick a
  // wrong environment. Headless (--yes) and flag-complete runs skip this.
  const isTty = isInteractive();
  if (!opts.headless) {
    requireTty('Setup interaktif / Interactive setup');
  }

  intro(t(opts.lang ?? DEFAULT_LANG, 'qa-playwright-kit — setup', 'qa-playwright-kit — setup'));
  stepLine(
    t(
      opts.lang ?? DEFAULT_LANG,
      `${TOTAL_STEPS} tahap singkat — bahasa, environment, URL, kredensial, challenge, verifikasi.`,
      `${TOTAL_STEPS} short stages — language, environment, URL, credentials, challenge, verification.`,
    ),
  );

  // ─── Stage 1-5: bidirectional wizard stages ─────────────────────────────
  // A user can step BACK to a previous stage by choosing the explicit
  // "← Kembali" option in the stage's select. Values already collected are
  // re-used as defaults, so going back is cheap and no data is lost. Headless
  // runs supply every value via flags/env and never enter this loop.
  let lang: WizardLang = opts.lang ?? DEFAULT_LANG;
  let stage = 1;
  let appEnv!: AppEnv;
  let baseUrl!: string;
  let roleNames!: string[];
  let roleInputs: WizardRoleInput[] = [];
  let challengeMode!: ChallengeMode;
  let existing: Record<string, string> | null = null;
  let envPath = '';

  while (stage <= 5) {
    if (stage === 1) {
      printStep(1, TOTAL_STEPS, lang, 'Bahasa', 'Language');
      if (!opts.lang && !opts.headless) lang = await promptLanguage();
      stage = 2;
      continue;
    }

    if (stage === 2) {
      printStep(2, TOTAL_STEPS, lang, 'Environment (APP_ENV)', 'Environment (APP_ENV)');
      const defaultAppEnv = resolveAppEnv({ repoRoot: process.cwd() }).appEnv;
      if (opts.appEnv) {
        appEnv = opts.appEnv;
      } else if (opts.headless) {
        appEnv = defaultAppEnv;
      } else {
        const picked = await promptAppEnv(lang, appEnv ?? defaultAppEnv, true);
        if (picked === PREV) {
          stage = 1;
          continue;
        }
        appEnv = picked;
      }
      stage = 3;
      continue;
    }

    if (stage === 3) {
      // Existing-config check for the FINAL env (runs once when entering stage 3).
      existing = readExistingEnv(appEnv);
      envPath = resolveEnvPath(appEnv);
      if (existing && !opts.headless) {
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

      // Playwright browser availability (interactive only — install opens a
      // second terminal window a headless/CI run has no use for).
      if (!opts.headless) await ensureBrowsers(lang);

      printStep(3, TOTAL_STEPS, lang, 'URL aplikasi (BASE_URL)', 'Application BASE_URL');
      const existingUrl =
        existing && !isEncryptedValue(existing['BASE_URL']) ? existing['BASE_URL'] : undefined;
      if (opts.baseUrl) {
        baseUrl = opts.baseUrl;
      } else if (opts.headless) {
        // Headless cannot ask. An encrypted BASE_URL is unreadable here, so fail
        // loudly with the exact flag instead of hanging on stdin.
        throw new Error(
          t(
            lang,
            `Mode headless: BASE_URL tidak tersedia (${existing && isEncryptedValue(existing['BASE_URL']) ? 'nilai terenkripsi di env file' : 'env file belum ada'}). Jalankan dengan --base-url <url>.`,
            `Headless mode: BASE_URL unavailable (${existing && isEncryptedValue(existing['BASE_URL']) ? 'encrypted value in the env file' : 'no env file yet'}). Run with --base-url <url>.`,
          ),
        );
      } else {
        const picked = await promptBaseUrl(lang, baseUrl ?? existingUrl, true);
        if (picked === PREV) {
          stage = 2;
          continue;
        }
        baseUrl = picked;
      }
      stage = 4;
      continue;
    }

    if (stage === 4) {
      printStep(4, TOTAL_STEPS, lang, 'Kredensial & halaman role', 'Role credentials & pages');
      const existingRoles = existing ? detectExistingRoles(existing) : [];
      if (opts.roles) {
        roleNames = opts.roles;
      } else if (opts.headless) {
        // Prefer roles already detected in the env file; otherwise ask via flag.
        if (existingRoles.length > 0) {
          roleNames = existingRoles;
        } else {
          throw new Error(
            t(
              lang,
              'Mode headless: tidak ada role terdeteksi di env file dan --roles tidak diberikan (mis. npm run setup -- --yes --roles user).',
              'Headless mode: no roles detected in the env file and --roles was not given (e.g. npm run setup -- --yes --roles user).',
            ),
          );
        }
      } else {
        const picked = await promptRoles(
          lang,
          roleNames ?? (existingRoles.length > 0 ? existingRoles : undefined),
          true,
        );
        if (picked === PREV) {
          stage = 3;
          continue;
        }
        roleNames = picked;
      }

      roleInputs = [];
      for (const role of roleNames) {
        const existingFields = existing ? getExistingRoleFields(existing, role) : undefined;
        if (opts.headless) {
          // Headless has no way to ask for a password, so the role must already
          // be configured in the env file. Fail loudly instead of writing a file
          // with a missing password.
          if (!existingFields?.password) {
            throw new Error(
              t(
                lang,
                `Mode headless: role "${role}" belum punya kredensial di ${shortPath(envPath)}. Jalankan setup interaktif atau npm run env:edit.`,
                `Headless mode: role "${role}" has no credentials in ${shortPath(envPath)}. Run the interactive setup or npm run env:edit.`,
              ),
            );
          }
          roleInputs.push({ name: role, fields: existingFields as RoleFields });
          continue;
        }
        let fields: RoleFields | typeof BACK | undefined;
        do {
          fields = await promptRoleCredentials(lang, role, existingFields);
        } while (fields === BACK);
        roleInputs.push({ name: role, fields });
      }
      stage = 5;
      continue;
    }

    // stage === 5
    printStep(5, TOTAL_STEPS, lang, 'Mode challenge (OTP/CAPTCHA)', 'Challenge mode (OTP/CAPTCHA)');
    if (opts.challengeMode) {
      challengeMode = opts.challengeMode;
    } else if (opts.headless) {
      // No prompt in headless: reuse the env value or fall back to the safe
      // default (`none`). --challenge <mode> overrides.
      challengeMode = (existing?.['AUTH_CHALLENGE_MODE'] as ChallengeMode) ?? 'none';
    } else {
      const priorChallenge = challengeMode ?? existing?.['AUTH_CHALLENGE_MODE'];
      const picked = await promptChallengeMode(lang, priorChallenge, true);
      if (picked === PREV) {
        stage = 4;
        continue;
      }
      challengeMode = picked;
    }
    stage = 6;
  }

  // ─── Step 6: Preview (masked) + confirm before write ────────────────────
  printStep(6, TOTAL_STEPS, lang, 'Konfirmasi & verifikasi', 'Confirm & verify');
  printPreview({
    lang,
    appEnv,
    baseUrl,
    roles: roleInputs,
    challengeMode,
  });
  if (!opts.headless) {
    const ok = await confirmPrompt(
      t(lang, 'Tulis nilai-nilai ini ke file env?', 'Write these values to the env file?'),
      true,
    );
    if (!ok) throw new Error('SETUP_WIZARD_CANCELLED');
  }

  // ─── Phase: build + validate requirement, then write ─────────────────────
  printSection(lang, 'Menulis file', 'Writing files');

  // ─── Build requirements/login.md from this env + challenge ──────────────
  // Built and compiled BEFORE the env file is written and pinned: the old
  // order wrote + encrypted the env, then threw on an invalid requirement,
  // leaving a half-configured repo behind on a failed run.
  const requirement = await writeAndValidateLoginRequirement({
    repoRoot: process.cwd(),
    appEnv,
    baseUrl,
    roles: roleNames,
    roleInputs,
    challengeMode,
  });
  stepLine(
    t(
      lang,
      requirement.skipped
        ? `✓ ${requirement.relativePath} sudah ada (bukan auto-generated) — tidak ditimpa`
        : `✓ Requirement login ditulis: ${requirement.relativePath} (mode ${challengeMode})`,
      requirement.skipped
        ? `✓ ${requirement.relativePath} already exists (not auto-generated) — left intact`
        : `✓ Login requirement written: ${requirement.relativePath} (mode ${challengeMode})`,
    ),
  );

  const { write: writeResult, pin } = writeEnvAndPin({
    repoRoot: process.cwd(),
    appEnv,
    baseUrl,
    roles: roleInputs,
    challengeMode,
  });

  // The pin is written inside writeEnvAndPin: every later command (auth:setup,
  // qa:run, health:check) resolves APP_ENV through it. Without it the wizard
  // writes dev.env but the next command reads the default `local` profile,
  // which does not exist.
  stepLine(
    t(
      lang,
      `✓ File env ditulis: ${shortPath(writeResult.envFilePath)}`,
      `✓ Env file written: ${shortPath(writeResult.envFilePath)}`,
    ),
  );
  stepLine(
    pin.pinned
      ? t(
          lang,
          `✓ Environment aktif di-pin: APP_ENV=${appEnv} (config/environments/.active-env)`,
          `✓ Active environment pinned: APP_ENV=${appEnv} (config/environments/.active-env)`,
        )
      : t(
          lang,
          'ℹ Production tidak di-pin otomatis — jalankan: npm run env:use:production',
          'ℹ Production is not auto-pinned — run: npm run env:use:production',
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

  // ─── Regenerate src/support/auth.setup.ts with real per-role paths ───────
  const authWrite = writeAuthSetupFile({
    repoRoot: process.cwd(),
    appEnv,
    roleInputs,
  });
  stepLine(
    t(
      lang,
      authWrite.skipped
        ? `✓ Setup autentikasi: src/support/auth.setup.ts memiliki kustomisasi QA (// CUSTOM_AUTH_FLOW) — tidak ditimpa`
        : `✓ Setup autentikasi di-update: src/support/auth.setup.ts (${authWrite.roleCount} role)`,
      authWrite.skipped
        ? `✓ Auth setup: src/support/auth.setup.ts has custom QA flow (// CUSTOM_AUTH_FLOW) — left intact`
        : `✓ Auth setup updated: src/support/auth.setup.ts (${authWrite.roleCount} role)`,
    ),
  );

  // ─── Sync Agent Skills & MCP Configs ────────────────────────────────────
  const agentSync = syncAgentArtifacts(process.cwd());
  if (agentSync.skillsSynced.length > 0) {
    stepLine(
      t(
        lang,
        `✓ Agent skills disinkronkan: ${agentSync.skillsSynced.join(', ')}`,
        `✓ Agent skills synced: ${agentSync.skillsSynced.join(', ')}`,
      ),
    );
  }
  if (agentSync.mcpPlatforms.length > 0) {
    stepLine(
      t(
        lang,
        `✓ Config MCP dibuat untuk klien terdeteksi: ${agentSync.mcpPlatforms.join(', ')}`,
        `✓ MCP configs generated for detected clients: ${agentSync.mcpPlatforms.join(', ')}`,
      ),
    );
  } else {
    stepLine(
      t(
        lang,
        'ℹ Tidak ada klien AI lain terdeteksi — Hermes membaca .mcp.json langsung. Config klien lain: npm run mcp:config',
        'ℹ No other AI client detected — Hermes reads .mcp.json directly. Other clients: npm run mcp:config',
      ),
    );
  }
  if (agentSync.mcpServerBuilt) {
    stepLine(
      t(
        lang,
        '✓ MCP server dikompilasi: tools/mcp/dist/index-mcp.js',
        '✓ MCP server built: tools/mcp/dist/index-mcp.js',
      ),
    );
  }

  // ─── Validate (parse + reachability + roles) ────────────────────────────
  const freshEnv = readExistingEnv(appEnv);
  const validation = await validateSetup(appEnv, freshEnv, writeResult.envFilePath, lang);

  // ─── Materialize auth sessions (inline synchronous) ─────────────────────
  // Interactive only: auth:setup drives a real browser, so a headless run
  // leaves session creation to the caller's CI step.
  if (roleNames.length > 0 && validation.reachable && !opts.headless) {
    printSection(lang, 'Sesi autentikasi login', 'Login authentication sessions');
    const script = authSetupScript(challengeMode);
    const authCmd = `npm run ${script}`;
    const runAuth = await confirmPrompt(
      t(
        lang,
        `Buat sesi login sekarang via ${authCmd}?`,
        `Materialize login sessions now via ${authCmd}?`,
      ),
      true,
    );

    if (runAuth) {
      stepLine(
        t(lang, `Menjalankan ${authCmd} (mohon tunggu)...`, `Running ${authCmd} (please wait)...`),
      );
      const outcome = materializeAuthSession({
        repoRoot: process.cwd(),
        appEnv,
        challengeMode,
      });
      printAuthSessionOutcome(lang, outcome);
    } else {
      stepLine(
        t(
          lang,
          `ℹ Sesi login dilewati. Jalankan '${authCmd}' lalu 'npm run auth:verify' sebelum mengeksekusi test.`,
          `ℹ Login sessions skipped. Run '${authCmd}' then 'npm run auth:verify' before executing tests.`,
        ),
      );
    }
  }

  // ─── Phase: REAL artifact verification ──────────────────────────────────
  printSection(lang, 'Verifikasi artefak (nyata)', 'Artifact verification (real)');

  // The decrypt roundtrip shells out to dotenvx — a real wait, so show progress
  // instead of a frozen terminal. Skipped when not a TTY (no animation target).
  const verifySpin = isTty ? spinner() : null;
  verifySpin?.start(t(lang, 'Memverifikasi artefak…', 'Verifying artifacts…'));
  const checks = verifySetupArtifacts({
    repoRoot: process.cwd(),
    appEnv,
    envPath: writeResult.envFilePath,
    envMap: readExistingEnv(appEnv),
    roles: roleNames,
    lang,
    loginRequirementPath: requirement.relativePath,
    loginRequirementValid: requirement.validation.valid,
    loginRequirementError: requirement.validation.valid
      ? undefined
      : formatRequirementValidationFailure(requirement.validation),
    configValid: validation.valid,
    skillsSynced: agentSync.skillsSynced.length > 0,
    mcpPlatforms: agentSync.mcpPlatforms,
    hermesDetected: agentSync.hermesProfileSkillsDir != null,
  });
  verifySpin?.stop(t(lang, 'Artefak diverifikasi.', 'Artifacts verified.'));
  printChecklist(checks.map(toChecklistItem));

  // ─── Summary ────────────────────────────────────────────────────────────
  await printSummary({
    lang,
    appEnv,
    baseUrl,
    roles: roleInputs,
    challengeMode,
    writeResult,
    validation,
    agentSync,
    loginRequirementPath: requirement.relativePath,
    loginMarkdown: requirement.markdown,
    loginRequirementValidation: requirement.validation,
  });

  outro(
    validation.valid
      ? t(lang, 'Setup selesai — env siap dipakai.', 'Setup complete — env is ready.')
      : t(
          lang,
          'Setup selesai dengan peringatan — lihat checklist di atas.',
          'Setup finished with warnings — see the checklist above.',
        ),
  );

  return {
    envFilePath: writeResult.envFilePath,
    roles: roleNames,
    isNewSetup: writeResult.isNewFile,
    validation,
    checks,
    loginRequirementPath: requirement.relativePath,
    loginRequirementValidation: requirement.validation,
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

/** Render the outcome of the auth-session materialization attempt. */
function printAuthSessionOutcome(lang: WizardLang, outcome: AuthSessionOutcome): void {
  if (outcome.status === 'created') {
    stepLine(
      t(
        lang,
        `✓ Sesi login berhasil dibuat di .auth/${outcome.appEnv}/`,
        `✓ Login sessions successfully created in .auth/${outcome.appEnv}/`,
      ),
    );
    return;
  }
  if (outcome.status === 'spawn-error') {
    stepLine(
      t(
        lang,
        `⚠ Sesi login gagal dijalankan: ${outcome.detail}`,
        `⚠ Login session could not run: ${outcome.detail}`,
      ),
    );
    stepLine(
      t(
        lang,
        `  Pemulihan: npm run env:use:${outcome.appEnv}  →  npm run auth:setup  →  npm run auth:verify`,
        `  Recovery: npm run env:use:${outcome.appEnv}  →  npm run auth:setup  →  npm run auth:verify`,
      ),
    );
    return;
  }
  stepLine(
    t(
      lang,
      `⚠ Sesi login belum terbentuk (${outcome.detail}). Lihat pesan di atas, lalu: npm run auth:setup  →  npm run auth:verify`,
      `⚠ Login session was not created (${outcome.detail}). Check the output above, then: npm run auth:setup  →  npm run auth:verify`,
    ),
  );
}

/**
 * Show what the existing (active) env currently configures so the update/keep
 * decision is informed. Only NON-encrypted values are echoed — secrets stay
 * hidden on disk and are never printed back.
 */
function describeExistingEnv(lang: WizardLang, envMap: Record<string, string>): void {
  printSection(lang, 'Config saat ini', 'Current config');
  const plain = (key: string): string | undefined => {
    const v = envMap[key];
    return v && !isEncryptedValue(v) ? v : undefined;
  };

  const baseUrl = plain('BASE_URL');
  stepLine(`  BASE_URL     : ${baseUrl ?? t(lang, '(belum diisi)', '(not set)')}`);

  const loginPath = plain('AUTH_LOGIN_URL_PATH');
  const successPath = plain('AUTH_SUCCESS_URL_PATH');
  if (loginPath || successPath) {
    stepLine(
      `  ${t(lang, 'Login/Redirect', 'Login/Redirect')}: ${loginPath ?? '/login'} → ${successPath ?? '/dashboard'}`,
    );
  }

  const roles = detectExistingRoles(envMap);
  const roleParts = roles.map((role) => {
    const prefix = roleToEnvPrefix(role);
    const pw = envMap[`${prefix}_PASSWORD`];
    return isEncryptedValue(pw) ? `${role} ${t(lang, '(terenkripsi)', '(encrypted)')}` : role;
  });
  stepLine(
    `  ${t(lang, 'Roles', 'Roles')}        : ${roleParts.join(', ') || t(lang, 'tidak ada', 'none')}`,
  );

  const challenge = plain('AUTH_CHALLENGE_MODE');
  if (challenge) {
    stepLine(`  ${t(lang, 'Challenge', 'Challenge')}    : ${challenge}`);
  }
  const headless = plain('HEADLESS');
  const slowMo = plain('SLOW_MO');
  if (headless || slowMo) {
    stepLine(
      `  ${t(lang, 'Browser', 'Browser')}      : HEADLESS=${headless ?? 'true'}${slowMo ? ` · SLOW_MO=${slowMo}` : ''}`,
    );
  }
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
    const prefix = roleToEnvPrefix(r.name);
    const id = r.fields.email ?? r.fields.username ?? r.fields.phone ?? '-';
    const login = r.fields.loginUrlPath || '/login';
    const redir = r.fields.successUrlPath || '/dashboard';
    const company = r.fields.company ? ` [${r.fields.company}]` : '';
    stepLine(`  ${prefix.padEnd(13)}${id} / ********  [${login} → ${redir}]${company}`);
  }
}

/**
 * Roles already present in the env file. Uses the canonical parser so the
 * wizard agrees with wizard-validate / setup:check on what "configured" means.
 */
function detectExistingRoles(envMap: Record<string, string>): string[] {
  return parseRolesFromEnvMap(envMap).map((ref) => ref.name);
}

function getExistingRoleFields(
  envMap: Record<string, string>,
  role: string,
): Partial<RoleFields> | undefined {
  const prefix = roleToEnvPrefix(role);
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

  const company = envMap[`${prefix}_COMPANY`];
  if (company && !isEncryptedValue(company)) {
    fields.company = company;
  }

  return Object.keys(fields).length > 0 ? fields : undefined;
}

async function runCheckOnly(appEnv: AppEnv, lang: WizardLang): Promise<WizardResult> {
  const existing = readExistingEnv(appEnv);
  const envPath = resolveEnvPath(appEnv);
  const validation = await validateSetup(appEnv, existing, envPath, lang);
  const loginRequirementPath = 'requirements/login.md';
  const loginRequirementValidation = fs.existsSync(path.join(process.cwd(), loginRequirementPath))
    ? await validateRequirementFile(process.cwd(), loginRequirementPath)
    : undefined;

  // Sync / check skills and MCP
  const agentSync = syncAgentArtifacts(process.cwd());

  if (validation.valid) {
    console.log(t(lang, '✅ Config valid.', '✅ Config valid.'));
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

  console.log(
    `   ${t(lang, 'Dapat diakses', 'Reachable')}: ${validation.reachable ? 'ready' : 'pending'}`,
  );
  console.log(
    `   ${t(lang, 'Requirement', 'Requirement')}: ${loginRequirementValidation ? (loginRequirementValidation.valid ? 'valid' : 'invalid') : 'pending'}`,
  );
  // Session state comes from the filesystem, not a hardcoded "pending" string —
  // the old version reported pending even when a valid session existed, which
  // contradicted `npm run auth:verify`.
  const sessions = authSessionStatus(
    process.cwd(),
    appEnv,
    validation.rolesConfigured,
    (role) => existing?.[roleCredentialKeys(role).companyKey],
  );
  const authLine =
    sessions.ready.length > 0
      ? `ready — ${sessions.ready.join(', ')} (live check: npm run auth:verify)`
      : sessions.wrongTenant.length > 0
        ? `stale — sesi milik company lain: ${sessions.wrongTenant.join(', ')} (jalankan npm run auth:setup)`
        : sessions.tooSmall.length > 0
          ? `invalid — file terlalu kecil: ${sessions.tooSmall.join(', ')} (jalankan npm run auth:setup)`
          : `pending — belum dibuat: ${sessions.missing.join(', ') || 'no configured roles'}`;
  console.log(`   ${t(lang, 'Auth session', 'Auth sessions')}: ${authLine}`);
  if (sessions.ready.length > 0 && sessions.wrongTenant.length > 0) {
    console.log(
      `   ⚠ ${t(lang, 'Company lain', 'Wrong company')}: ${sessions.wrongTenant.join(', ')} — npm run auth:setup`,
    );
  }
  console.log(
    `   ${t(lang, 'Pipeline', 'Pipeline')}: ${
      sessions.ready.length > 0 && validation.valid
        ? 'ready — jalankan npm run qa:run'
        : 'blocked — perbaiki config/sesi dulu'
    }`,
  );
  console.log(
    `   ${t(lang, 'Role siap', 'Roles ready')}: ${sessions.ready.join(', ') || t(lang, 'tidak ada', 'none')}`,
  );
  if (agentSync.skillsSynced.length > 0) {
    const dest = agentSync.hermesProfileSkillsDir ? ` (${agentSync.hermesProfileSkillsDir})` : '';
    console.log(`   Skills synced: ${agentSync.skillsSynced.join(', ')}${dest}`);
  }
  if (agentSync.learnedSkillsSynced.length > 0) {
    console.log(
      `   ${t(lang, 'Skill hasil belajar', 'Learned skills')}: ${agentSync.learnedSkillsSynced.join(', ')} (${LEARNED_SKILLS_DIR}/)`,
    );
  }
  for (const error of agentSync.errors) {
    console.log(`   ${t(lang, 'Peringatan skill', 'Skill warning')}: ${error}`);
  }
  if (agentSync.mcpPlatforms.length > 0) {
    console.log(`   MCP configs: ready (${agentSync.mcpPlatforms.join(', ')})`);
  } else {
    console.log('   MCP configs: none needed (Hermes reads .mcp.json directly)');
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
  if (loginRequirementValidation && !loginRequirementValidation.valid) {
    console.log(`   ERROR: ${formatRequirementValidationFailure(loginRequirementValidation)}`);
  }

  return {
    envFilePath: envPath,
    roles: validation.rolesReady,
    isNewSetup: false,
    validation,
    checks: [],
  };
}

async function printSummary(data: {
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
  loginRequirementValidation?: RequirementValidationResult;
}): Promise<void> {
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
    `  ${t(lang, 'Config', 'Config')}       : ${data.validation.valid ? 'valid' : 'invalid'}`,
  );
  stepLine(
    `  ${t(lang, 'Dapat diakses', 'Reachable')}   : ${data.validation.reachable ? 'ready' : 'pending'}`,
  );
  if (data.loginRequirementValidation) {
    stepLine(
      `  ${t(lang, 'Requirement', 'Requirement')}: ${data.loginRequirementValidation.valid ? 'valid' : 'invalid'}`,
    );
  }
  // Session + pipeline lines come from the filesystem, not a hardcoded
  // "pending" string. The summary used to contradict the checklist printed
  // ~20 lines earlier (and `npm run auth:verify`).
  const sessions = authSessionStatus(
    process.cwd(),
    data.appEnv,
    data.roles.map((r) => r.name),
    (role) => data.roles.find((r) => r.name === role)?.fields.company,
  );
  stepLine(
    sessions.ready.length > 0
      ? `  ${t(lang, 'Auth session', 'Auth sessions')}: ready — ${sessions.ready.join(', ')}${sessions.wrongTenant.length > 0 ? ` | ⚠ company lain: ${sessions.wrongTenant.join(', ')} → npm run auth:setup` : ''} (verify: npm run auth:verify)`
      : `  ${t(lang, 'Auth session', 'Auth sessions')}: pending — jalankan npm run auth:setup${data.challengeMode !== 'none' ? ':headed' : ''}${sessions.wrongTenant.length > 0 ? ` (sesi company lain: ${sessions.wrongTenant.join(', ')})` : ''}${sessions.tooSmall.length > 0 ? ` (file terlalu kecil: ${sessions.tooSmall.join(', ')})` : ''}`,
  );
  stepLine(
    `  ${t(lang, 'Pipeline', 'Pipeline')}    : ${
      sessions.ready.length > 0 && data.validation.valid
        ? 'ready — jalankan npm run qa:run'
        : 'blocked — selesaikan sesi/config dulu'
    }`,
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
    console.log('      1. npm run auth:setup:headed');
    stepLine(
      t(
        lang,
        '         (pastikan sesi OTP/CAPTCHA tersimpan sebelum menjalankan test)',
        '         (ensure OTP/CAPTCHA session is saved before running tests)',
      ),
    );
    console.log(
      `      2. ${t(lang, 'paste prompt Hermes di bawah (atau CLI: npm run qa:workflow)', 'paste the Hermes prompt below (or CLI: npm run qa:workflow)')}`,
    );
  } else {
    stepLine(`  ℹ ${t(lang, 'Langkah berikutnya:', 'Next steps:')}`);
    console.log(
      `      1. ${t(lang, 'paste prompt Hermes di bawah (atau CLI: npm run qa:workflow)', 'paste the Hermes prompt below (or CLI: npm run qa:workflow)')}`,
    );
  }

  if (data.loginRequirementPath) {
    stepLine(`  ${t(lang, 'Requirement', 'Requirement')}: ${data.loginRequirementPath}`);
  }

  const hermesDetected = data.agentSync?.hermesProfileSkillsDir != null;
  if (data.loginRequirementPath && data.loginMarkdown && data.loginRequirementValidation?.valid) {
    if (!hermesDetected) {
      const hermesBorder = '─'.repeat(70);
      console.log('');
      console.log(`  ┌${hermesBorder}┐`);
      stepLine(
        `  │  ⚠  ${t(
          lang,
          'HERMES AGENT TIDAK TERDETEKSI di komputer ini.'.padEnd(46),
          'HERMES AGENT NOT DETECTED on this machine.'.padEnd(41),
        ).padEnd(66)}│`,
      );
      stepLine(
        `  │  ${t(
          lang,
          'Jalur 1 (disarankan): install Hermes Agent —',
          'Path 1 (recommended): install Hermes Agent —',
        ).padEnd(64)}│`,
      );
      stepLine(`  │     https://hermes-agent.nousresearch.com`.padEnd(68) + '│');
      stepLine(
        `  │  ${t(
          lang,
          'Jalur 2 (manual, tetap first-class): jalankan',
          'Path 2 (manual, still first-class): run',
        ).padEnd(62)}│`,
      );
      stepLine(
        `  │     npx tsx tools/scripts/workflow-run.ts ${data.loginRequirementPath}`.padEnd(68) +
          '│',
      );
      stepLine(
        `  │     ${t(
          lang,
          'lalu ikuti instruksi nextRequiredAction saat jeda di Generate.',
          'then follow the nextRequiredAction instructions when paused.',
        ).padEnd(59)}│`,
      );
      console.log(`  └${hermesBorder}┘`);
    }
    const prompt = buildAgentPrompt(data.loginRequirementPath, data.loginMarkdown, lang, {
      baseUrl: data.baseUrl,
      appEnv: data.appEnv,
      appEnvSource: resolveAppEnv({ repoRoot: process.cwd() }).source,
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

    console.log('');
    const boxBorder = '─'.repeat(70);
    console.log(`  ┌${boxBorder}┐`);
    stepLine(
      `  │  🚀 ${t(lang, 'SETELAH LOGIN: BAGAIMANA CARA MENGUJI FITUR BERIKUTNYA?', 'AFTER LOGIN: HOW TO TEST NEXT FEATURES?').padEnd(68)}│`,
    );
    console.log(`  ├${boxBorder}┤`);
    stepLine(
      `  │  ${t(lang, 'Anda TIDAK PERLU mengetik file kode atau Markdown manual. Cukup chat:', 'You DO NOT need to write code or Markdown manually. Simply chat:').padEnd(68)}│`,
    );
    console.log(`  │  ${' '.repeat(68)}│`);
    stepLine(
      `  │  👉 ${t(lang, 'Jalur 1 (Dari URL Halaman):', 'Path 1 (From Page URL):').padEnd(65)}│`,
    );
    stepLine(
      `  │     "Hermes, tolong buatkan test untuk halaman <URL> (role: <role>)"`.padEnd(70) + '│',
    );
    stepLine(
      `  │     ${t(lang, 'Hermes otomatis crawl UI (snapshot_page) & buat skenarionya.', 'Hermes crawls UI automatically (snapshot_page) & writes scenarios.').padEnd(65)}│`,
    );
    console.log(`  │  ${' '.repeat(68)}│`);
    stepLine(
      `  │  👉 ${t(lang, 'Jalur 2 (Dari Tiket Jira / PRD):', 'Path 2 (From Jira / PRD Ticket):').padEnd(65)}│`,
    );
    stepLine(
      `  │     "Hermes, tolong buatkan test dari kriteria tiket ini: [paste]"`.padEnd(70) + '│',
    );
    stepLine(
      `  │     ${t(lang, 'Hermes membedah cerita menjadi acceptance criteria & skenario.', 'Hermes decomposes requirements into criteria & test scenarios.').padEnd(65)}│`,
    );
    console.log(`  └${boxBorder}┘`);

    const pasted = prompt.trimEnd();
    const copied = await copyText(pasted);
    // Terminal-only by design: no OS message-box is spawned (it blocks or fails
    // on headless hosts). The prompt is already printed above.
    stepLine(
      copied
        ? t(
            lang,
            '✓ Prompt Hermes disalin ke clipboard — tempel (Ctrl+V) ke chat Hermes.',
            '✓ Hermes prompt copied to clipboard — paste (Ctrl+V) into the Hermes chat.',
          )
        : t(
            lang,
            'ℹ Clipboard tidak tersedia — salin blok di atas secara manual.',
            'ℹ Clipboard unavailable — copy the block above by hand.',
          ),
    );
  }

  console.log(line);
  console.log('');
}
