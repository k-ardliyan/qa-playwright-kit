/**
 * Setup Wizard — post-write validation.
 *
 * Verifies the env file is parseable, BASE_URL reachable,
 * and role credentials are login-ready (not template placeholders).
 * Messages are bilingual (id/en) — language follows the wizard choice.
 *
 * @module src/setup/wizard-validate
 */

import type { AppEnv } from '../utils/app-env';
import {
  isRoleLoginReady,
  roleCredentialKeys,
  isPlaceholderCredential,
} from '../shared/utils/role-credentials';
import { isEncryptedValue } from './wizard-writer';
import { checkReachable } from './reachability';
import { type WizardLang, t } from './i18n';

export { isReachableStatus, checkReachable } from './reachability';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  /** BASE_URL reachable via HEAD request */
  reachable: boolean;
  /** Roles with complete, non-template credentials */
  rolesReady: string[];
  /** Roles with missing or template-placeholder credentials */
  rolesIncomplete: string[];
  /** Roles with encrypted (dotenvx) credentials — cannot verify */
  rolesEncrypted: string[];
  /** Absolute path to the validated env file */
  envFilePath: string | null;
}

/**
 * Validate the setup for a given APP_ENV.
 *
 * Checks:
 * 1. Env file exists and is parseable
 * 2. BASE_URL is reachable (HEAD request, 5s timeout)
 * 3. All role credentials are login-ready (not template placeholders)
 * 4. AUTH_CHALLENGE_MODE is valid
 * 5. .auth directory exists or can be created
 */
export async function validateSetup(
  appEnv: AppEnv,
  envMap: Record<string, string> | null,
  envFilePath: string | null,
  lang: WizardLang = 'id',
): Promise<ValidationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];

  // 1. File existence
  if (!envMap || !envFilePath) {
    return {
      valid: false,
      errors: [
        t(
          lang,
          `Tidak ada file env untuk APP_ENV=${appEnv}`,
          `No env file found for APP_ENV=${appEnv}`,
        ),
      ],
      warnings: [],
      reachable: false,
      rolesReady: [],
      rolesIncomplete: [],
      rolesEncrypted: [],
      envFilePath: null,
    };
  }

  // 2. BASE_URL
  const baseUrl = envMap['BASE_URL'] ?? '';
  if (!baseUrl) {
    errors.push(t(lang, 'BASE_URL belum diisi', 'BASE_URL is not set'));
  }

  let reachable = false;
  if (isEncryptedValue(baseUrl)) {
    warnings.push(
      t(
        lang,
        'BASE_URL terenkripsi — reachability tidak dicek (update via: npm run env:edit)',
        'BASE_URL is encrypted — reachability not checked (update via: npm run env:edit)',
      ),
    );
  } else if (baseUrl) {
    reachable = await checkReachable(baseUrl);
    if (!reachable) {
      warnings.push(
        t(
          lang,
          `BASE_URL (${baseUrl}) tidak bisa diakses — test mungkin gagal`,
          `BASE_URL (${baseUrl}) is not reachable — tests may fail`,
        ),
      );
    }
  }

  // 3. Role credentials
  const rolesReady: string[] = [];
  const rolesIncomplete: string[] = [];
  const rolesEncrypted: string[] = [];

  // Check 'user' role (TEST_USER_*)
  const userKeys = roleCredentialKeys('user');
  const userHasEncrypted =
    isEncryptedValue(envMap[userKeys.passwordKey]) ||
    isEncryptedValue(envMap[userKeys.emailKey]) ||
    isEncryptedValue(envMap[userKeys.usernameKey]) ||
    isEncryptedValue(envMap[userKeys.phoneKey]);
  if (userHasEncrypted) {
    rolesEncrypted.push('user');
  } else if (isRoleLoginReady(envMap, userKeys)) {
    rolesReady.push('user');
  } else {
    // Check if it's template or just missing
    const hasAny =
      envMap[userKeys.passwordKey] || envMap[userKeys.emailKey] || envMap[userKeys.usernameKey];
    if (hasAny && isPlaceholderCredential(envMap[userKeys.passwordKey] ?? '')) {
      warnings.push(
        t(
          lang,
          'Role "user" masih kredensial template — update sebelum menjalankan test',
          'Role "user" has template credentials — update before running tests',
        ),
      );
    }
    rolesIncomplete.push('user');
  }

  // Discover other roles from env keys
  const seenPrefixes = new Set<string>();
  for (const key of Object.keys(envMap)) {
    const m = /^([A-Z0-9_]+?)_(EMAIL|USERNAME|PHONE|PASSWORD)$/.exec(key);
    if (!m) continue;
    const prefix = m[1];
    if (prefix === 'TEST_USER' || prefix === 'DOTENV') continue;
    if (prefix.endsWith('_LOGIN_ID')) continue;
    if (seenPrefixes.has(prefix)) continue;
    seenPrefixes.add(prefix);

    // Convert prefix to role name
    const roleName = prefix.toLowerCase().replace(/_/g, '-');
    const roleKeys = roleCredentialKeys(roleName);
    const roleHasEncrypted =
      isEncryptedValue(envMap[roleKeys.passwordKey]) ||
      isEncryptedValue(envMap[roleKeys.emailKey]) ||
      isEncryptedValue(envMap[roleKeys.usernameKey]) ||
      isEncryptedValue(envMap[roleKeys.phoneKey]);
    if (roleHasEncrypted) {
      rolesEncrypted.push(roleName);
    } else if (isRoleLoginReady(envMap, roleKeys)) {
      rolesReady.push(roleName);
    } else {
      const hasAny =
        envMap[roleKeys.passwordKey] || envMap[roleKeys.emailKey] || envMap[roleKeys.usernameKey];
      if (hasAny && isPlaceholderCredential(envMap[roleKeys.passwordKey] ?? '')) {
        warnings.push(
          t(
            lang,
            `Role "${roleName}" masih kredensial template — update sebelum menjalankan test`,
            `Role "${roleName}" has template credentials — update before running tests`,
          ),
        );
      }
      rolesIncomplete.push(roleName);
    }
  }

  // 4. AUTH_CHALLENGE_MODE
  const challengeMode = envMap['AUTH_CHALLENGE_MODE'] ?? 'none';
  const validModes = ['none', 'auto', 'otp-browser', 'otp-stdin', 'captcha-browser'];
  if (!validModes.includes(challengeMode)) {
    errors.push(
      t(
        lang,
        `AUTH_CHALLENGE_MODE tidak valid: "${challengeMode}"`,
        `Invalid AUTH_CHALLENGE_MODE: "${challengeMode}"`,
      ),
    );
  }

  // 5. .auth directory
  // (informational — it will be created on first auth.setup run)

  const valid = errors.length === 0;

  return {
    valid,
    errors,
    warnings,
    reachable,
    rolesReady,
    rolesIncomplete,
    rolesEncrypted,
    envFilePath,
  };
}

/**
 * Quick check: is the setup complete enough to run tests?
 * Returns a boolean without making network requests.
 * Encrypted values (dotenvx ciphertext) are treated as not-ready — use `validateSetup` + `rolesEncrypted` instead.
 */
export function isSetupReady(envMap: Record<string, string> | null): boolean {
  if (!envMap) return false;
  const raw = envMap['BASE_URL'] ?? '';
  if (!raw || isEncryptedValue(raw)) return false;

  // At least one role must be login-ready
  const userKeys = roleCredentialKeys('user');
  const userHasEncrypted =
    isEncryptedValue(envMap[userKeys.passwordKey]) ||
    isEncryptedValue(envMap[userKeys.emailKey]) ||
    isEncryptedValue(envMap[userKeys.usernameKey]) ||
    isEncryptedValue(envMap[userKeys.phoneKey]);
  if (userHasEncrypted) return false;
  return isRoleLoginReady(envMap, userKeys);
}
