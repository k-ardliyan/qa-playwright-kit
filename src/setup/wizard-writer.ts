/**
 * Setup Wizard — environment file writer.
 *
 * Generates a clean, minimal `config/environments/{APP_ENV}.env` (see
 * `src/utils/env-clean.ts`): only keys that are actually set, grouped in
 * sections, no commented-out placeholders. `*.env.example` stays the
 * commented documentation — it is never copied into the derived file.
 *
 * Wizard values upsert over the previous file's active plaintext extras
 * (SLOW_MO, PLAYWRIGHT_CONFIG, extra roles, free keys). Then secret keys
 * (`*_PASSWORD` / `*_SECRET` / `*_TOKEN`) are encrypted; identifiers, URLs,
 * and flags stay plaintext so QA can edit them in the file.
 *
 * @module src/setup/wizard-writer
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { type AppEnv } from '../utils/app-env';
import { type ChallengeMode } from '../support/human-challenge';
import { type WizardRoleInput, normalizeWizardRoles } from '../shared/utils/role-credentials';
import { parseEnvText } from '../utils/env-text';
import { buildCleanEnvContent, ENV_FILE_DEFAULTS } from '../utils/env-clean';
import { encryptSecretKeysInFile } from '../utils/env-secrets';

export interface EnvWriteOptions {
  appEnv: AppEnv;
  baseUrl: string;
  roles: WizardRoleInput[];
  challengeMode: ChallengeMode;
}

export interface EnvWriteResult {
  /** Absolute path of the written env file */
  envFilePath: string;
  /** Whether this was a new file or an update */
  isNewFile: boolean;
  /** Number of keys written/updated */
  keysWritten: number;
  /** Number of existing keys preserved */
  keysPreserved: number;
  /** Secret keys encrypted after write */
  keysEncrypted: string[];
  /** Non-fatal warnings from the role normalization */
  warnings: string[];
}

/** True when a value is dotenvx ciphertext. */
export function isEncryptedValue(v: string | undefined | null): boolean {
  return Boolean(v && v.trim().startsWith('encrypted:'));
}

/**
 * Read existing env file into a flat key-value map.
 * Returns null if the file does not exist.
 * Ciphertext values are returned as-is (callers must skip via isEncryptedValue).
 */
export function readExistingEnv(appEnv: AppEnv): Record<string, string> | null {
  const envPath = resolveEnvPath(appEnv);
  if (!fs.existsSync(envPath)) return null;
  return parseEnvText(fs.readFileSync(envPath, 'utf-8'));
}

function challengeHeadless(mode: ChallengeMode): 'true' | 'false' {
  if (mode === 'otp-browser' || mode === 'captcha-browser' || mode === 'auto') {
    return 'false';
  }
  return 'true';
}

export interface BuiltEnvFile {
  content: string;
  keysWritten: number;
  keysPreserved: number;
  warnings: string[];
}

/**
 * Generate clean env file content (no example copy): wizard values over
 * preserved existing plaintext extras, plus canonical defaults. Pure-ish
 * (reads the existing env file) — no encrypt. Used by writeEnvFile and tests.
 */
export function buildEnvFileContent(options: EnvWriteOptions): BuiltEnvFile {
  const { appEnv, baseUrl, roles, challengeMode } = options;
  const existing = readExistingEnv(appEnv) ?? {};
  const values: Record<string, string> = {};
  const wizardKeys = new Set<string>();
  const put = (key: string, value: string): void => {
    values[key] = value;
    wizardKeys.add(key);
  };

  put('BASE_URL', baseUrl);
  put('AUTH_CHALLENGE_MODE', challengeMode);
  put('HEADLESS', challengeHeadless(challengeMode));

  const { envUpserts, warnings } = normalizeWizardRoles(roles);
  for (const [key, value] of Object.entries(envUpserts)) {
    put(key, value);
  }

  let keysPreserved = 0;
  for (const [key, value] of Object.entries(existing)) {
    if (wizardKeys.has(key)) continue;
    if (key.startsWith('DOTENV_')) continue;
    if (isEncryptedValue(value)) continue;
    if (value.trim() === '') continue;
    values[key] = value;
    keysPreserved += 1;
  }

  for (const [key, value] of Object.entries(ENV_FILE_DEFAULTS)) {
    if (!(key in values)) values[key] = value;
  }

  return {
    content: buildCleanEnvContent({ appEnv, values }),
    keysWritten: wizardKeys.size,
    keysPreserved,
    warnings,
  };
}

/**
 * Generate the clean env file, write it, encrypt secrets.
 * Existing non-wizard plaintext keys (SLOW_MO, PLAYWRIGHT_CONFIG, extra roles,
 * free keys) are carried over. Ciphertext leftovers are not carried —
 * re-enter via wizard/env:edit.
 */
export function writeEnvFile(options: EnvWriteOptions): EnvWriteResult {
  const { appEnv } = options;
  const repoRoot = findRepoRoot();
  const envPath = resolveEnvPath(appEnv);
  const isNewFile = !fs.existsSync(envPath);
  const built = buildEnvFileContent(options);

  const dir = path.dirname(envPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(envPath, built.content, 'utf-8');

  const { encryptedKeys } = encryptSecretKeysInFile(envPath, { repoRoot });

  return {
    envFilePath: envPath,
    isNewFile,
    keysWritten: built.keysWritten,
    keysPreserved: built.keysPreserved,
    keysEncrypted: encryptedKeys,
    warnings: built.warnings,
  };
}

/**
 * Resolve the env file path for a given APP_ENV.
 * Canonical (only) location: config/environments/{APP_ENV}.env
 */
export function resolveEnvPath(appEnv: AppEnv): string {
  return path.join(findRepoRoot(), 'config', 'environments', `${appEnv}.env`);
}

function findRepoRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 12; i += 1) {
    if (fs.existsSync(path.join(dir, 'package.json'))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}
