/// <reference types="node" />
/**
 * Manual twin parity gate — quality-gate check for the four deliberate forks
 * under tools/mcp/src/utils/ (the MCP server builds separately with its own
 * tsconfig and cannot import from src/, so these files are maintained by hand).
 *
 * Unlike `sync:mcp-generated` (byte-exact AUTO-SYNCED copies), manual twins
 * only have to keep a documented SEMANTIC contract in sync. This script parses
 * both files as text (never imports tools/mcp — separate tsconfig) and verifies
 * the contract per pair:
 *
 *   - export names must exist on both sides, after normalizing the MCP-side
 *     `Mcp`/`MCP_`/`mcp` prefix (see MANUAL_TWIN_PAIRS.requiredExports)
 *   - constant names must carry the identical normalized value on both sides
 *     (requiredConstants)
 *   - raw semantic substrings (env names, marker file names, verdict literals,
 *     evidence keys, issue strings) must be present in both files
 *     (requiredStrings / srcMustContain / mcpMustContain)
 *   - failure-classifier is a LONGGAK (deliberately looser) pair: key regex
 *     tokens must be present in BOTH sides, but a missing token is only a
 *     WARNING (exit 0), never a FAIL
 *
 * Check-only — there is no write/repair mode. Exit 1 on FAIL, 0 otherwise
 * (warnings included). Run: npm run check:twin-parity
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

export interface ManualTwinPair {
  /** Short label used in CLI output. */
  name: string;
  /** Source of truth (src/) relative to repo root. */
  src: string;
  /** Manual MCP twin (tools/mcp/) relative to repo root. */
  mcp: string;
  /**
   * Export names (src form) that must exist on both sides after Mcp-prefix
   * normalization. Function count differences are deliberately NOT checked
   * (MCP fork is a subset); the shared-name contract is this list.
   */
  requiredExports?: string[];
  /** Const names (src form) whose normalized value must be identical on both sides. */
  requiredConstants?: string[];
  /** Raw substrings that must appear verbatim in both files. */
  requiredStrings?: string[];
  /** Raw substrings that must appear in the src file only. */
  srcMustContain?: string[];
  /** Raw substrings that must appear in the MCP twin only. */
  mcpMustContain?: string[];
  /**
   * failure-classifier only (LONGGAK): regex fragments that must be present in
   * both sides' classifier regexes. A missing fragment is a WARNING (exit 0).
   */
  keyRegexTokens?: string[];
}

export const MANUAL_TWIN_PAIRS: ManualTwinPair[] = [
  {
    name: 'test-notes',
    src: 'src/agents/reporter/test-notes.ts',
    mcp: 'tools/mcp/src/utils/test-notes.ts',
    requiredExports: [
      // Shared types (both after Mcp-prefix normalization)
      'TestNoteEntry',
      'TestNotesFile',
      'RunInsightEntry',
      'InsightDraft',
      'AiNoteSource',
      'AiInsightStatus',
      'AiInsightPriority',
      'AiInsightConfidence',
      'AppendAiNoteResult',
      'AppendRunInsightResult',
      // Shared functions — the key/redaction/validation contract
      'redactSecrets',
      'testNoteKey',
      'noteKeyCandidates',
      'isValidRunIdFormat',
      'latestTestNotesPath',
      'archivedTestNotesPath',
      'composeInsightText',
      'upsertTestNote',
      'appendAiNote',
      'appendRunInsight',
    ],
    requiredConstants: [
      'TEST_NOTES_VERSION',
      'MAX_TEST_NOTE_LENGTH',
      'MAX_RUN_INSIGHTS',
      'AI_NOTE_SOURCES',
      'AI_INSIGHT_STATUSES',
      'AI_INSIGHT_PRIORITIES',
      'AI_INSIGHT_CONFIDENCE',
    ],
    // Shared env knob — lock semantics (timeouts, staleness) are a deliberate
    // fork and NOT part of the contract.
    requiredStrings: ['QA_NOTES_LOCK_TIMEOUT_MS'],
  },
  {
    name: 'run-context',
    src: 'src/agents/reporter/run-context.ts',
    mcp: 'tools/mcp/src/utils/run-context.ts',
    // Function names are Mcp-prefixed and excluded from the contract by design.
    requiredConstants: ['PENDING_RUN_TTL_MS'],
    requiredStrings: ['.pending-run.json'],
    // runId format: src delegates to report-archive.generateRunId; the MCP
    // twin composes the identical `run-YYYYMMDD-HHmmss-SSS` template itself.
    srcMustContain: ['generateRunId'],
    mcpMustContain: ['run-${d.getFullYear()}'],
  },
  {
    name: 'analysis-gate',
    src: 'src/agents/reporter/analysis-gate.ts',
    mcp: 'tools/mcp/src/utils/analysis-gate.ts',
    // Verdict set, gate codes, evidence keys and issue strings are the contract;
    // names (Mcp prefix) and extra exports are excluded by design.
    requiredStrings: [
      // verdict literal set
      "'complete'",
      "'incomplete'",
      "'inconsistent'",
      "'unverifiable'",
      "'not-applicable'",
      // gate codes
      "'ANALYSIS_INCOMPLETE'",
      "'ANALYSIS_UNVERIFIABLE'",
      "'ANALYSIS_EVIDENCE_MISMATCH'",
      // evidence keys
      'sidecarAvailable',
      'sidecarRunId',
      'expectedRunId',
      'runInsightsCount',
      'agentRunInsightsCount',
      'reporterRunInsightsCount',
      'passedCount',
      'passedScenarioIds',
      // issue strings
      'analysis block missing from pipeline report',
      'analysis.completed !== true',
      'no Reporter Analyze run insight exists in the sidecar',
      'sidecar runId missing — evidence cannot be bound to this archive run',
    ],
  },
  {
    name: 'failure-classifier',
    src: 'src/shared/evidence/failure-classifier.ts',
    mcp: 'tools/mcp/src/utils/failure-classifier.ts',
    // LONGGAK pair: only the basic classification consistency is checked.
    // Full contract parity is intentionally not required. Missing token on
    // either side = WARNING (exit 0), never FAIL.
    keyRegexTokens: [
      // auth → not healable
      '401|403',
      'session expired',
      'redirected to login',
      // 5xx → application, not healable
      '5\\d\\d',
      'internal server error',
      // network — gateway timeout reconciled; note that bare '504'/'503' numbers
      // in src step 3 are unreachable dead branches because \b5\d\d\b in step 1 matches them first
      // and classifies them as application error in both src and MCP.
      'econnrefused',
      'enotfound',
      'net::err_',
      'gateway timeout',
      // locator → healable
      'waiting for locator',
      'strict mode violation',
      'tobevisible',
      // timeout → healable
      'timeout \\d+ms exceeded',
      'timed out waiting for',
      // healability semantics
      'isHealable: true',
      'isHealable: false',
    ],
  },
];

// ─── Text extraction (parse-only; tools/mcp is never imported) ───────────────

/** All exported names: `export (function|const|class|interface|type) Name` and `export { ... }`. */
export function extractExports(text: string): string[] {
  const names: string[] = [];
  const re =
    /export\s+(?:declare\s+)?(?:function|const|class|interface|type)\s+([A-Za-z_$][\w$]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) names.push(m[1] as string);

  const clauseRe = /export\s*\{([^}]+)\}/g;
  while ((m = clauseRe.exec(text))) {
    const clause = m[1];
    for (const part of clause.split(',')) {
      const trimmed = part.trim().replace(/^type\s+/, '');
      const asMatch = trimmed.match(/(?:^|\s+)as\s+([A-Za-z_$][\w$]*)$/);
      if (asMatch) {
        names.push(asMatch[1]);
      } else {
        const nameMatch = trimmed.match(/^([A-Za-z_$][\w$]*)/);
        if (nameMatch) names.push(nameMatch[1]);
      }
    }
  }

  return names;
}

/** Normalize the MCP-side naming prefix: `McpFoo`/`MCP_FOO`/`mcpFoo` → `Foo`. */
export function normalizeMcpName(name: string): string {
  if (name.startsWith('MCP_')) return name.slice(4);
  if (name.startsWith('Mcp')) return name.slice(3);
  if (name.startsWith('mcp')) return name.slice(3);
  return name;
}

/**
 * Extract `const Name = value` initializers (optionally typed) with the value
 * normalized to a single line (whitespace collapsed, trailing `as const`
 * stripped). Skips balanced `[](){}` groups and quoted strings when hunting for
 * the initializer `=` and the terminating `;`.
 */
export function extractConstants(text: string): Map<string, string> {
  const map = new Map<string, string>();
  const declRe = /const\s+([A-Za-z_$][\w$]*)/g;
  let m: RegExpExecArray | null;
  while ((m = declRe.exec(text))) {
    const name = m[1] as string;
    let eq = -1;
    let depth = 0;
    let inString: string | null = null;
    for (let i = declRe.lastIndex; i < text.length; i++) {
      const ch = text[i] as string;
      if (inString) {
        if (ch === inString) inString = null;
        continue;
      }
      if (ch === "'" || ch === '"' || ch === '`') {
        inString = ch;
      } else if (ch === '(' || ch === '[' || ch === '{') {
        depth++;
      } else if (ch === ')' || ch === ']' || ch === '}') {
        depth--;
      } else if (ch === '=' && depth === 0) {
        eq = i;
        break;
      }
    }
    if (eq < 0) continue;
    let depthVal = 0;
    let inStringVal: string | null = null;
    let end = eq + 1;
    for (; end < text.length; end++) {
      const ch = text[end] as string;
      if (inStringVal) {
        if (ch === inStringVal) inStringVal = null;
        continue;
      }
      if (ch === "'" || ch === '"' || ch === '`') {
        inStringVal = ch;
      } else if (ch === '(' || ch === '[' || ch === '{') {
        depthVal++;
      } else if (ch === ')' || ch === ']' || ch === '}') {
        depthVal--;
      } else if (ch === ';' && depthVal === 0) {
        break;
      }
    }
    const raw = text.slice(eq + 1, end);
    const value = raw
      .replace(/\s+/gs, ' ')
      .trim()
      .replace(/\s+as\s+const\s*$/i, '');
    map.set(name, value);
    declRe.lastIndex = end + 1;
  }
  return map;
}

// ─── Comparison ──────────────────────────────────────────────────────────────

export interface TwinIssue {
  kind: 'fail' | 'warning';
  message: string;
}

export interface TwinPairResult {
  name: string;
  /** True when no FAIL issues (warnings are tolerated). */
  ok: boolean;
  issues: TwinIssue[];
  warnings: TwinIssue[];
}

/** Pure text comparison of one twin pair — no filesystem access. */
export function compareTwinPair(
  pair: ManualTwinPair,
  srcText: string,
  mcpText: string,
): TwinPairResult {
  const issues: TwinIssue[] = [];
  const warnings: TwinIssue[] = [];

  const srcExports = new Set(extractExports(srcText));
  const mcpExports = new Set(extractExports(mcpText).map(normalizeMcpName));
  const srcConsts = extractConstants(srcText);
  const mcpConsts = new Map(
    [...extractConstants(mcpText)].map(([n, v]) => [normalizeMcpName(n), v] as const),
  );

  for (const name of pair.requiredExports ?? []) {
    if (!srcExports.has(name)) {
      issues.push({ kind: 'fail', message: `export missing in src: ${name}` });
    } else if (!mcpExports.has(normalizeMcpName(name))) {
      issues.push({
        kind: 'fail',
        message: `export missing in MCP twin (after Mcp-prefix normalization): ${name}`,
      });
    }
  }

  for (const name of pair.requiredConstants ?? []) {
    const srcVal = srcConsts.get(name);
    const mcpVal = mcpConsts.get(normalizeMcpName(name));
    if (srcVal === undefined) {
      issues.push({ kind: 'fail', message: `constant not found in src: ${name}` });
    } else if (mcpVal === undefined) {
      issues.push({ kind: 'fail', message: `constant missing in MCP twin: ${name}` });
    } else if (srcVal !== mcpVal) {
      issues.push({
        kind: 'fail',
        message: `constant value drift: ${name} (src: ${srcVal} vs MCP: ${mcpVal})`,
      });
    }
  }

  for (const s of pair.requiredStrings ?? []) {
    if (!srcText.includes(s)) {
      issues.push({ kind: 'fail', message: `string missing in src: ${s}` });
    } else if (!mcpText.includes(s)) {
      issues.push({ kind: 'fail', message: `string missing in MCP twin: ${s}` });
    }
  }

  for (const s of pair.srcMustContain ?? []) {
    if (!srcText.includes(s)) issues.push({ kind: 'fail', message: `expected in src: ${s}` });
  }
  for (const s of pair.mcpMustContain ?? []) {
    if (!mcpText.includes(s)) issues.push({ kind: 'fail', message: `expected in MCP twin: ${s}` });
  }

  // LONGGAK (failure-classifier): token drift is a warning, not a fail.
  for (const t of pair.keyRegexTokens ?? []) {
    if (!srcText.includes(t))
      warnings.push({ kind: 'warning', message: `regex token missing in src: ${t}` });
    if (!mcpText.includes(t))
      warnings.push({ kind: 'warning', message: `regex token missing in MCP twin: ${t}` });
  }

  return { name: pair.name, ok: issues.length === 0, issues, warnings };
}

// ─── CLI ─────────────────────────────────────────────────────────────────────

function loadSourceWithLocalReExports(filePath: string): string {
  let content = fs.readFileSync(filePath, 'utf8');
  const dir = path.dirname(filePath);
  const reExportMatches = content.matchAll(/from\s+['"](\.\/[^'"]+)['"]/g);
  for (const match of reExportMatches) {
    const subRel = match[1];
    for (const ext of ['.ts', '.tsx', '/index.ts']) {
      const candidate = path.join(dir, `${subRel}${ext}`);
      if (fs.existsSync(candidate)) {
        content += '\n' + fs.readFileSync(candidate, 'utf8');
        break;
      }
    }
  }
  return content;
}

/**
 * Find src/ files whose body is byte-identical (after banner/newline
 * normalization) to a tools/mcp/src file but that are NOT declared in
 * MCP_GENERATED_PAIRS — a hand fork that should either be registered as a
 * byte-sync pair or reconciled deliberately. Warning-level (exit 0), because
 * some identical files are intentional (e.g. pre-sync state during a PR).
 */
export function findIdenticalUnregisteredTwin(srcFile: string, mcpFile: string): boolean {
  const normalized = (p: string): string => {
    const body = fs.readFileSync(p, 'utf8');
    return body
      .replace(/^\/\*\*[\s\S]*?\*\/\r?\n\r?\n/, '') // leading doc banner
      .replace(/\r\n/g, '\n')
      .trim();
  };
  try {
    return normalized(srcFile) === normalized(mcpFile);
  } catch {
    return false;
  }
}

function reportIdenticalUnregisteredTwins(root: string): number {
  const { MCP_GENERATED_PAIRS } =
    require('./sync-mcp-generated') as typeof import('./sync-mcp-generated');
  const registeredSrc = new Set(MCP_GENERATED_PAIRS.map((p) => p.source.replace(/\\/g, '/')));
  const registeredDest = new Set(MCP_GENERATED_PAIRS.map((p) => p.dest.replace(/\\/g, '/')));
  let found = 0;

  const walkMcp = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== 'node_modules') walkMcp(full);
        continue;
      }
      if (!/\.(ts|tsx)$/.test(entry.name)) continue;
      const mcpRel = path.relative(root, full).replace(/\\/g, '/');
      if (registeredDest.has(mcpRel)) continue;
      if (fs.readFileSync(full, 'utf8').includes('AUTO-SYNCED from')) continue; // handled by sync check
      // Same-relative-path src candidate.
      const srcRel = mcpRel.replace(/^tools\/mcp\/src\//, 'src/');
      const srcAbs = path.join(root, srcRel);
      if (!fs.existsSync(srcAbs)) continue;
      if (registeredSrc.has(srcRel)) continue;
      if (findIdenticalUnregisteredTwin(srcAbs, full)) {
        process.stdout.write(
          `⚠ identical unregistered twin: ${srcRel} ↔ ${mcpRel} (declare in MCP_GENERATED_PAIRS or reconcile)\n`,
        );
        found++;
      }
    }
  };
  const mcpSrc = path.join(root, 'tools', 'mcp', 'src');
  if (fs.existsSync(mcpSrc)) walkMcp(mcpSrc);
  return found;
}

function main(): void {
  const root = process.cwd();
  let failedPairs = 0;
  let warnings = 0;

  for (const pair of MANUAL_TWIN_PAIRS) {
    const srcAbs = path.join(root, pair.src);
    const mcpAbs = path.join(root, pair.mcp);
    if (!fs.existsSync(srcAbs) || !fs.existsSync(mcpAbs)) {
      process.stderr.write(`✗ ${pair.name}: missing file (src: ${pair.src} / mcp: ${pair.mcp})\n`);
      failedPairs++;
      continue;
    }
    const result = compareTwinPair(
      pair,
      loadSourceWithLocalReExports(srcAbs),
      fs.readFileSync(mcpAbs, 'utf8'),
    );
    if (result.ok && result.warnings.length === 0) {
      process.stdout.write(`✓ ${pair.name} — parity in sync\n`);
    } else {
      warnings += result.warnings.length;
      for (const w of result.warnings) {
        process.stdout.write(`⚠ ${pair.name} — ${w.message}\n`);
      }
      if (result.ok) {
        process.stdout.write(
          `⚠ ${pair.name} — aligned, ${result.warnings.length} longgak warning(s)\n`,
        );
      } else {
        failedPairs++;
        process.stdout.write(`✗ ${pair.name} — ${result.issues.length} drift issue(s)\n`);
        for (const i of result.issues) {
          process.stdout.write(`  ✗ ${i.message}\n`);
        }
      }
    }
  }

  const unregisteredTwins = reportIdenticalUnregisteredTwins(root);
  warnings += unregisteredTwins;

  if (failedPairs > 0) {
    process.stderr.write(
      `✗ manual twin parity FAILED: ${failedPairs} pair(s) drifted. ` +
        'Reconcile the fork or extend the pair contract deliberately — never silently.\n',
    );
    process.exit(1);
  }
  process.stdout.write(
    `✓ manual twin parity OK (${MANUAL_TWIN_PAIRS.length} pairs, ${warnings} longgak warning(s))\n`,
  );
}

const invokedAsCli =
  typeof process.argv[1] === 'string' &&
  path.basename(process.argv[1]).replace(/\\/g, '/').startsWith('check-twin-parity');

if (invokedAsCli) {
  main();
}
