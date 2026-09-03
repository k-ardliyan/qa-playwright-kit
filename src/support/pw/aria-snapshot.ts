/**
 * ARIA snapshot helpers — use official `expect(locator).toMatchAriaSnapshot(string)`.
 *
 * Pair with `snapshot_page` MCP tool which writes `selector-catalog/<feature>/<page>.aria.yml`.
 *
 * @see https://playwright.dev/docs/aria-snapshots
 */

import fs from 'node:fs';
import path from 'node:path';
import { expect, type Locator, type Page } from '@playwright/test';

function resolveRepoPath(filePath: string): string {
  return path.isAbsolute(filePath) ? filePath : path.join(process.cwd(), filePath);
}

function isPage(target: Page | Locator): target is Page {
  return typeof (target as Page).goto === 'function';
}

/** Read ARIA YAML catalog produced by snapshot_page. */
export function readAriaCatalog(catalogAriaPath: string): string {
  const abs = resolveRepoPath(catalogAriaPath);
  if (!fs.existsSync(abs)) {
    throw new Error(`ARIA catalog not found: ${abs}. Run the snapshot_page MCP tool first.`);
  }
  return fs.readFileSync(abs, 'utf8');
}

/**
 * Assert live accessibility tree matches a catalog `.aria.yml` file.
 * Pass a Locator (preferred) or Page (asserts against `body`).
 */
export async function expectAriaMatchesCatalog(
  target: Page | Locator,
  catalogAriaPath: string,
): Promise<void> {
  const yaml = readAriaCatalog(catalogAriaPath);
  const locator = isPage(target) ? target.locator('body') : target;
  await expect(locator).toMatchAriaSnapshot(yaml);
}

/**
 * Assert ARIA snapshot by inline YAML string (for generated baselines or small fixtures).
 */
export async function expectAriaSnapshot(target: Locator, expectedYaml: string): Promise<void> {
  await expect(target).toMatchAriaSnapshot(expectedYaml);
}
