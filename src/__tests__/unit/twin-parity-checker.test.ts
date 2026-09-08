import { test, expect } from '@playwright/test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  MANUAL_TWIN_PAIRS,
  compareTwinPair,
  extractConstants,
  extractExports,
  normalizeMcpName,
} from '../../../tools/scripts/check-twin-parity';

const SRC_TWIN = `export const QA_NOTES_LOCK_TIMEOUT_MS = 3000;
export const TEST_NOTES_VERSION = 1;
export const AI_NOTE_SOURCES = ['healer', 'generator', 'reporter', 'analyzer'] as const;
export function testNoteKey(scenarioId?: string): string { return 'k'; }
export function redactSecrets(text: string): string { return text; }
export function noteKeyCandidates(): string[] { return []; }
export function isValidRunIdFormat(runId: string): boolean { return true; }
export interface TestNoteEntry { qaNotes: string; aiNotes: string; }
export const MARKER = '.pending-run.json';
export const VERDICT = 'complete';
const INTERNAL = 1;
`;

const MCP_TWIN = `export const MCP_QA_NOTES_LOCK_TIMEOUT_MS = 3000;
export const MCP_TEST_NOTES_VERSION = 1;
export const MCP_AI_NOTE_SOURCES = ['healer', 'generator', 'reporter', 'analyzer'] as const;
export function testNoteKey(scenarioId?: string): string { return 'k'; }
export function redactSecrets(text: string): string { return text; }
export function noteKeyCandidates(): string[] { return []; }
export function isValidRunIdFormat(runId: string): boolean { return true; }
export interface McpTestNoteEntry { qaNotes: string; aiNotes: string; }
export const MCP_MARKER = '.pending-run.json';
export const MCP_VERDICT = 'complete';
`;

const PAIR: Parameters<typeof compareTwinPair>[0] = {
  name: 'test-pair',
  src: 'src/x.ts',
  mcp: 'tools/mcp/src/utils/x.ts',
  requiredExports: [
    'TestNoteEntry',
    'testNoteKey',
    'redactSecrets',
    'noteKeyCandidates',
    'isValidRunIdFormat',
  ],
  requiredConstants: ['TEST_NOTES_VERSION', 'AI_NOTE_SOURCES', 'QA_NOTES_LOCK_TIMEOUT_MS'],
  requiredStrings: ['.pending-run.json', 'complete'],
};

test.describe('check-twin-parity (manual twin drift gate)', () => {
  test('aligned pair passes with no issues', () => {
    const result = compareTwinPair(PAIR, SRC_TWIN, MCP_TWIN);
    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  test('constant drift on the MCP side is detected as FAIL', () => {
    const drifted = MCP_TWIN.replace('MCP_TEST_NOTES_VERSION = 1', 'MCP_TEST_NOTES_VERSION = 2');
    const result = compareTwinPair(PAIR, SRC_TWIN, drifted);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.message.includes('TEST_NOTES_VERSION'))).toBe(true);
  });

  test('missing export on the MCP side is detected as FAIL', () => {
    const drifted = MCP_TWIN.replace('export function testNoteKey', 'function testNoteKey');
    const result = compareTwinPair(PAIR, SRC_TWIN, drifted);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.message.includes('testNoteKey'))).toBe(true);
  });

  test('missing required string on the src side is detected as FAIL', () => {
    const drifted = SRC_TWIN.replace("'.pending-run.json'", "'.other.json'");
    const result = compareTwinPair(PAIR, drifted, MCP_TWIN);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.message.includes('.pending-run.json'))).toBe(true);
  });

  test('Mcp* / MCP_* prefixes are normalized before comparison', () => {
    expect(normalizeMcpName('McpTestNoteEntry')).toBe('TestNoteEntry');
    expect(normalizeMcpName('MCP_TEST_NOTES_VERSION')).toBe('TEST_NOTES_VERSION');
    expect(normalizeMcpName('mcpTestNoteKey')).toBe('TestNoteKey');
    expect(normalizeMcpName('redactSecrets')).toBe('redactSecrets');
  });

  test('extractExports collects exported names only', () => {
    const names = extractExports(SRC_TWIN);
    expect(names).toContain('testNoteKey');
    expect(names).toContain('TestNoteEntry');
    expect(names).not.toContain('INTERNAL'); // non-exported const
  });

  test('extractConstants reads values and strips `as const`', () => {
    const consts = extractConstants(SRC_TWIN);
    expect(consts.get('TEST_NOTES_VERSION')).toBe('1');
    expect(consts.get('AI_NOTE_SOURCES')).toBe("['healer', 'generator', 'reporter', 'analyzer']");
    expect(consts.get('QA_NOTES_LOCK_TIMEOUT_MS')).toBe('3000');
  });

  test('keyRegexTokens drift is a WARNING, not a FAIL (longgak pair)', () => {
    const longgakPair = {
      name: 'classifier',
      src: 'src/classifier.ts',
      mcp: 'tools/mcp/src/utils/classifier.ts',
      keyRegexTokens: ['401|403', 'waiting for locator', 'isHealable: true'],
    };
    const src = `const A = /401|403/; const B = /waiting for locator/; const C = 'isHealable: true';`;
    const mcp = `const A = /401|403/; const B = /waiting for locator/;`;
    const result = compareTwinPair(longgakPair, src, mcp);
    expect(result.ok).toBe(true);
    expect(result.warnings.length).toBe(1);
    expect(result.warnings[0]?.message).toContain('isHealable: true');
  });

  test('CLI exits 0 on the live tree (read-only)', () => {
    const root = process.cwd();
    const script = path.join(root, 'tools', 'scripts', 'check-twin-parity.ts');
    const result = spawnSync('npx', ['tsx', script], {
      cwd: root,
      encoding: 'utf-8',
      shell: true,
    });
    expect(result.status, result.stderr || result.stdout).toBe(0);
    expect(String(result.stdout ?? '')).toContain('manual twin parity OK');
  });

  test('CLI exits 1 when a twin drifts (isolated temp tree)', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'twin-parity-'));
    try {
      const pair = MANUAL_TWIN_PAIRS[0] as (typeof MANUAL_TWIN_PAIRS)[number];
      const srcAbs = path.join(tmp, pair.src);
      const mcpAbs = path.join(tmp, pair.mcp);
      fs.mkdirSync(path.dirname(srcAbs), { recursive: true });
      fs.mkdirSync(path.dirname(mcpAbs), { recursive: true });
      fs.writeFileSync(srcAbs, SRC_TWIN, 'utf-8');
      fs.writeFileSync(
        mcpAbs,
        MCP_TWIN.replace('MCP_TEST_NOTES_VERSION = 1', 'MCP_TEST_NOTES_VERSION = 2'),
        'utf-8',
      );

      const script = path.join(process.cwd(), 'tools', 'scripts', 'check-twin-parity.ts');
      const result = spawnSync('npx', ['tsx', script], {
        cwd: tmp,
        encoding: 'utf-8',
        shell: true,
      });
      expect(result.status).toBe(1);
      expect(String(result.stdout ?? '')).toContain('TEST_NOTES_VERSION');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
