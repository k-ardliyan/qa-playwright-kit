/**
 * Integration tests for scripts/qa-run.ts (single-command CLI wrapper).
 *
 * Tests the argv parser + preflight + prompt builder in isolation,
 * tanpa spawn process. CLI end-to-end di-skip di test (butuh TTY).
 */

import { test, expect } from '@playwright/test';

import { execSync } from 'node:child_process';
import * as path from 'node:path';
import * as exitCodes from '../exit-codes';
import * as formatError from '../format-error';
import { buildAgentPrompt, parseRequirementPromptHints } from '../qa-run-prompt';

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const qaRunCli = path.join(repoRoot, 'tools', 'scripts', 'qa-run.ts');

test.describe('qa:run prompt builder', () => {
  test('parseRequirementPromptHints reads auth and start page', () => {
    const md = `
# REQ-01: Invoice
## Metadata
- **Auth state:** authenticated
- **Halaman awal:** /finance/invoices
- **Role scope:** finance, super-admin
`;
    expect(parseRequirementPromptHints(md)).toEqual({
      authState: 'authenticated',
      startPage: '/finance/invoices',
      roleScope: 'finance, super-admin',
      challengeMode: null,
    });
  });

  test('non-login requirement does not force login.md snapshot instructions', () => {
    const md = `
# REQ-INV-01: Approve invoice
## Metadata
- **Auth state:** authenticated
- **Halaman awal:** /finance/invoices
- **Role scope:** finance
`;
    const prompt = buildAgentPrompt('requirements/finance/approve-invoice.md', md, 'en');
    expect(prompt).toContain('requirements/finance/approve-invoice.md');
    expect(prompt).toContain('/finance/invoices');
    expect(prompt).toContain('authenticated');
    expect(prompt).not.toMatch(/This is a LOGIN \/ first-auth requirement/);
    expect(prompt).toContain('requirementPath matches this file');
    expect(prompt).toContain('[HARD RULE]');
  });

  test('login requirement keeps login snapshot guidance', () => {
    const md = `
# REQ-AUTH-01: Login form
## Metadata
- **Auth state:** unauthenticated
- **Halaman awal:** /login
`;
    const prompt = buildAgentPrompt('requirements/login.md', md, 'en');
    expect(prompt).toContain('LOGIN / first-auth');
    expect(prompt).toContain('/login');
    expect(prompt).toContain('snapshot_page');
    expect(prompt).toContain('Test Step = Langkah verbatim');
    expect(prompt).toContain('[HARD RULE]');
    expect(prompt).toContain('credential values into test.step');
  });

  test('bilingual prompt switches language', () => {
    const md = `
# REQ-AUTH-01: Login form
## Metadata
- **Auth state:** unauthenticated
- **Halaman awal:** /login
`;
    const idPrompt = buildAgentPrompt('requirements/login.md', md, 'id');
    const enPrompt = buildAgentPrompt('requirements/login.md', md, 'en');

    expect(idPrompt).toContain('Jalankan pipeline dalam mode otomatis');
    expect(idPrompt).toContain('[CEK KETAT]');
    expect(idPrompt).toContain('[ARAHAN EKSEKUSI]');
    expect(idPrompt).toContain('[KUALITAS KODE]');
    expect(enPrompt).toContain('Run the pipeline in automatic mode');
    expect(enPrompt).toContain('[HARD RULE]');
    expect(enPrompt).toContain('[EXECUTION GUIDANCE]');
    expect(enPrompt).toContain('[CODE QUALITY]');
  });

  test('interpolates baseUrl, appEnv, Phase 0.5, and artifacts/reports state path with double newlines', () => {
    const md = `
# REQ-AUTH-01: Login form
## Metadata
- **Auth state:** unauthenticated
- **Halaman awal:** /login
AUTH_CHALLENGE_MODE=otp-browser
`;
    const prompt = buildAgentPrompt('requirements/login.md', md, 'id', {
      baseUrl: 'https://staging.example.com',
      appEnv: 'staging',
    });

    expect(prompt).toContain('https://staging.example.com/login');
    expect(prompt).toContain('featureName: "auth"');
    expect(prompt).toContain('pageName: "login"');
    expect(prompt).toContain('.auth/staging');
    expect(prompt).toContain('artifacts/reports/pipeline-state.json');
    expect(prompt).toContain('Phase 0.5');
    expect(prompt).not.toContain('BASE_URL + path login');
    expect(prompt).toContain('\n\n');
  });
});

test.describe('qa:run CLI', () => {
  test('--help prints usage with options', () => {
    let out: string;
    try {
      out = execSync(`npx tsx "${qaRunCli}" --help`, {
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (e: unknown) {
      out = (e as { stdout?: string }).stdout ?? '';
    }

    expect(out).toContain('Usage:');
    expect(out).toContain('--skip-prompt');
    expect(out).toContain('--dry-run');
    expect(out).toContain('--no-confirm');
    expect(out).toContain('--open-dashboard');
    expect(out).not.toContain('--no-open-dashboard'); // default OFF — flag tidak lagi didokumentasikan
  });

  test('no args exits with usage error', () => {
    let exitCode = -1;
    let stderr = '';
    try {
      execSync(`npx tsx "${qaRunCli}"`, {
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (e: unknown) {
      const err = e as { status?: number; stderr?: string };
      exitCode = err.status ?? -1;
      stderr = err.stderr ?? '';
    }

    expect(exitCode).not.toBe(0);
    expect(stderr.toLowerCase()).toMatch(/(usage|tidak ada|not found)/);
  });

  test('non-existent requirement file exits with friendly error', () => {
    let exitCode = -1;
    let stderr = '';
    try {
      execSync(`npx tsx "${qaRunCli}" requirements/__nonexistent__.md --dry-run`, {
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (e: unknown) {
      const err = e as { status?: number; stderr?: string };
      exitCode = err.status ?? -1;
      stderr = err.stderr ?? '';
    }

    expect(exitCode).not.toBe(0);
    expect(stderr).toContain('tidak ditemukan');
  });
});

test.describe('exit-codes module', () => {
  test('exports 4 standard codes', () => {
    expect(exitCodes.EXIT.OK).toBe(0);
    expect(exitCodes.EXIT.FIXABLE).toBe(1);
    expect(exitCodes.EXIT.ESCALATE).toBe(2);
    expect(exitCodes.EXIT.USAGE).toBe(3);
  });

  test('exitCodeFromName resolves strings', () => {
    expect(exitCodes.exitCodeFromName('OK')).toBe(exitCodes.EXIT.OK);
    expect(exitCodes.exitCodeFromName('FIXABLE')).toBe(exitCodes.EXIT.FIXABLE);
    expect(exitCodes.exitCodeFromName('0')).toBe(exitCodes.EXIT.OK);
    expect(exitCodes.exitCodeFromName('UNKNOWN')).toBeUndefined();
  });
});

test.describe('format-error module', () => {
  test('FriendlyErrorInstance carries exitCode', () => {
    const inst = formatError.friendly({
      title: 'test',
      detail: 'detail',
      exitCode: exitCodes.EXIT.FIXABLE,
    });
    expect(inst.exitCode).toBe(1);
    expect(inst.friendly.title).toBe('test');
  });

  test('formatErrorString produces multiline output', () => {
    const out = formatError.formatErrorString({
      title: 'X',
      detail: 'Y',
      hint: 'Z',
      docsLink: 'docs/A',
    });
    expect(out).toContain('X');
    expect(out).toContain('Y');
    expect(out).toContain('💡 Z');
    expect(out).toContain('📖 docs/A');
  });
});
