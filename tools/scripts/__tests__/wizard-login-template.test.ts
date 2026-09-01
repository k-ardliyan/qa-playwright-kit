/// <reference types="node" />
/**
 * Unit tests for wizard-login-template — pure function, no I/O.
 *
 * Run:
 *   npx tsx scripts/__tests__/wizard-login-template.test.ts
 */

import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  buildLoginRequirement,
  writeLoginRequirementFile,
  type LoginTemplateState,
  type RoleSpec,
} from '../wizard-login-template';

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void): void {
  try {
    fn();
    process.stdout.write(`  ✓ ${name}\n`);
    passed++;
  } catch (err) {
    failed++;
    process.stdout.write(`  ✗ ${name}\n`);
    const msg = err instanceof Error ? err.message : String(err);
    process.stdout.write(`    ${msg}\n`);
  }
}

function baseState(overrides: Partial<LoginTemplateState> = {}): LoginTemplateState {
  const roles: RoleSpec[] = [{ name: 'user', authFile: '.auth/local/user.json' }];
  return {
    projectName: 'erpku',
    baseUrl: 'https://stg.erpku.com',
    loginUrl: '/login',
    successUrlPath: '/dashboard',
    roles,
    mechanism: 'form',
    ...overrides,
  };
}

// ─── form mechanism ──────────────────────────────────────────────────────────

test('form: title uses project name', () => {
  const md = buildLoginRequirement(baseState());
  assert.ok(md.includes('# REQ-AUTH-001: Login — erpku'), 'title missing');
});

test('form: no POM metadata (Path A)', () => {
  const md = buildLoginRequirement(baseState());
  assert.ok(!md.includes('POM yang dibutuhkan'), 'should not include POM metadata');
});

test('form: fictional user, never wrong password on real role', () => {
  const md = buildLoginRequirement(baseState());
  assert.ok(md.includes('qa.invalid.user.not.exists'), 'fictional user missing');
  assert.ok(md.includes('credential:user.password'), 'should use credential provenance');
  assert.ok(md.toLowerCase().includes('tidak terkunci'), 'must warn account not locked');
});

test('form: anti-lockout note present', () => {
  const md = buildLoginRequirement(baseState());
  assert.ok(md.includes('tidak terkunci'), 'anti-lockout note missing');
});

test('form: pathname assertion (not URL contains)', () => {
  const md = buildLoginRequirement(baseState());
  assert.ok(md.includes('pathname mengandung'), 'should assert pathname');
  assert.ok(md.includes('TIDAK** mengandung'), 'should assert exclusion');
});

test('form: refers to credential provenance, not plaintext', () => {
  const md = buildLoginRequirement(baseState());
  assert.ok(md.includes('credential:user.email'), 'credential email missing');
  assert.ok(md.includes('credential:user.password'), 'credential password missing');
  assert.ok(md.includes('TEST_USER_EMAIL'), 'env prefix still documented in precondition');
});

test('form: multi-role adds Role scope metadata', () => {
  const md = buildLoginRequirement(
    baseState({
      roles: [
        { name: 'superadmin', authFile: '.auth/local/superadmin.json' },
        { name: 'finance', authFile: '.auth/local/finance.json' },
      ],
    }),
  );
  assert.ok(md.includes('Role scope'), 'role scope metadata missing');
  assert.ok(md.includes('superadmin'), 'role name missing');
  assert.ok(md.includes('finance'), 'role name missing');
});

test('form: uses loginUrl from state', () => {
  const md = buildLoginRequirement(baseState({ loginUrl: '/auth/sign-in' }));
  assert.ok(md.includes('/auth/sign-in'), 'custom loginUrl missing');
});

test('form: uses successUrlPath from state', () => {
  const md = buildLoginRequirement(baseState({ successUrlPath: '/home' }));
  assert.ok(md.includes('/home'), 'custom success path missing');
});

function langkahBlocks(md: string): string {
  const parts = md.split('**Langkah:**');
  return parts
    .slice(1)
    .map((p) => {
      if (!p.includes('**Hasil yang Diharapkan:**')) return '';
      return p.split('**Hasil yang Diharapkan:**')[0] ?? '';
    })
    .join('\n');
}

test('form: field hints are interpolated when provided', () => {
  const md = buildLoginRequirement(
    baseState({
      loginFieldHints: ['email'],
      passwordFieldHints: ['kata_sandi'],
      submitButtonHints: ['Masuk'],
    }),
  );
  assert.ok(md.includes('`email`'), 'custom login hint missing');
  assert.ok(md.includes('`kata_sandi`'), 'custom password hint missing');
  assert.ok(md.includes('`Masuk`'), 'custom submit hint missing');
});

test('form: steps never repeat Input Data values', () => {
  const md = buildLoginRequirement(baseState({ challengeMode: 'otp-browser' }));
  const steps = langkahBlocks(md);
  assert.ok(!steps.includes('credential:'), 'steps must not copy credential provenance');
  assert.ok(!steps.includes('literal:'), 'steps must not copy literal provenance');
  assert.ok(!steps.includes('qa.invalid.user.not.exists'), 'fictional user belongs in Input Data');
  assert.ok(!steps.includes('WrongPasswordInvalid!'), 'password value belongs in Input Data');
  assert.ok(!steps.includes('https://stg.erpku.com'), 'URL belongs in Prekondisi / Input Data');
  assert.ok(md.includes('identifier: credential:user.email'), 'input data still has credentials');
  assert.ok(
    md.includes('identifier: literal:qa.invalid.user.not.exists'),
    'input data still has fictional user',
  );
  assert.ok(md.includes('Test Step'), 'footer must teach dashboard column split');
});

test('form: includes snapshot_page / catalog guidance for site-specific locators', () => {
  const md = buildLoginRequirement(baseState());
  assert.ok(md.includes('snapshot_page'), 'must instruct snapshot_page');
  assert.ok(md.includes('selector-catalog'), 'must mention selector-catalog');
  assert.ok(md.includes('**Module:** auth'), 'module metadata missing');
  assert.ok(md.includes('**Feature:** login'), 'feature metadata missing');
});

test('form: auth path uses APP_ENV scope vocabulary', () => {
  const md = buildLoginRequirement(baseState());
  assert.ok(
    md.includes('.auth/{APP_ENV}/') || md.includes('.auth/local/user.json'),
    'scoped auth path missing',
  );
  assert.ok(
    md.includes('role **`user`**') ||
      md.includes('role **user**') ||
      md.includes('Akun kredensial default'),
    'user vocabulary missing',
  );
  assert.ok(
    !md.includes("role 'default'") && !md.includes('role `default`'),
    'must not teach role default',
  );
});

// ─── sso mechanism ───────────────────────────────────────────────────────────

test('sso: marks all scenarios as manual', () => {
  const md = buildLoginRequirement(baseState({ mechanism: 'sso' }));
  assert.ok(md.includes('(@manual)'), 'sso scenario should be manual');
  assert.ok(
    md.includes('Tidak bisa diotomasi') || md.includes('tidak bisa diotomasi'),
    'manual reason missing',
  );
});

test('sso: gives Hermes instruction for auth.setup.ts', () => {
  const md = buildLoginRequirement(baseState({ mechanism: 'sso' }));
  assert.ok(md.includes('auth.setup.ts'), 'sso instruction missing');
});

// ─── none mechanism ──────────────────────────────────────────────────────────

test('none: targets root, not login URL', () => {
  const md = buildLoginRequirement(baseState({ mechanism: 'none' }));
  assert.ok(md.includes('# REQ-AUTH-001: Smoke Publik'), 'none title wrong');
  assert.ok(md.includes('Tidak ada form login'), 'none rationale missing');
});

test('none: halaman awal is /', () => {
  const md = buildLoginRequirement(baseState({ mechanism: 'none' }));
  assert.ok(md.includes('**Halaman awal:** /'), 'none halaman awal should be /');
});

// ─── general ─────────────────────────────────────────────────────────────────

test('form none: no OTP/CAPTCHA manual scenario', () => {
  const md = buildLoginRequirement(baseState({ challengeMode: 'none' }));
  assert.ok(!md.includes('Verifikasi OTP'), 'none must not add OTP scenario');
  assert.ok(!md.includes('AUTH_CHALLENGE_MODE=otp'), 'none must not mention otp mode');
  assert.ok(md.includes('SC-01: Submit dengan Identifier Kosong'), 'negatives start first');
  assert.ok(md.includes('SC-04: Submit dengan Identifier Hanya Spasi'), 'whitespace case present');
  assert.ok(md.includes('literal:   '), 'whitespace literal must keep trailing spaces');
  assert.ok(md.includes('SC-07: Login Berhasil'), 'success is last auto scenario');
});

test('form otp-browser: negatives first; OTP is last (@manual) covering AC-07', () => {
  const md = buildLoginRequirement(baseState({ challengeMode: 'otp-browser' }), {
    generated: false,
  });
  assert.ok(md.includes('# REQ-AUTH-OTP-BROWSER:'), 'catalog id missing');
  assert.ok(
    !md.includes('Login Berhasil dengan Kredensial Valid (@success)'),
    'must not emit auto success when OTP required',
  );
  assert.ok(md.includes('SC-01: Submit dengan Identifier Kosong'), 'empty ident first');
  assert.ok(md.includes('SC-06: Login Gagal dengan User Fiktif'), 'fictional before challenge');
  assert.ok(md.includes('SC-07: Verifikasi OTP di Browser (@manual)'), 'otp last');
  assert.ok(md.includes('`TC-LOGIN-007`'), 'challenge Test ID must stay 3-digit');
  assert.ok(md.includes('AUTH_CHALLENGE_MODE=otp-browser'), 'mode missing');
  assert.ok(md.includes('**AC-08:**'), 'challenge AC missing');
  assert.ok(md.includes('Covers:** `AC-07`, `AC-08`'), 'manual success must cover AC-07');
  assert.ok(md.includes('credential:user.email'), 'credential provenance missing');
  const idxFail = md.indexOf('SC-01:');
  const idxFictional = md.indexOf('SC-06:');
  const idxOtp = md.indexOf('SC-07:');
  assert.ok(idxFail < idxFictional && idxFictional < idxOtp, 'order: empty → fictional → otp');
});

test('form captcha-browser: CAPTCHA stays (@manual), never terminal', () => {
  const md = buildLoginRequirement(baseState({ challengeMode: 'captcha-browser' }), {
    generated: false,
  });
  assert.ok(md.includes('# REQ-AUTH-CAPTCHA:'), 'captcha id missing');
  assert.ok(
    md.includes('SC-07: Verifikasi CAPTCHA di Browser (@manual)'),
    'captcha scenario missing',
  );
  assert.ok(md.includes('terminal tidak bisa'), 'must say terminal cannot solve CAPTCHA');
});

test('form otp-stdin: OTP typed in terminal, still (@manual)', () => {
  const md = buildLoginRequirement(baseState({ challengeMode: 'otp-stdin' }), {
    generated: false,
  });
  assert.ok(md.includes('# REQ-AUTH-OTP-STDIN:'), 'stdin id missing');
  assert.ok(md.includes('SC-07: Verifikasi OTP di Terminal (@manual)'), 'stdin scenario missing');
});

test('form auto: OTP or CAPTCHA (@manual)', () => {
  const md = buildLoginRequirement(baseState({ challengeMode: 'auto' }), { generated: false });
  assert.ok(md.includes('# REQ-AUTH-AUTO:'), 'auto id missing');
  assert.ok(md.includes('SC-07: Verifikasi OTP atau CAPTCHA'), 'auto scenario missing');
});

test('output ends with newline', () => {
  const md = buildLoginRequirement(baseState());
  assert.ok(md.endsWith('\n'), 'should end with newline');
});

test('no plaintext secret leaked into requirement', () => {
  const md = buildLoginRequirement(
    baseState({
      roles: [{ name: 'admin', authFile: '.auth/local/admin.json' }],
    }),
  );
  assert.ok(md.includes('credential:admin.email'), 'should reference credential provenance');
  assert.ok(md.includes('credential:admin.password'), 'should reference credential provenance');
  const inputBlock = md.split('**Input Data:**')[1]?.split('**Langkah:**')[0] ?? '';
  const pwdLines = inputBlock.split('\n').filter((l) => /password:/i.test(l));
  assert.ok(pwdLines.length > 0, 'password input line missing');
  for (const line of pwdLines) {
    assert.ok(/credential:|literal:/.test(line), `password must use provenance prefix: ${line}`);
  }
});

test('form: loginIdPref username uses credential:user.username', () => {
  const md = buildLoginRequirement(baseState({ loginIdPref: 'username' }));
  assert.ok(md.includes('credential:user.username'), 'username credential missing');
  assert.ok(!md.includes('identifier: credential:user.email'), 'must not default to email');
});

test('writeLoginRequirementFile skips custom (non-autogen) login.md', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'login-req-'));
  const custom = path.join(tmp, 'requirements');
  fs.mkdirSync(custom);
  fs.writeFileSync(path.join(custom, 'login.md'), '# REQ-CUSTOM: Hand-written\n', 'utf-8');
  const result = writeLoginRequirementFile(tmp, baseState());
  assert.equal(result.skipped, true);
  const kept = fs.readFileSync(path.join(custom, 'login.md'), 'utf-8');
  assert.ok(kept.includes('REQ-CUSTOM'), 'custom file must not be overwritten');
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('writeLoginRequirementFile overwrites AUTO-GENERATED login.md', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'login-req-'));
  const dir = path.join(tmp, 'requirements');
  fs.mkdirSync(dir);
  fs.writeFileSync(
    path.join(dir, 'login.md'),
    '<!--\n  AUTO-GENERATED oleh setup wizard\n-->\n# stale\n',
    'utf-8',
  );
  const result = writeLoginRequirementFile(tmp, baseState());
  assert.equal(result.skipped, false);
  const next = fs.readFileSync(path.join(dir, 'login.md'), 'utf-8');
  assert.ok(next.includes('# REQ-AUTH-001: Login — erpku'), 'autogen file should be rewritten');
  fs.rmSync(tmp, { recursive: true, force: true });
});

// ─── reporter ───────────────────────────────────────────────────────────────

process.stdout.write(`\n  ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
