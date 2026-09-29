/**
 * AUTO-SYNCED from src/shared/mcp/failed-grep.ts — do not edit by hand.
 * Run: npm run sync:mcp-generated  (also runs inside npm run mcp:build)
 */

/**
 * Failed-test grep builder — shared by the root workspace and the MCP package.
 *
 * Playwright-free pure string helpers so the module can be twin-synced into
 * `tools/mcp/src/utils/` (see sync-mcp-generated.ts). The re-entry path uses
 * `buildFailedGrepPattern` to narrow a Validate re-run to the previously
 * failed titles instead of re-executing the whole suite.
 *
 * @module shared/mcp/failed-grep
 */

/**
 * Builds a regex grep string for the Playwright CLI to execute only the given
 * test titles. Returns '' for an empty list (caller must not pass --grep then).
 */
export function buildFailedGrepPattern(titles: string[]): string {
  if (titles.length === 0) return '';
  const escaped = titles.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return `(${escaped.join('|')})`;
}
