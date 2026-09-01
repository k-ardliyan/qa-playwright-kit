/**
 * Setup Wizard — real artifact verification.
 *
 * After the wizard writes files, this module checks that everything is
 * actually installed/created correctly — file existence, parseability,
 * ciphertext on disk, a REAL dotenvx decrypt roundtrip against the written
 * env file, browser availability, and generated artifacts (login.md, agent
 * skills, MCP configs, auth session files).
 *
 * Every check returns pass/warn/fail plus an actionable fix hint so the
 * summary never says "done" without evidence.
 *
 * @module src/setup/verify-setup
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { type AppEnv } from '../utils/app-env';
import { parseEnvText, isEncryptedEnvText } from '../utils/env-text';
import { isSecretEnvKey, decryptEnvFileToText, EnvEncryptError } from '../utils/env-secrets';
import { getGlobalKeysPath } from '../utils/dotenv-keys';
import { hasChromiumInstalled } from './browser-check';
import { type WizardLang, t } from './i18n';

export type CheckStatus = 'pass' | 'warn' | 'fail';

export interface SetupCheck {
  id: string;
  label: string;
  status: CheckStatus;
  detail?: string;
  fix?: string;
  /** fail on a critical check → setup cannot be considered done. */
  critical?: boolean;
}

export interface VerifySetupOptions {
  repoRoot: string;
  appEnv: AppEnv;
  envPath: string;
  envMap: Record<string, string> | null;
  roles: string[];
  lang: WizardLang;
  /** Relative path of the generated login requirement (optional). */
  loginRequirementPath?: string;
  /** Whether skill sync reported success (from syncAgentSkillsAndMcp). */
  skillsSynced?: boolean;
  /** Whether MCP config generation reported success. */
  mcpConfigsGenerated?: boolean;
}

function labelFor(lang: WizardLang, id: string, en: string): string {
  return t(lang, id, en);
}

function resolveLocalKeysCandidates(repoRoot: string): string[] {
  return [
    path.join(repoRoot, 'config', 'environments', '.env.keys'),
    path.join(repoRoot, '.env.keys'),
  ];
}

/** True when a dotenvx keys file exists anywhere the loader would look. */
function keysFileExists(repoRoot: string): boolean {
  if (fs.existsSync(getGlobalKeysPath(repoRoot))) return true;
  return resolveLocalKeysCandidates(repoRoot).some((p) => fs.existsSync(p));
}

/**
 * Run all artifact checks. `decrypt_roundtrip` spawns the real dotenvx CLI —
 * everything else is filesystem-only and fast.
 */
export function verifySetupArtifacts(opts: VerifySetupOptions): SetupCheck[] {
  const { repoRoot, appEnv, envPath, envMap, roles, lang } = opts;
  const checks: SetupCheck[] = [];
  const add = (check: SetupCheck): void => {
    checks.push(check);
  };

  // ── 1. Dependencies installed ──
  const pwTest = path.join(repoRoot, 'node_modules', '@playwright', 'test');
  add({
    id: 'deps',
    label: labelFor(lang, 'Dependencies (@playwright/test)', 'Dependencies (@playwright/test)'),
    status: fs.existsSync(pwTest) ? 'pass' : 'fail',
    fix: fs.existsSync(pwTest) ? undefined : 'npm install',
    critical: true,
  });

  // ── 2. Playwright config file ──
  const pwConfig = envMap?.['PLAYWRIGHT_CONFIG']?.trim();
  if (pwConfig) {
    const configPath = path.join(repoRoot, pwConfig);
    const exists = fs.existsSync(configPath);
    add({
      id: 'playwright_config',
      label: labelFor(lang, 'Config Playwright', 'Playwright config'),
      status: exists ? 'pass' : 'fail',
      detail: pwConfig,
      fix: exists
        ? undefined
        : labelFor(
            lang,
            `File tidak ada — restore ${pwConfig} dari repo`,
            `File missing — restore ${pwConfig} from the repo`,
          ),
      critical: true,
    });
  }

  // ── 3. Chromium browser ──
  add({
    id: 'chromium',
    label: labelFor(lang, 'Browser Chromium (Playwright)', 'Chromium browser (Playwright)'),
    status: hasChromiumInstalled() ? 'pass' : 'warn',
    fix: hasChromiumInstalled() ? undefined : 'npx playwright install chromium',
  });

  // ── 4. Env file exists + BASE_URL ──
  const baseUrl = envMap?.['BASE_URL']?.trim() ?? '';
  add({
    id: 'env_file',
    label: labelFor(lang, 'File env (BASE_URL + kredensial)', 'Env file (BASE_URL + credentials)'),
    status: baseUrl ? 'pass' : 'fail',
    detail: path.relative(repoRoot, envPath),
    fix: baseUrl
      ? undefined
      : labelFor(lang, 'Isi BASE_URL via npm run env:edit', 'Set BASE_URL via npm run env:edit'),
    critical: true,
  });

  // ── 5. Secrets are ciphertext on disk ──
  const rawEnv = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf-8') : '';
  const diskMap = parseEnvText(rawEnv);
  const plaintextSecrets = Object.entries(diskMap)
    .filter(([k, v]) => isSecretEnvKey(k) && v !== '' && !v.startsWith('encrypted:'))
    .map(([k]) => k);
  add({
    id: 'env_secrets_encrypted',
    label: labelFor(lang, 'Secret terenkripsi di disk', 'Secrets encrypted on disk'),
    status: plaintextSecrets.length === 0 ? 'pass' : 'warn',
    detail:
      plaintextSecrets.length > 0
        ? labelFor(
            lang,
            `plaintext: ${plaintextSecrets.join(', ')}`,
            `plaintext: ${plaintextSecrets.join(', ')}`,
          )
        : undefined,
    fix:
      plaintextSecrets.length > 0
        ? labelFor(
            lang,
            'npm run env:edit → Simpan & encrypt (CI plaintext sengaja boleh diabaikan)',
            'npm run env:edit → Save & encrypt (intentional CI plaintext may stay)',
          )
        : undefined,
  });

  // ── 6. Keys file present when needed ──
  const encrypted = isEncryptedEnvText(rawEnv);
  add({
    id: 'keys_file',
    label: labelFor(lang, 'File kunci dotenvx', 'dotenvx keys file'),
    status: !encrypted || keysFileExists(repoRoot) ? 'pass' : 'fail',
    detail: encrypted ? '~/.dotenvx-keys/<project>/.env.keys' : undefined,
    fix: encrypted
      ? undefined
      : labelFor(
          lang,
          'Restore ~/.dotenvx-keys/<project>/.env.keys dari tim yang punya akses',
          'Restore ~/.dotenvx-keys/<project>/.env.keys from a team member with access',
        ),
    critical: true,
  });

  // ── 7. REAL decrypt roundtrip ──
  if (encrypted) {
    try {
      const plain = parseEnvText(decryptEnvFileToText(envPath, { repoRoot }));
      const roundtripOk =
        (plain['BASE_URL'] ?? '').trim() === baseUrl &&
        Object.entries(diskMap).every(
          ([k, v]) => !isSecretEnvKey(k) || v === '' || (plain[k] ?? '') !== '',
        );
      add({
        id: 'decrypt_roundtrip',
        label: labelFor(
          lang,
          'Decrypt roundtrip (dotenvx asli)',
          'Decrypt roundtrip (real dotenvx)',
        ),
        status: roundtripOk ? 'pass' : 'fail',
        critical: true,
        fix: roundtripOk
          ? undefined
          : labelFor(
              lang,
              'npm run env:edit — isi ulang kredensial, lalu Simpan & encrypt',
              'npm run env:edit — re-enter credentials, then Save & encrypt',
            ),
      });
    } catch (err: unknown) {
      const detail = err instanceof EnvEncryptError ? err.message : String(err);
      add({
        id: 'decrypt_roundtrip',
        label: labelFor(
          lang,
          'Decrypt roundtrip (dotenvx asli)',
          'Decrypt roundtrip (real dotenvx)',
        ),
        status: 'fail',
        detail,
        critical: true,
        fix: labelFor(
          lang,
          'Cek ~/.dotenvx-keys/<project>/.env.keys, atau buat ulang via npm run setup',
          'Check ~/.dotenvx-keys/<project>/.env.keys, or recreate via npm run setup',
        ),
      });
    }
  }

  // ── 8. Login requirement written ──
  if (opts.loginRequirementPath) {
    const reqAbs = path.join(repoRoot, opts.loginRequirementPath);
    const exists = fs.existsSync(reqAbs);
    add({
      id: 'login_requirement',
      label: labelFor(lang, 'Requirement login', 'Login requirement'),
      status: exists ? 'pass' : 'warn',
      detail: opts.loginRequirementPath,
      fix: exists
        ? undefined
        : labelFor(
            lang,
            'Jalankan ulang npm run setup (auto-generated, file custom tidak ditimpa)',
            'Re-run npm run setup (auto-generated; custom files are left intact)',
          ),
    });
  }

  // ── 9. Agent skills synced ──
  const skillFile = path.join(repoRoot, '.agents', 'skills', 'qa-playwright-kit', 'SKILL.md');
  add({
    id: 'skills_synced',
    label: labelFor(lang, 'Agent skills (.agents/skills)', 'Agent skills (.agents/skills)'),
    status: fs.existsSync(skillFile) ? 'pass' : 'warn',
    fix: fs.existsSync(skillFile)
      ? undefined
      : labelFor(
          lang,
          'Jalankan ulang npm run setup (step sync skills)',
          'Re-run npm run setup (skill sync step)',
        ),
  });

  // ── 10. MCP configs generated ──
  const mcpTargets = [
    path.join(repoRoot, '.cursor', 'mcp.json'),
    path.join(repoRoot, '.kiro', 'mcp.json'),
    path.join(repoRoot, '.codex', 'config.toml'),
    path.join(repoRoot, 'claude_desktop_config.json'),
  ];
  const missingMcp = mcpTargets.filter((p) => !fs.existsSync(p));
  add({
    id: 'mcp_configs',
    label: labelFor(lang, 'Config MCP lintas platform', 'Cross-platform MCP configs'),
    status: missingMcp.length === 0 ? 'pass' : 'warn',
    detail:
      missingMcp.length > 0
        ? missingMcp.map((p) => path.relative(repoRoot, p)).join(', ')
        : undefined,
    fix:
      missingMcp.length > 0
        ? labelFor(
            lang,
            'Jalankan ulang npm run setup, atau npm run mcp:config',
            'Re-run npm run setup, or npm run mcp:config',
          )
        : undefined,
  });

  // ── 11. Auth session files per role ──
  if (roles.length > 0) {
    const missingAuth = roles
      .map((r) => `.auth/${appEnv}/${r}.json`)
      .filter((rel) => !fs.existsSync(path.join(repoRoot, rel)));
    add({
      id: 'auth_files',
      label: labelFor(lang, 'Sesi login role (.auth/)', 'Role login sessions (.auth/)'),
      status: missingAuth.length === 0 ? 'pass' : 'warn',
      detail:
        missingAuth.length > 0
          ? labelFor(
              lang,
              `belum dibuat: ${missingAuth.join(', ')}`,
              `not created yet: ${missingAuth.join(', ')}`,
            )
          : undefined,
      fix:
        missingAuth.length > 0
          ? labelFor(
              lang,
              'npm run auth:setup (OTP/CAPTCHA: npm run auth:setup:headed)',
              'npm run auth:setup (OTP/CAPTCHA: npm run auth:setup:headed)',
            )
          : undefined,
    });
  }

  return checks;
}

/** True when any critical check failed — the run is not actually usable. */
export function hasCriticalFailure(checks: SetupCheck[]): boolean {
  return checks.some((c) => c.critical && c.status === 'fail');
}
