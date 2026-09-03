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
  parseRolesFromEnvMap,
  type RoleCredentialRef,
} from '../shared/utils/role-credentials';
import { isEncryptedValue } from './wizard-writer';
import { checkReachable } from './reachability';
import { type WizardLang, t } from './i18n';

export { isReachableStatus, checkReachable } from './reachability';

export interface ValidationResult {
  /** Config is structurally valid; auth sessions are checked separately. */
  valid: boolean;
  errors: string[];
  warnings: string[];
  /** BASE_URL reachable via HEAD request */
  reachable: boolean;
  /** All roles discovered from the loaded environment. */
  rolesConfigured: string[];
  /** Roles with complete, non-template credentials */
  rolesReady: string[];
  /** Roles with missing or template-placeholder credentials */
  rolesIncomplete: string[];
  /** Roles with encrypted (dotenvx) credentials — cannot verify */
  rolesEncrypted: string[];
  /** Absolute path to the validated env file */
  envFilePath: string | null;
}

/** Return clear, secret-free credential errors for one configured role. */
export function roleCredentialErrors(
  envMap: Record<string, string>,
  role: RoleCredentialRef,
  lang: WizardLang = 'id',
): string[] {
  const errors: string[] = [];
  const password = envMap[role.passwordKey];
  const identifier = [envMap[role.emailKey], envMap[role.usernameKey], envMap[role.phoneKey]];
  if (isPlaceholderCredential(password)) {
    errors.push(
      t(
        lang,
        `Role "${role.name}" membutuhkan password asli (${role.passwordKey})`,
        `Role "${role.name}" needs a real password (${role.passwordKey})`,
      ),
    );
  }
  if (identifier.every((value) => isPlaceholderCredential(value))) {
    errors.push(
      t(
        lang,
        `Role "${role.name}" membutuhkan salah satu identifier asli (EMAIL, USERNAME, atau PHONE)`,
        `Role "${role.name}" needs one real identifier (EMAIL, USERNAME, or PHONE)`,
      ),
    );
  }
  return errors;
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
      rolesConfigured: [],
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

  // 3. Role credentials (dinamis — gunakan parser role canonical yang sama dengan auth setup)
  const rolesReady: string[] = [];
  const rolesIncomplete: string[] = [];
  const rolesEncrypted: string[] = [];
  const discoveredRoles = parseRolesFromEnvMap(envMap);

  // Jika env sama sekali belum punya role key, laporkan role default 'user' incomplete
  const roleRefs = discoveredRoles.length > 0 ? discoveredRoles : [roleCredentialKeys('user')];

  for (const roleKeys of roleRefs) {
    const roleName = roleKeys.name;
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
      rolesIncomplete.push(roleName);
      warnings.push(...roleCredentialErrors(envMap, roleKeys, lang));
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
    rolesConfigured: roleRefs.map((role) => role.name),
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

  const roles = parseRolesFromEnvMap(envMap);
  if (roles.length === 0) return false;

  // At least one role must be login-ready (and not encrypted in plaintext probe)
  for (const roleKeys of roles) {
    const hasEncrypted =
      isEncryptedValue(envMap[roleKeys.passwordKey]) ||
      isEncryptedValue(envMap[roleKeys.emailKey]) ||
      isEncryptedValue(envMap[roleKeys.usernameKey]) ||
      isEncryptedValue(envMap[roleKeys.phoneKey]);
    if (!hasEncrypted && isRoleLoginReady(envMap, roleKeys)) {
      return true;
    }
  }

  return false;
}
