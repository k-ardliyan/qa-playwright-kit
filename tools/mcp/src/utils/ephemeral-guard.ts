/**
 * Shared ephemeral reference guard for the qa-playwright-kit MCP server.
 *
 * Ephemeral references (ref:, handle:, tw-*, playwright-element-*) are browser
 * session IDs that must never persist into generated test code or test plan
 * artifacts. Any such reference is a sign of an AI generation defect.
 *
 * This is the single source of truth — import from here in compile-test-plan.ts
 * and validate-plan.ts so pattern additions are made exactly once.
 */

/**
 * Regex patterns that match ephemeral browser element references.
 */
export const EPHEMERAL_REF_PATTERNS: RegExp[] = [
  /** Playwright MCP element ref: ref:XXXX */
  /\bref:[a-zA-Z0-9_-]+\b/i,
  /** Playwright inspector handle: handle:XXXX */
  /\bhandle:[a-zA-Z0-9_-]+\b/i,
  /** Playwright Tree-Walker IDs: tw-XXXX (4+ hex digits) */
  /\btw-[0-9a-fA-F]{4,}\b/i,
  /** Playwright legacy element handles: playwright-element-NNN */
  /\bplaywright-element-[0-9]+\b/i,
];

/**
 * Returns `true` if `str` contains any ephemeral browser reference pattern.
 *
 * @param str - The string to test (action step, locator intent, assertion description, etc.)
 */
export function containsEphemeralReference(str: string): boolean {
  return EPHEMERAL_REF_PATTERNS.some((p) => p.test(str));
}

/** @deprecated Use containsEphemeralReference. */
export const containsEphemeralRef = containsEphemeralReference;
