/**
 * Canonical Playwright MCP version constants and semver utilities.
 */

export const PLAYWRIGHT_MCP_BASELINE_VERSION = '0.0.80';

const SEMVER_REGEX =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

/**
 * Validate that a given string is a valid explicit semver version (e.g. "0.0.79").
 */
export function isValidSemver(version: string): boolean {
  return SEMVER_REGEX.test(version.trim());
}
