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
import * as os from 'node:os';
import * as path from 'node:path';
import { type AppEnv, writeActiveEnvPin } from '../utils/app-env';
import { type ChallengeMode } from '../support/human-challenge';
import {
  type WizardRoleInput,
  normalizeWizardRoles,
  roleToEnvPrefix,
  ROLE_KEY_RE,
} from '../shared/utils/role-credentials';
import { parseEnvText } from '../utils/env-text';
import { buildCleanEnvContent, ENV_FILE_DEFAULTS } from '../utils/env-clean';
import { encryptSecretKeysInFile } from '../utils/env-secrets';
import { getGlobalKeysPath, mergeLocalKeysIntoSecure } from '../utils/dotenv-keys';

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

  const configuredPrefixes = new Set(roles.map((r) => roleToEnvPrefix(r.name)));

  let keysPreserved = 0;
  for (const [key, value] of Object.entries(existing)) {
    if (wizardKeys.has(key)) continue;
    if (key.startsWith('DOTENV_')) continue;
    if (isEncryptedValue(value)) continue;
    if (value.trim() === '') continue;

    // Do NOT preserve credential/path keys of removed roles (e.g. stale TEST_USER_* when switching to admin,guru,murid)
    const m = ROLE_KEY_RE.exec(key);
    if (m && !configuredPrefixes.has(m[1])) {
      continue;
    }

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

  // Encrypt on a staging file outside the repo, then swap it in atomically.
  // Writing the plaintext straight to envPath (the old flow) left passwords on
  // disk whenever dotenvx failed or the wizard was Ctrl+C'd mid-encrypt.
  const encryptedKeys = encryptToStagingThenSwap({
    repoRoot,
    envPath,
    content: built.content,
  });

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
 * Write `content` to a staging file, encrypt it, then atomically rename it over
 * `envPath`. The staging file keeps `envPath`'s exact basename because dotenvx
 * derives the `DOTENV_PUBLIC_KEY_*` name from it — a different basename would
 * mint a key that no existing `.env.keys` entry can decrypt.
 *
 * The staging dir also catches the `.env.keys` dotenvx mints when no global keys
 * file exists yet: `migrateWorkspaceEnvKeys` only scans two fixed repo paths, so
 * a staging-dir mint would otherwise be dropped and the next decrypt would fail.
 */
function encryptToStagingThenSwap(opts: {
  repoRoot: string;
  envPath: string;
  content: string;
}): string[] {
  const { repoRoot, envPath, content } = opts;
  const stageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-env-'));
  const stagedPath = path.join(stageDir, path.basename(envPath));
  // Same directory as the target so the rename stays one atomic filesystem op.
  const swapPath = `${envPath}.${process.pid}.tmp`;

  try {
    fs.writeFileSync(stagedPath, content, 'utf-8');
    const { encryptedKeys } = encryptSecretKeysInFile(stagedPath, { repoRoot });

    const stagedKeys = path.join(stageDir, '.env.keys');
    if (fs.existsSync(stagedKeys)) {
      mergeLocalKeysIntoSecure(stagedKeys, getGlobalKeysPath(repoRoot));
    }

    fs.copyFileSync(stagedPath, swapPath);
    fs.renameSync(swapPath, envPath);
    return encryptedKeys;
  } catch (err: unknown) {
    fs.rmSync(swapPath, { force: true });
    throw err;
  } finally {
    fs.rmSync(stageDir, { recursive: true, force: true });
  }
}

/**
 * Resolve the env file path for a given APP_ENV.
 * Canonical (only) location: config/environments/{APP_ENV}.env
 */
export function resolveEnvPath(appEnv: AppEnv): string {
  return path.join(findRepoRoot(), 'config', 'environments', `${appEnv}.env`);
}

export interface PinResult {
  pinned: boolean;
  reason?: 'production-requires-explicit-pin';
}

/**
 * Publish the wizard's APP_ENV as the active pin.
 *
 * Without this the wizard writes `config/environments/<env>.env` but the next
 * command still resolves the default `local` profile (which the wizard never
 * created), so `auth:setup` falls back to the `.example` template and fails
 * with "missing or placeholder credentials" — while the wizard reported
 * success. Production is deliberately NOT auto-pinned: `env:use:production`
 * owns that decision (it requires --i-know).
 */
export function pinEnvAfterSetup(repoRoot: string, appEnv: AppEnv): PinResult {
  if (appEnv === 'production') {
    return { pinned: false, reason: 'production-requires-explicit-pin' };
  }
  writeActiveEnvPin(repoRoot, appEnv);
  return { pinned: true };
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
