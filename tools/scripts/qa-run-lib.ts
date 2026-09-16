/// <reference types="node" />
/**
 * Pure helpers for the qa:run preflight — kept out of `qa-run.ts` because that
 * file is a CLI entrypoint (importing it executes the runner).
 *
 * Credential schema: src/shared/utils/role-credentials.ts
 *
 * @module scripts/qa-run-lib
 */

import { isPlaceholderCredential, ROLE_KEY_RE } from '../../src/shared/utils/role-credentials';

/**
 * Credential keys still holding a template placeholder.
 *
 * Only REQUIRED keys are flagged — identity, password, and an explicitly-set
 * COMPANY (a placeholder tenant would silently log in against the wrong
 * tenant). Optional keys left empty (COMPANY, `*_SELECTOR`, `*_URL_PATH`) must
 * not block a fresh checkout.
 */
export function findPlaceholderCredentialKeys(envMap: Record<string, string>): string[] {
  const requiredSuffix = /_(EMAIL|USERNAME|PHONE|PASSWORD|COMPANY)$/;
  return Object.entries(envMap)
    .filter(
      ([k, v]) =>
        ROLE_KEY_RE.test(k) &&
        requiredSuffix.test(k) &&
        v.trim().length > 0 &&
        isPlaceholderCredential(v),
    )
    .map(([k]) => k);
}
