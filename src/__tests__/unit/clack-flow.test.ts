import { test, expect } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  isInteractive,
  validateRequired,
  validateRoleList,
  validateUrl,
  PROMPT_CANCELLED,
} from '@/setup/prompts/clack';

const wizardPromptsSrc = path.join(__dirname, '..', '..', 'setup', 'wizard-prompts.ts');

// ─── Reusable validators (pure, shared by interactive prompts + headless flags)

test.describe('validateRequired', () => {
  test('rejects empty, whitespace, undefined', () => {
    expect(validateRequired('', 'Email')).toBeDefined();
    expect(validateRequired('   ', 'Email')).toBeDefined();
    expect(validateRequired(undefined, 'Email')).toBeDefined();
  });
  test('accepts non-empty and names the field in the error', () => {
    expect(validateRequired('x', 'Email')).toBeUndefined();
    expect(validateRequired('', 'Email')).toContain('Email');
  });
});

test.describe('validateUrl', () => {
  test('accepts http and https', () => {
    expect(validateUrl('http://localhost:3000')).toBeUndefined();
    expect(validateUrl('https://erp.example.com')).toBeUndefined();
  });
  test('rejects empty, non-http protocol, and malformed', () => {
    expect(validateUrl('')).toBeDefined();
    expect(validateUrl('ftp://x')).toBeDefined();
    expect(validateUrl('not a url')).toBeDefined();
  });
});

test.describe('validateRoleList', () => {
  test('accepts comma-separated lowercase role names', () => {
    expect(validateRoleList('user')).toBeUndefined();
    expect(validateRoleList('admin,guru,murid')).toBeUndefined();
    expect(validateRoleList('super-admin')).toBeUndefined();
  });
  test('rejects empty and names the offending role', () => {
    expect(validateRoleList('')).toBeDefined();
    expect(validateRoleList('  ')).toBeDefined();
    const err = validateRoleList('Admin Ghaib');
    expect(err).toContain('Admin Ghaib');
  });
});

// ─── Prefill contract (previous env value must be visible + editable) ────────
//
// clack semantics (verified against @clack/core + a live probe):
//   placeholder  → visible but inert; NOT returned on Enter
//   defaultValue → NOT visible; applied only at finalize
//   initialValue → written to the readline buffer: VISIBLE, editable, returned
// Prompts that carry a previous env value (BASE_URL, roles, paths) MUST use
// initialValue so QA sees and can edit the real value instead of a generic hint.

test('prefill-bearing prompts use initialValue, never defaultValue/placeholder alone', () => {
  const src = fs.readFileSync(wizardPromptsSrc, 'utf-8');
  // No clack text/password prompt may rely on defaultValue for a user-visible
  // prefill — that is the bug that hid the previous BASE_URL behind a placeholder.
  const textBlocks = src.match(/clack(Text|Password)\(\{[\s\S]*?\n\s*\}\)/g) ?? [];
  for (const block of textBlocks) {
    expect(block).not.toMatch(/\bdefaultValue:/);
  }
});

test('promptBaseUrl prefills the previous BASE_URL (visible), not a generic hint', () => {
  const src = fs.readFileSync(wizardPromptsSrc, 'utf-8');
  const block = src.slice(src.indexOf('export async function promptBaseUrl'));
  const body = block.slice(0, block.indexOf('\n}'));
  expect(body).toContain('initialValue:');
  expect(body).toContain('existing');
});

// ─── Validators stay strict for typed input ──────────────────────────────────

test('validateUrl still rejects a bad typed URL', () => {
  expect(validateUrl('')).toBeDefined();
  expect(validateUrl('not-a-url')).toBeDefined();
  expect(validateUrl('https://ok.example.com')).toBeUndefined();
});

test('validateRoleList still rejects an invalid role name', () => {
  expect(validateRoleList('Bad Role')).toBeDefined();
  expect(validateRoleList('admin,guru')).toBeUndefined();
});

test('validateRequired rejects empty (no-prefill fields must be typed)', () => {
  expect(validateRequired('', 'Password')).toBeDefined();
  expect(validateRequired('   ', 'Password')).toBeDefined();
  expect(validateRequired('x', 'Password')).toBeUndefined();
});

// ─── TTY contract ────────────────────────────────────────────────────────────

test('isInteractive reflects stdin/stdout TTY state (false under test runner)', () => {
  // Playwright unit runs are not attached to a TTY, so this must be false; the
  // wizard uses it to forbid prompting where clack select would silently pick
  // the first option.
  expect(typeof isInteractive()).toBe('boolean');
  expect(isInteractive()).toBe(false);
});

test('PROMPT_CANCELLED is the single abort token callers catch', () => {
  expect(PROMPT_CANCELLED).toBe('PROMPT_CANCELLED');
});
