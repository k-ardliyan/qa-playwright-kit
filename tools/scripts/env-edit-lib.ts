/// <reference types="node" />
/**
 * Pure helpers for env-edit CLI — role ↔ env key naming + dotenv text utils.
 *
 * Credential schema: src/shared/utils/role-credentials.ts
 * Dotenv text: src/utils/env-text.ts
 *
 * @module scripts/env-edit-lib
 */

export {
  type LoginIdKind,
  type RoleCredentialRef,
  type ResolvedLoginId,
  type ResolveLoginIdResult,
  type WizardRoleInput,
  type NormalizeWizardRolesResult,
  canonicalRoleName,
  isValidRoleName,
  roleToEnvPrefix,
  envPrefixToRole,
  roleAuthFile,
  roleCredentialKeys,
  isRoleLoginReady,
  resolveLoginIdentifier,
  roleFieldsToEnvUpserts,
  normalizeWizardRoles,
  parseRolesFromEnvMap,
  hasDefaultUserCredentials,
} from '../../src/shared/utils/role-credentials';

export {
  assertSingleLineEnvValue,
  encodeEnvValue,
  upsertEnvContent,
  removeEnvKeys,
  parseEnvText,
  isEncryptedEnvText,
} from '../../src/utils/env-text';

/**
 * Mask secrets for display.
 * encrypted:… → [encrypted]
 * short values → ***
 * longer → first2 + **** + last2
 */
export function maskSecret(value: string | undefined | null): string {
  if (value === undefined || value === null || value === '') return '(empty)';
  if (value.startsWith('encrypted:')) return '[encrypted]';
  if (value.length <= 4) return '****';
  if (value.length <= 8) return value.slice(0, 1) + '****' + value.slice(-1);
  return value.slice(0, 2) + '****' + value.slice(-2);
}
