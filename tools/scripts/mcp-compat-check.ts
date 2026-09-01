/// <reference types="node" />

import { spawnSync } from 'node:child_process';
import * as path from 'node:path';
import { resolveInstalledPlaywrightMcpVersionSync } from '../../src/shared/mcp/version-resolver';
import { PLAYWRIGHT_MCP_BASELINE_VERSION } from '../../src/shared/mcp/version';
import {
  ALL_MCP_CAPABILITIES,
  PLAYWRIGHT_MCP_CAPABILITY_MANIFEST,
  PLAYWRIGHT_MCP_CLI_ADDITIVE_CAPABILITIES,
} from '../../src/shared/mcp/capability-manifest';
import { bootstrapMcpEnvironment } from './mcp-bootstrap';
import { EXIT } from './exit-codes';
import { printOk, printWarn, printError, withFriendlyErrors } from './format-error';

export interface McpCliContractAssessment {
  additiveCaps: string[];
  allowedOriginsSeparator: 'semicolon' | 'unknown';
  browserValues: string[];
  headings: string[];
}

/** Extract the help section for a specific flag (from its line to the next option). */
function sectionOf(helpText: string, flag: string): string {
  const start = helpText.indexOf(`--${flag}`);
  if (start < 0) return '';
  const next = helpText.indexOf('\n  --', start + 1);
  return next < 0 ? helpText.slice(start) : helpText.slice(start, next);
}

function parsePossibleValues(section: string): string[] {
  const m = section.match(/possible values:\s*([a-z,\s]+)\./);
  if (!m) return [];
  return m[1]
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Pure parser over the actual `@playwright/mcp --help` output of the INSTALLED
 * package. This is the compatibility seam: framework behavior must follow the
 * installed CLI contract, not a docs page or a manifest validated against itself.
 */
export function assessMcpCliContract(helpText: string): McpCliContractAssessment {
  const headings = [...helpText.matchAll(/^ {2}(--[a-z][a-z-]+)/gm)].map((m) => m[1]);
  return {
    additiveCaps: parsePossibleValues(sectionOf(helpText, 'caps <caps>')),
    allowedOriginsSeparator: /semicolon-separated/.test(
      sectionOf(helpText, 'allowed-origins <origins>'),
    )
      ? 'semicolon'
      : 'unknown',
    browserValues: parsePossibleValues(sectionOf(helpText, 'browser <browser>')),
    headings,
  };
}

export interface McpCompatResult {
  ok: boolean;
  installedVersion: string | null;
  expectedVersion: string;
  capabilitiesCount: number;
  toolsCount: number;
  contractAssessed: boolean;
  warnings: string[];
  errors: string[];
}

/**
 * Pure contract validation against the manifest expectations. Returns framework
 * errors for hard breaks and warnings for softer drift (e.g. separator change).
 */
export function validateContractAgainstManifest(assessment: McpCliContractAssessment): {
  errors: string[];
  warnings: string[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];

  const missingCaps = PLAYWRIGHT_MCP_CLI_ADDITIVE_CAPABILITIES.filter(
    (cap) => !assessment.additiveCaps.includes(cap),
  );
  if (missingCaps.length > 0) {
    errors.push(
      `Installed MCP CLI --caps no longer accepts framework-required additive capabilities: ${missingCaps.join(', ')} ` +
        `(advertised: ${assessment.additiveCaps.join(', ') || 'none'}).`,
    );
  }

  if (assessment.allowedOriginsSeparator !== 'semicolon') {
    warnings.push(
      'Installed MCP CLI --allowed-origins separator changed; verify launcher output format.',
    );
  }

  return { errors, warnings };
}

export function runMcpCompatCheck(): McpCompatResult {
  const warnings: string[] = [];
  const errors: string[] = [];

  const installedVersion = resolveInstalledPlaywrightMcpVersionSync();
  const expectedVersion = PLAYWRIGHT_MCP_BASELINE_VERSION;

  if (!installedVersion) {
    errors.push(`@playwright/mcp is not installed in node_modules. Run: npm install`);
  } else if (installedVersion !== expectedVersion) {
    warnings.push(
      `Installed @playwright/mcp (${installedVersion}) differs from baseline (${expectedVersion}).`,
    );
  }

  // Real closure check against the installed CLI. Missing introspection is a
  // warning (per plan: "graceful warning where runtime introspection is not
  // available") — but a proven contract break is an error.
  let contractAssessed = false;
  if (installedVersion) {
    const probe = spawnSync(
      process.execPath,
      [path.join(process.cwd(), 'node_modules', '@playwright', 'mcp', 'cli.js'), '--help'],
      {
        encoding: 'utf8',
        timeout: 15_000,
      },
    );
    const helpText = probe.status === 0 ? (probe.stdout ?? '') : '';
    if (helpText) {
      contractAssessed = true;
      const contract = validateContractAgainstManifest(assessMcpCliContract(helpText));
      errors.push(...contract.errors);
      warnings.push(...contract.warnings);
    } else {
      warnings.push('Could not introspect installed MCP CLI (--help). Contract checks skipped.');
    }
  }

  const allTools = Object.values(PLAYWRIGHT_MCP_CAPABILITY_MANIFEST).flat();

  return {
    ok: errors.length === 0,
    installedVersion,
    expectedVersion,
    capabilitiesCount: ALL_MCP_CAPABILITIES.length,
    toolsCount: allTools.length,
    contractAssessed,
    warnings,
    errors,
  };
}

async function main(): Promise<void> {
  await withFriendlyErrors(async () => {
    bootstrapMcpEnvironment(__dirname);
    const result = runMcpCompatCheck();

    process.stdout.write('\n=== Playwright MCP Compatibility Check ===\n\n');

    if (result.installedVersion) {
      printOk(
        `Installed @playwright/mcp version: ${result.installedVersion} (baseline: ${result.expectedVersion})`,
      );
    }

    printOk(
      `Capability categories configured: ${result.capabilitiesCount} (${ALL_MCP_CAPABILITIES.join(', ')})`,
    );
    printOk(`Total capability tools mapped: ${result.toolsCount}`);

    for (const w of result.warnings) {
      printWarn(w);
    }

    for (const err of result.errors) {
      printError({
        title: 'MCP Compatibility Error',
        detail: err,
        hint: 'Run npm install @playwright/mcp@0.0.80 or check package.json',
      });
    }

    if (!result.ok) {
      process.exit(EXIT.FIXABLE);
    }

    process.stdout.write('\n');
    if (result.contractAssessed) {
      printOk('Playwright MCP integration contract is verified against the installed CLI.');
    } else {
      printWarn('Playwright MCP contract partially verified (CLI introspection unavailable).');
    }
    process.exit(EXIT.OK);
  });
}

if (require.main === module) {
  main().catch((err) => {
    process.stderr.write(`Fatal error: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(EXIT.ESCALATE);
  });
}
