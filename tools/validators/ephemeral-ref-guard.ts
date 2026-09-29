#!/usr/bin/env node
/**
 * Ephemeral Reference Guard (ARCH-013)
 *
 * Scans generated tests (tests/) and test plans (specs/) to guarantee that
 * ephemeral browser/MCP refs (ref: 123, tw-XXXX, etc.) are never persisted.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = path.resolve(__dirname, '../..');

export const EPHEMERAL_PATTERNS = [
  {
    pattern: /(?:\bref\s*:\s*\d+|\bref_\d+|\bdata-mcp-ref)|"ref"\s*:\s*\d+/,
    message: 'Ephemeral browser MCP element ref detected',
    suggestion: 'Replace with semantic locators (getByRole, getByLabel, getByText, etc.)',
  },
  {
    pattern: /\btw-[0-9a-fA-F]{4,}\b/,
    message: 'Ephemeral Playwright CLI trace/debug session handle detected',
    suggestion: 'Do not commit debug CLI session handles into persistent code',
  },
  {
    pattern: /\bplaywright-element-\d+\b/,
    message: 'Ephemeral internal Playwright DOM locator detected',
    suggestion: 'Use stable user-facing locators instead of internal DOM markers',
  },
];

export interface GuardViolation {
  file: string;
  line: number;
  message: string;
  snippet: string;
  suggestion: string;
}

export function scanFileForEphemeralRefs(filePath: string): GuardViolation[] {
  const violations: GuardViolation[] = [];
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('#')) {
      continue;
    }
    for (const { pattern, message, suggestion } of EPHEMERAL_PATTERNS) {
      if (pattern.test(line)) {
        violations.push({
          file: path.relative(ROOT, filePath).replace(/\\/g, '/'),
          line: i + 1,
          message,
          snippet: line.trim().slice(0, 100),
          suggestion,
        });
      }
    }
  }

  return violations;
}

export function runEphemeralGuard(): GuardViolation[] {
  const violations: GuardViolation[] = [];
  const scanDirs = [
    { dir: path.join(ROOT, 'tests'), ext: ['.ts', '.tsx'] },
    { dir: path.join(ROOT, 'specs'), ext: ['.md', '.json'] },
  ];

  function walk(dir: string, ext: string[]) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== 'node_modules' && entry.name !== '.git' && entry.name !== '__tests__') {
          walk(full, ext);
        }
      } else if (entry.isFile() && ext.some((e) => entry.name.endsWith(e))) {
        violations.push(...scanFileForEphemeralRefs(full));
      }
    }
  }

  for (const { dir, ext } of scanDirs) {
    walk(dir, ext);
  }

  return violations;
}

if (require.main === module) {
  const violations = runEphemeralGuard();
  if (violations.length > 0) {
    console.error(`\n❌ Ephemeral Reference Violations Detected (${violations.length}):\n`);
    for (const v of violations) {
      console.error(`  • [${v.file}:${v.line}] ${v.message}`);
      console.error(`    Snippet:    ${v.snippet}`);
      console.error(`    Suggestion: ${v.suggestion}\n`);
    }
    process.exit(1);
  } else {
    console.log('✅ No ephemeral browser reference leaks found.\n');
    process.exit(0);
  }
}
