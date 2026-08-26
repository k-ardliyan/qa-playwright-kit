/// <reference types="node" />
/**
 * Copy SoT files into the MCP package (MCP cannot import root TS).
 *
 * Default: write generated copies.
 * --check: compare dest vs banner+SoT, exit 1 on drift (no write).
 *
 * Run: npm run sync:mcp-generated
 *      npm run sync:mcp-generated:check
 * Also runs inside npm run mcp:build via sync:file-core wrapper.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

export interface SyncPair {
  source: string;
  dest: string;
}

export const MCP_GENERATED_PAIRS: SyncPair[] = [
  {
    source: 'src/support/pw/file-content-core.ts',
    dest: 'tools/mcp/src/utils/file-content-core.ts',
  },
  {
    source: 'src/contracts/diagnostics.ts',
    dest: 'tools/mcp/src/contracts/diagnostics.ts',
  },
  {
    source: 'src/contracts/hashing.ts',
    dest: 'tools/mcp/src/contracts/hashing.ts',
  },
  {
    source: 'src/contracts/index.ts',
    dest: 'tools/mcp/src/contracts/index.ts',
  },
  {
    source: 'src/contracts/mcp-result-contract.ts',
    dest: 'tools/mcp/src/contracts/mcp-result-contract.ts',
  },
  {
    source: 'src/contracts/requirement-contract.ts',
    dest: 'tools/mcp/src/contracts/requirement-contract.ts',
  },
  {
    source: 'src/contracts/test-plan-contract.ts',
    dest: 'tools/mcp/src/contracts/test-plan-contract.ts',
  },
  {
    source: 'src/contracts/traceability-contract.ts',
    dest: 'tools/mcp/src/contracts/traceability-contract.ts',
  },
  {
    source: 'src/contracts/versions.ts',
    dest: 'tools/mcp/src/contracts/versions.ts',
  },
];

const BANNER_RE =
  /^\/\*\*\r?\n \* AUTO-SYNCED from [^\r\n]+\r?\n \* Run: npm run sync:mcp-generated[^\r\n]*\r?\n \*\/\r?\n\r?\n/;

export function makeBanner(sourcePosix: string): string {
  return (
    '/**\n' +
    ` * AUTO-SYNCED from ${sourcePosix} — do not edit by hand.\n` +
    ' * Run: npm run sync:mcp-generated  (also runs inside npm run mcp:build)\n' +
    ' */\n\n'
  );
}

export function stripBanner(body: string): string {
  return body.replace(BANNER_RE, '');
}

export function normalizeNewlines(text: string): string {
  return text.replace(/\r\n/g, '\n');
}

export function expectedDestContents(sourceBody: string, sourcePosix: string): string {
  return makeBanner(sourcePosix) + stripBanner(sourceBody);
}

function posixRel(p: string): string {
  return p.replace(/\\/g, '/');
}

export interface SyncResult {
  ok: boolean;
  mismatches: string[];
  missingSources: string[];
}

export function syncMcpGenerated(root: string, checkOnly: boolean): SyncResult {
  const mismatches: string[] = [];
  const missingSources: string[] = [];

  for (const pair of MCP_GENERATED_PAIRS) {
    const srcAbs = path.join(root, pair.source);
    const destAbs = path.join(root, pair.dest);
    const sourcePosix = posixRel(pair.source);

    if (!fs.existsSync(srcAbs)) {
      missingSources.push(sourcePosix);
      continue;
    }

    const sourceBody = fs.readFileSync(srcAbs, 'utf8');
    const expected = expectedDestContents(sourceBody, sourcePosix);

    if (checkOnly) {
      if (!fs.existsSync(destAbs)) {
        mismatches.push(`${posixRel(pair.dest)} (missing)`);
        continue;
      }
      const actual = fs.readFileSync(destAbs, 'utf8');
      if (normalizeNewlines(actual) !== normalizeNewlines(expected)) {
        mismatches.push(posixRel(pair.dest));
      }
      continue;
    }

    fs.mkdirSync(path.dirname(destAbs), { recursive: true });
    fs.writeFileSync(destAbs, expected, 'utf8');
  }

  return {
    ok: missingSources.length === 0 && mismatches.length === 0,
    mismatches,
    missingSources,
  };
}

function main(): void {
  const checkOnly = process.argv.includes('--check');
  const root = process.cwd();
  const result = syncMcpGenerated(root, checkOnly);

  if (result.missingSources.length > 0) {
    for (const src of result.missingSources) {
      process.stderr.write(`Source missing: ${src}\n`);
    }
    process.exit(1);
  }

  if (checkOnly) {
    if (!result.ok) {
      process.stderr.write('MCP generated copies out of sync:\n');
      for (const file of result.mismatches) {
        process.stderr.write(`  - ${file}\n`);
      }
      process.stderr.write('Run: npm run sync:mcp-generated\n');
      process.exit(1);
    }
    process.stdout.write(`✓ ${MCP_GENERATED_PAIRS.length} MCP generated copies in sync\n`);
    return;
  }

  for (const pair of MCP_GENERATED_PAIRS) {
    process.stdout.write(`✓ Synced ${posixRel(pair.source)} → ${posixRel(pair.dest)}\n`);
  }
}

const invokedAsCli =
  typeof process.argv[1] === 'string' &&
  path.basename(process.argv[1]).replace(/\\/g, '/').startsWith('sync-mcp-generated');

if (invokedAsCli) {
  main();
}
