/**
 * Shared core for snapshot_page and discover_pages MCP tools.
 *
 * - Launches a headless Chromium via `playwright`.
 * - Navigates to a URL with optional waitForSelector.
 * - Captures ARIA snapshot (YAML accessibility tree).
 * - Extracts structured selector candidates for interactive nodes, prioritised
 *   according to Playwright 2026 best practice:
 *     getByRole > getByLabel > getByText > getByPlaceholder > getByTestId > CSS.
 * - Writes two files under `selector-catalog/<featureName>/`:
 *     `<pageName>.aria.yml`  — full ARIA tree (for `toMatchAriaSnapshot()`).
 *     `<pageName>.json`      — flat selector index (for AI agents).
 * - Returns a `SnapshotResult` summary. The MCP boundary formats this as a
 *   compact response so AI agents only see the path / counts / hash, not the
 *   full tree.
 */

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { resolveAllowedPath, getRepoRoot } from '../../utils/safety';
import { mcpWorkspace } from '../../utils/workspace-paths';
import { logger } from '../../utils/logger';
import { extractSemanticCatalog } from './semantic-extractor';
import type { SemanticCatalog } from '../../contracts/semantic-catalog';

export const SELECTOR_CATALOG_MAX_FILES = Number.parseInt(
  process.env.SELECTOR_CATALOG_MAX_FILES ?? '100',
  10,
);

export const DEFAULT_MAX_ELEMENTS = 500;
export const DEFAULT_NAVIGATION_TIMEOUT_MS = 30_000;
export const DEFAULT_WAIT_UNTIL: 'networkidle' | 'domcontentloaded' | 'load' = 'networkidle';

export interface SnapshotOptions {
  url: string;
  featureName: string;
  pageName: string;
  role?: string;
  exploreModals?: boolean;
  waitForSelector?: string;
  include?: string[];
  maxElements?: number;
  force?: boolean;
  waitUntil?: 'networkidle' | 'domcontentloaded' | 'load';
  navigationTimeoutMs?: number;
}

export interface SelectorCandidate {
  /** Source: 'role' | 'label' | 'text' | 'placeholder' | 'testId' | 'css'. */
  source: 'role' | 'label' | 'text' | 'placeholder' | 'testId' | 'css';
  /** Human-readable snippet for the locator, e.g. `getByRole('button', { name: 'Login' })`. */
  expression: string;
}

export interface CatalogElement {
  role: string;
  name: string;
  primary: string | null;
  candidates: SelectorCandidate[];
  fragile: boolean;
}

export interface CatalogIndex {
  schemaVersion?: 'qa.selector-catalog/v1';
  featureName: string;
  pageName: string;
  url: string;
  role?: string;
  hash: string;
  catalogHash?: string;
  capturedAt: string;
  truncated: boolean;
  elementCount: number;
  elements: CatalogElement[];
  semantic?: SemanticCatalog;
}

export interface SnapshotResult {
  featureName: string;
  pageName: string;
  url: string;
  role?: string;
  hash: string;
  elementCount: number;
  truncated: boolean;
  ariaYmlRelativePath: string;
  selectorsJsonRelativePath: string;
  semantic?: SemanticCatalog;
  skipped?: boolean;
  skipReason?: string;
}

export class SnapshotCoreError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = 'SnapshotCoreError';
  }
}

const INTERACTIVE_ROLES = new Set([
  'button',
  'link',
  'textbox',
  'checkbox',
  'radio',
  'combobox',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'option',
  'switch',
  'tab',
  'searchbox',
  'spinbutton',
  'slider',
  'heading',
]);

// Captures: [1] role token, [2] quoted name, [3] unquoted name (no brackets)
const FRAGMENT_LINE_RE =
  /^\s*-\s+([a-zA-Z][\w-]*)(?:\s+(?:"([^"]+)"|([^\s["]+)))?(?:\s+\[[^\]]*\])?/;

interface AriaNode {
  raw: string;
  indent: number;
  role: string | null;
  name: string | null;
}

function parseAriaTree(yaml: string): AriaNode[] {
  const lines = yaml.split(/\r?\n/);
  const nodes: AriaNode[] = [];
  for (const line of lines) {
    const trimmed = line.replace(/\s+$/, '');
    if (trimmed.length === 0) continue;
    const match = trimmed.match(FRAGMENT_LINE_RE);
    if (!match) continue;
    const role = match[1].toLowerCase();
    const name = match[2] ?? match[3] ?? null;
    nodes.push({
      raw: trimmed,
      indent: line.search(/\S/),
      role,
      name: name ? name.trim() : null,
    });
  }
  return nodes;
}

function escapeForStringLiteral(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function buildCandidates(
  role: string,
  name: string | null,
  hasTestId: boolean,
  testId: string | null,
): SelectorCandidate[] {
  const candidates: SelectorCandidate[] = [];
  if (name) {
    candidates.push({
      source: 'role',
      expression: `page.getByRole('${role}', { name: '${escapeForStringLiteral(name)}', exact: true })`,
    });
    if (['textbox', 'searchbox', 'combobox', 'spinbutton'].includes(role)) {
      candidates.push({
        source: 'label',
        expression: `page.getByLabel('${escapeForStringLiteral(name)}')`,
      });
    }
    candidates.push({
      source: 'text',
      expression: `page.getByText('${escapeForStringLiteral(name)}', { exact: true })`,
    });
  }
  if (hasTestId && testId) {
    candidates.push({
      source: 'testId',
      expression: `page.getByTestId('${escapeForStringLiteral(testId)}')`,
    });
  }
  candidates.push({
    source: 'css',
    expression: `[role="${role}"]${name ? `:has-text("${escapeForStringLiteral(name)}")` : ''}`,
  });
  return candidates;
}

type AriaRole = Parameters<Page['getByRole']>[0];

async function pickPrimary(
  page: Page,
  role: string,
  name: string,
  hasTestId: boolean,
  testId: string | null,
): Promise<{ primary: string | null; fragile: boolean }> {
  const roleArg = role as AriaRole;
  // P1: getByRole(name, exact)
  if (name) {
    try {
      const locator = page.getByRole(roleArg, { name, exact: true });
      if ((await locator.count()) === 1) {
        return {
          primary: `page.getByRole('${role}', { name: '${escapeForStringLiteral(name)}', exact: true })`,
          fragile: false,
        };
      }
    } catch {
      // Role may not be valid for this element; skip.
    }
    // P2: getByLabel
    if (['textbox', 'searchbox', 'combobox', 'spinbutton'].includes(role)) {
      try {
        const locator = page.getByLabel(name);
        if ((await locator.count()) === 1) {
          return {
            primary: `page.getByLabel('${escapeForStringLiteral(name)}')`,
            fragile: false,
          };
        }
      } catch {
        // No associated label.
      }
    }
    // P3: getByText
    try {
      const locator = page.getByText(name, { exact: true });
      if ((await locator.count()) === 1) {
        return {
          primary: `page.getByText('${escapeForStringLiteral(name)}', { exact: true })`,
          fragile: false,
        };
      }
    } catch {
      // Text not unique.
    }
  }
  // P4: getByTestId
  if (hasTestId && testId) {
    try {
      const locator = page.getByTestId(testId);
      if ((await locator.count()) === 1) {
        return {
          primary: `page.getByTestId('${escapeForStringLiteral(testId)}')`,
          fragile: false,
        };
      }
    } catch {
      // Test ID invalid.
    }
  }
  // P5: CSS fallback (fragile)
  return {
    primary: null,
    fragile: true,
  };
}

async function extractElements(
  page: Page,
  scope: string | null,
  maxElements: number,
): Promise<{ elements: CatalogElement[]; truncated: boolean }> {
  const ariaYaml = scope
    ? await page.locator(scope).first().ariaSnapshot()
    : await page.ariaSnapshot();

  const nodes = parseAriaTree(ariaYaml ?? '');
  const interactiveNodes = nodes.filter((n) => n.role && INTERACTIVE_ROLES.has(n.role));

  const truncated = interactiveNodes.length > maxElements;
  const sliced = interactiveNodes.slice(0, maxElements);

  const testIdMap = await page.evaluate(`(() => {
    const out = {};
    document.querySelectorAll('[data-testid]').forEach((el) => {
      const name = (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 80);
      if (name) out[name] = el.getAttribute('data-testid');
    });
    return out;
  })()`);

  const elements: CatalogElement[] = [];
  for (const node of sliced) {
    const name = node.name ?? '';
    const role = node.role ?? '';
    const testId = (testIdMap as Record<string, string>)[name];
    const hasTestId = typeof testId === 'string' && testId.length > 0;
    const candidates = buildCandidates(role, name, hasTestId, testId ?? null);
    const { primary, fragile } = await pickPrimary(page, role, name, hasTestId, testId ?? null);
    elements.push({
      role,
      name,
      primary,
      candidates,
      fragile,
    });
  }

  return { elements, truncated };
}

function sanitizePageName(name: string): string {
  const cleaned = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, '-');
  return cleaned.length > 0 ? cleaned.slice(0, 64) : 'page';
}

function sanitizeFeatureName(name: string): string {
  const cleaned = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, '-');
  if (cleaned.length === 0 || cleaned.startsWith('-')) {
    throw new SnapshotCoreError(
      `Invalid featureName: "${name}". Use lowercase letters, digits, '-' or '_'.`,
      'INVALID_INPUT',
    );
  }
  return cleaned.slice(0, 64);
}

function ensureFeatureDir(featureName: string): {
  absoluteDir: string;
  relativeDir: string;
} {
  const resolved = resolveAllowedPath(
    `${mcpWorkspace.selectorCatalogRel}/${featureName}`,
    'selector-catalog',
    {
      mustExist: false,
      readOnly: false,
    },
  );
  if (!resolved.ok) {
    throw new SnapshotCoreError(
      `Cannot resolve feature directory: ${resolved.error.message}`,
      resolved.error.code,
    );
  }
  if (!fs.existsSync(resolved.absolutePath)) {
    fs.mkdirSync(resolved.absolutePath, { recursive: true });
  }
  return { absoluteDir: resolved.absolutePath, relativeDir: resolved.relativePath };
}

function countFilesInFeatureDir(absoluteDir: string): number {
  if (!fs.existsSync(absoluteDir)) return 0;
  return fs.readdirSync(absoluteDir, { withFileTypes: true }).filter((entry) => entry.isFile())
    .length;
}

async function navigateAndCapture(
  page: Page,
  options: SnapshotOptions,
  ariaYamlOverride?: string,
): Promise<{ ariaYaml: string; truncated: boolean; elements: CatalogElement[] }> {
  const navigationTimeout = options.navigationTimeoutMs ?? DEFAULT_NAVIGATION_TIMEOUT_MS;
  page.setDefaultNavigationTimeout(navigationTimeout);
  page.setDefaultTimeout(navigationTimeout);

  const waitUntil = options.waitUntil ?? DEFAULT_WAIT_UNTIL;
  await page.goto(options.url, { waitUntil });
  if (options.waitForSelector) {
    await page.waitForSelector(options.waitForSelector, { timeout: navigationTimeout });
  }
  const ariaYaml = ariaYamlOverride ?? (await page.ariaSnapshot());
  const scope = options.include?.[0] ?? null;
  const { elements, truncated } = await extractElements(
    page,
    scope,
    options.maxElements ?? DEFAULT_MAX_ELEMENTS,
  );
  return { ariaYaml, truncated, elements };
}

export async function snapshotPageCore(options: SnapshotOptions): Promise<SnapshotResult> {
  if (!options.url || !/^https?:\/\//i.test(options.url)) {
    throw new SnapshotCoreError(
      `Invalid url: "${options.url}". Must start with http:// or https://.`,
      'INVALID_INPUT',
    );
  }

  const featureName = sanitizeFeatureName(options.featureName);
  const pageName = sanitizePageName(options.pageName);

  const { absoluteDir, relativeDir } = ensureFeatureDir(featureName);

  const ariaRelPath = `${relativeDir}/${pageName}.aria.yml`;
  const jsonRelPath = `${relativeDir}/${pageName}.json`;
  const ariaAbsPath = path.join(getRepoRoot(), ariaRelPath);
  const jsonAbsPath = path.join(getRepoRoot(), jsonRelPath);

  if (!options.force && fs.existsSync(ariaAbsPath) && fs.existsSync(jsonAbsPath)) {
    try {
      const existing = JSON.parse(fs.readFileSync(jsonAbsPath, 'utf8')) as CatalogIndex;
      const sameUrl = existing.url === options.url;
      return {
        featureName,
        pageName,
        url: options.url,
        hash: existing.hash,
        elementCount: existing.elementCount,
        truncated: existing.truncated,
        ariaYmlRelativePath: ariaRelPath,
        selectorsJsonRelativePath: jsonRelPath,
        skipped: sameUrl,
        skipReason: sameUrl ? 'catalog_fresh' : 'catalog_url_changed_force_required',
      };
    } catch {
      // Fall through to re-snapshot if the existing file is unreadable.
    }
  }

  const existingCount = countFilesInFeatureDir(absoluteDir);
  if (existingCount >= SELECTOR_CATALOG_MAX_FILES) {
    throw new SnapshotCoreError(
      `Feature "${featureName}" already has ${existingCount} catalog files. Hard cap ${SELECTOR_CATALOG_MAX_FILES}. Set SELECTOR_CATALOG_MAX_FILES to raise or delete old files.`,
      'CAP_EXCEEDED',
    );
  }

  const browser: Browser = await chromium.launch({ headless: true });
  let context: BrowserContext | null = null;
  try {
    const contextOptions: Parameters<Browser['newContext']>[0] = {};

    // Auth injection if role provided
    if (options.role) {
      const appEnv = (process.env.APP_ENV ?? 'local').trim() || 'local';
      const roleName =
        options.role.trim().toLowerCase() === 'general'
          ? 'user'
          : options.role.trim().toLowerCase();
      const scopedAuth = path.join(getRepoRoot(), '.auth', appEnv, `${roleName}.json`);
      const legacyAuth = path.join(getRepoRoot(), '.auth', `${roleName}.json`);

      if (fs.existsSync(scopedAuth)) {
        contextOptions.storageState = scopedAuth;
      } else if (appEnv === 'local' && fs.existsSync(legacyAuth)) {
        contextOptions.storageState = legacyAuth;
      } else {
        logger.warn(
          `[snapshot_page] Auth storage state for role "${options.role}" in env "${appEnv}" not found. Running unauthenticated.`,
        );
      }
    }

    context = await browser.newContext(contextOptions);
    const page = await context.newPage();
    const { ariaYaml, truncated, elements } = await navigateAndCapture(page, options);

    // Extract rich semantic UI structures
    let semantic: SemanticCatalog | undefined;
    try {
      semantic = await extractSemanticCatalog(page, options.role);
    } catch (e) {
      logger.warn('[snapshot_page] Failed to extract semantic catalog', {
        error: e instanceof Error ? e.message : String(e),
      });
    }

    const hash = crypto.createHash('sha256').update(ariaYaml).digest('hex');

    fs.writeFileSync(ariaAbsPath, ariaYaml, 'utf8');
    const index: CatalogIndex = {
      schemaVersion: 'qa.selector-catalog/v1',
      featureName,
      pageName,
      url: options.url,
      role: options.role,
      hash,
      catalogHash: hash,
      capturedAt: new Date().toISOString(),
      truncated,
      elementCount: elements.length,
      elements,
      semantic,
    };
    fs.writeFileSync(jsonAbsPath, JSON.stringify(index, null, 2), 'utf8');

    logger.info('snapshot_page persisted catalog', {
      featureName,
      pageName,
      elementCount: elements.length,
      truncated,
      hash,
      role: options.role,
    });

    return {
      featureName,
      pageName,
      url: options.url,
      role: options.role,
      hash,
      elementCount: elements.length,
      truncated,
      ariaYmlRelativePath: ariaRelPath,
      selectorsJsonRelativePath: jsonRelPath,
      semantic,
    };
  } finally {
    if (context) await context.close();
    await browser.close();
  }
}
