/**
 * MCP tool: `generate_page_object`.
 *
 * Read selector catalog JSON → generate TypeScript POM scaffold.
 * Never overwrites existing files unless force=true.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { createToolError, type ToolError, getRepoRoot } from '../utils/safety';
import { mcpWorkspace } from '../utils/workspace-paths';

export interface GeneratePageObjectArgs {
  featureName?: unknown;
  pageName?: unknown;
  className?: unknown;
  outputPath?: unknown;
  force?: unknown;
}

export interface GeneratePageObjectOutput {
  status: 'created' | 'skipped' | 'error';
  path?: string;
  elementCount?: number;
  fragileCount?: number;
  warnings?: string[];
  message: string;
  error?: ToolError;
}

function readString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  if (value.trim().length === 0) return null;
  return value.trim();
}

function readBoolean(value: unknown): boolean {
  return value === true || value === 'true';
}

function toPascalCase(str: string): string {
  return str
    .split(/[-_\s]+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join('');
}

function toCamelCase(str: string): string {
  const pascal = toPascalCase(str);
  // Strip any non-identifier characters (e.g. '?' from "Forgot Password?")
  return pascal.charAt(0).toLowerCase() + pascal.slice(1).replace(/[^\w]/g, '');
}

function roleToPrefix(role: string): string {
  const map: Record<string, string> = {
    button: 'btn',
    link: 'link',
    textbox: 'input',
    searchbox: 'input',
    checkbox: 'checkbox',
    radio: 'radio',
    combobox: 'select',
    listbox: 'list',
    menuitem: 'menu',
    tab: 'tab',
    switch: 'switch',
  };
  return map[role] || role;
}

const INTERACTIVE_ROLES = new Set([
  'button',
  'link',
  'textbox',
  'searchbox',
  'checkbox',
  'radio',
  'combobox',
  'listbox',
  'menuitem',
  'tab',
  'switch',
]);

interface CatalogElement {
  role: string;
  name: string;
  primary: string | null;
  candidates?: Array<{ source: string; expression: string }>;
  fragile: boolean;
}

interface CatalogIndex {
  featureName: string;
  pageName: string;
  url: string;
  hash: string;
  capturedAt: string;
  truncated: boolean;
  elementCount: number;
  elements: CatalogElement[];
}

export async function generatePageObject(
  args: GeneratePageObjectArgs | undefined,
): Promise<GeneratePageObjectOutput> {
  if (!args || typeof args !== 'object') {
    return {
      status: 'error',
      message: 'Invalid arguments object.',
      error: { code: 'INVALID_INPUT', message: 'args must be an object.' },
    };
  }

  const featureName = readString(args.featureName);
  const pageName = readString(args.pageName);
  const className = readString(args.className) || (pageName ? toPascalCase(pageName) : null);
  const force = readBoolean(args.force);

  if (!featureName) {
    const err = createToolError('INVALID_INPUT', 'featureName is required.');
    return { status: 'error', message: err.error.message, error: err.error };
  }
  if (!pageName) {
    const err = createToolError('INVALID_INPUT', 'pageName is required.');
    return { status: 'error', message: err.error.message, error: err.error };
  }
  if (!className) {
    const err = createToolError('INVALID_INPUT', 'className could not be derived from pageName.');
    return { status: 'error', message: err.error.message, error: err.error };
  }

  const repoRoot = getRepoRoot();

  // Validate outputPath BEFORE touching the catalog — a hostile outputPath must
  // be rejected regardless of catalog existence, and never read then discarded.
  const outputPathArg = readString(args.outputPath);
  const defaultOutputPath = path.join(mcpWorkspace.pagesDir, `${className}.ts`);
  const outputPath = outputPathArg
    ? (() => {
        const abs = path.isAbsolute(outputPathArg)
          ? outputPathArg
          : path.join(repoRoot, outputPathArg);
        const rel = path.relative(repoRoot, abs);
        if (rel.startsWith('..') || path.isAbsolute(rel)) {
          return null; // path escape attempt
        }
        // Lock scaffold writes to tests/pages/ — never overwrite framework or spec files
        const relNorm = rel.replace(/\\/g, '/');
        if (relNorm !== mcpWorkspace.pagesRel && !relNorm.startsWith(`${mcpWorkspace.pagesRel}/`)) {
          return null;
        }
        return abs;
      })()
    : defaultOutputPath;

  if (!outputPath) {
    const err = createToolError(
      'INVALID_PATH',
      `outputPath must be inside the repository root under '${mcpWorkspace.pagesRel}/'.`,
    );
    return { status: 'error', message: err.error.message, error: err.error };
  }

  const catalogPath = path.join(mcpWorkspace.selectorCatalogDir, featureName, `${pageName}.json`);

  if (!fs.existsSync(catalogPath)) {
    const err = createToolError(
      'CATALOG_NOT_FOUND',
      `Catalog not found at ${catalogPath}. Run snapshot_page first.`,
    );
    return { status: 'error', message: err.error.message, error: err.error };
  }

  if (fs.existsSync(outputPath) && !force) {
    return {
      status: 'skipped',
      path: outputPath,
      message: `File already exists at ${outputPath}. Use force=true to overwrite.`,
    };
  }

  let catalog: CatalogIndex;
  try {
    const raw = fs.readFileSync(catalogPath, 'utf-8');
    catalog = JSON.parse(raw) as CatalogIndex;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const err = createToolError('CATALOG_READ_ERROR', `Failed to read catalog: ${message}`);
    return { status: 'error', message: err.error.message, error: err.error };
  }

  const filtered = catalog.elements.filter((el) => INTERACTIVE_ROLES.has(el.role));
  const fragileCount = filtered.filter((el) => el.fragile).length;
  const warnings: string[] = [];

  if (filtered.length > 50) {
    warnings.push(
      `High element count (${filtered.length}). Consider splitting into multiple POMs.`,
    );
  }

  // Group by prefix
  const groups: Record<string, CatalogElement[]> = {};
  for (const el of filtered) {
    const prefix = roleToPrefix(el.role);
    if (!groups[prefix]) groups[prefix] = [];
    groups[prefix].push(el);
  }

  // Build locator properties
  const props: string[] = [];
  const ctorLines: string[] = [];
  const seen = new Set<string>();

  for (const prefix of Object.keys(groups).sort()) {
    const elements = groups[prefix];
    props.push(`  // ── ${prefix.toUpperCase()} ──`);

    for (const el of elements) {
      let propName = toCamelCase(`${prefix} ${el.name}`);
      let counter = 1;
      while (seen.has(propName)) {
        propName = toCamelCase(`${prefix} ${el.name} ${counter}`);
        counter++;
        if (counter === 2) {
          warnings.push(`Name collision for "${el.name}" — renamed to ${propName}`);
        }
      }
      seen.add(propName);

      const fragileNote = el.fragile ? ' // ⚠️ fragile selector' : '';
      props.push(`  readonly ${propName}: Locator;${fragileNote}`);

      const locatorExpr = el.primary || (el.candidates?.[0]?.expression ?? 'null');
      const safePropName = propName.replace(/\?$/, ''); // strip optional marker for ctor assignment
      if (locatorExpr === 'null') {
        ctorLines.push(
          `    // this.${safePropName} = page.locator('TODO'); // no stable selector found`,
        );
      } else {
        ctorLines.push(`    this.${safePropName} = ${locatorExpr.replace(/^page\./, 'page.')};`);
      }
    }
    props.push('');
  }

  const timestamp = new Date().toISOString();
  const content = `/**
 * AUTO-GENERATED POM SCAFFOLD — safe to edit.
 * Re-run will NOT overwrite unless force=true.
 *
 * Source: ${mcpWorkspace.selectorCatalogRel}/${featureName}/${pageName}.json
 * Generated: ${timestamp}
 */

import { type Locator, type Page } from '@playwright/test';
import { BasePage } from './BasePage';

export class ${className} extends BasePage {
${props.join('\n')}

  constructor(page: Page) {
    super(page);
${ctorLines.join('\n')}
  }

  // TODO: async goto() { await this.navigate('/your-url'); }
  // TODO: Add business action methods (doLogin, fillForm, etc.)
}
`;

  try {
    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    if (force && fs.existsSync(outputPath)) {
      const bakDir = path.join(dir, '.bak');
      if (!fs.existsSync(bakDir)) fs.mkdirSync(bakDir, { recursive: true });
      const bakPath = path.join(bakDir, path.basename(outputPath));
      fs.copyFileSync(outputPath, bakPath);
      warnings.push(`Previous version backed up to ${bakPath}`);
    }

    fs.writeFileSync(outputPath, content, 'utf-8');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const err = createToolError('FILE_WRITE_ERROR', `Failed to write file: ${message}`);
    return { status: 'error', message: err.error.message, error: err.error };
  }

  return {
    status: force && fs.existsSync(outputPath) ? 'created' : 'created',
    path: outputPath,
    elementCount: filtered.length,
    fragileCount,
    warnings: warnings.length > 0 ? warnings : undefined,
    message: `✅ POM scaffold created at ${outputPath}. Review TODOs and register in tests/fixtures.ts.`,
  };
}
