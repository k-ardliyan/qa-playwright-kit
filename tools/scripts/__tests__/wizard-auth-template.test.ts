/**
 * Standalone Node assert harness (not a Playwright test).
 * Run: npx tsx tools/scripts/__tests__/wizard-auth-template.test.ts
 *
 * Covers:
 * - backup / non-destructive write behavior
 * - literal escaping of role names + URL values (Task 8.2)
 * - cleanup step order + best-effort storage clears (Task 8.5)
 * - AUTH_FORCE_LOGIN gate presence (template level)
 * - compile matrix of 4 generated variants (Task 8.3)
 */
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import ts from 'typescript';
import { spawnSync } from 'node:child_process';
import { writeAuthSetup, generateAuthSetupContent } from '../wizard-auth-template';
import { localBin } from '../../../src/setup/spawn-bin';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'auth-setup-'));
const out = path.join(tmp, 'auth.setup.ts');

// first write — single role
writeAuthSetup(
  {
    roles: [{ name: 'user', authFile: '.auth/local/user.json' }],
    loginUrl: '/login',
    successUrlPath: '/dashboard',
  },
  out,
);
assert.ok(fs.existsSync(out));
const v1 = fs.readFileSync(out, 'utf-8');
// shared helper present
assert.ok(v1.includes('async function loginRole('), 'shared loginRole helper missing');
// thin setup wrapper present
assert.ok(v1.includes('function configuredRoles()'), 'dynamic role discovery missing');
assert.ok(v1.includes('parseRolesFromEnvMap'), 'canonical role parser missing');
assert.ok(v1.includes('isPlaceholderCredential'), 'placeholder credential guard missing');
// authFile uses cred.authFile — NOT a hardcoded string
assert.ok(v1.includes('cred.authFile'), 'authFile must use cred.authFile, not hardcoded string');
assert.ok(!v1.includes("'.auth/"), "authFile must NOT be hardcoded literal '.auth/...' in setup");
// imports present
assert.ok(v1.includes('resolveRoleCredentials'), 'resolveRoleCredentials import missing');
assert.ok(
  v1.includes('human-challenge') || v1.includes('handlePostLoginChallenge'),
  'human-challenge import missing',
);
assert.equal(fs.existsSync(out + '.bak'), false);

// second write — multi role — should create .bak and include both roles
writeAuthSetup(
  {
    roles: [
      { name: 'user', authFile: '.auth/local/user.json' },
      { name: 'finance', authFile: '.auth/local/finance.json' },
    ],
    loginUrl: '/login',
    successUrlPath: '/home',
  },
  out,
);
assert.ok(fs.existsSync(out + '.bak'));
const bak = fs.readFileSync(out + '.bak', 'utf-8');
assert.equal(bak, v1);
const v2 = fs.readFileSync(out, 'utf-8');
assert.ok(v2.includes('authenticate:${role.name}'), 'dynamic setup block missing');
assert.ok(v2.includes('missing or placeholder credentials'), 'credential failure message missing');
assert.ok(v2.includes('cred.authFile'), 'v2 authFile must use cred.authFile');
assert.ok(v2.includes('async function loginRole('), 'v2 shared loginRole helper missing');
assert.ok(
  v2.includes('AUTH_CHALLENGE_MODE') || v2.includes('resolveChallengeMode'),
  'challenge mode missing',
);

// ─── Task 8.2 — literal escaping ───────────────────────────────────────────────

function generateFor(opts: Parameters<typeof generateAuthSetupContent>[0]): string {
  return generateAuthSetupContent(opts);
}

// Literal quoting follows Biome's `quoteStyle: single`: single-quoted, except
// when the value itself contains a single quote — then double-quoted, which
// avoids escaping (Biome's own preference). These assertions decode the emitted
// literal instead of byte-matching it, so escaping stays verifiable.

/** Decode a TS string-literal source the way the generated file will. */
function decodeTsLiteral(source: string): string {
  const quote = source[0]!;
  return source.slice(1, -1).replace(/\\(.)/g, (_m, c: string) => {
    if (c === 'n') return '\n';
    if (c === 't') return '\t';
    if (c === 'r') return '\r';
    if (c === quote) return quote;
    return c;
  });
}

/** First TS string literal appearing after `anchor`, or null. */
function literalAfter(text: string, anchor: string): string | null {
  const idx = text.indexOf(anchor);
  if (idx < 0) return null;
  const m = text
    .slice(idx + anchor.length)
    .match(/^\s*((?:'(?:[^'\\]|\\.)*')|(?:"(?:[^"\\]|\\.)*"))/);
  return m ? m[1]! : null;
}

// Query strings, apostrophes, backslashes, Unicode — all must survive as valid
// TS literals that decode back to the original value.
const nasty = generateFor({
  roles: [
    { name: 'user', authFile: '.auth/local/user.json' },
    {
      name: "o'brien",
      authFile: '.auth/local/o-brien.json',
      loginUrl: '/sso?next=/y\\backslash',
      successUrlPath: '/beranda/仪表板/über',
    },
  ],
  loginUrl: "/login?next=/x&from=O'Brien",
  successUrlPath: 'C:\\path\\dashboard',
});

// loginUrl contains an apostrophe → double-quoted, decodes unchanged
const loginLit = literalAfter(nasty, 'overrides?.loginUrl ??');
assert.ok(loginLit, 'loginUrl fallback literal missing');
assert.equal(loginLit![0], '"', 'value with an apostrophe must be double-quoted');
assert.equal(decodeTsLiteral(loginLit!), "/login?next=/x&from=O'Brien", 'loginUrl must round-trip');

// successUrlPath has no apostrophe → single-quoted, backslashes escaped
const successLit = literalAfter(nasty, 'overrides?.successUrl ??');
assert.ok(successLit, 'successUrlPath fallback literal missing');
assert.equal(successLit![0], "'", 'value without an apostrophe must be single-quoted');
assert.equal(decodeTsLiteral(successLit!), 'C:\\path\\dashboard', 'successUrlPath must round-trip');

// override table: role key with an apostrophe stays double-quoted
assert.ok(
  nasty.includes('"o\'brien": {'),
  'role name key with an apostrophe must stay double-quoted',
);
const overrideRow = nasty.split('\n').find((l) => l.includes('"o\'brien": {'));
assert.ok(overrideRow, 'override table row for the apostrophe role missing');
const ovrLogin = literalAfter(overrideRow!, 'loginUrl: ');
assert.ok(ovrLogin, 'override loginUrl literal missing');
assert.equal(
  decodeTsLiteral(ovrLogin!),
  '/sso?next=/y\\backslash',
  'override loginUrl must round-trip',
);
const ovrSuccess = literalAfter(overrideRow!, 'successUrl: ');
assert.ok(ovrSuccess, 'override successUrl literal missing');
assert.equal(
  decodeTsLiteral(ovrSuccess!),
  '/beranda/仪表板/über',
  'override successUrl must round-trip raw Unicode',
);

// Unicode fallback survives raw
const unicode = generateFor({
  roles: [{ name: 'user', authFile: '.auth/local/user.json' }],
  loginUrl: '/login',
  successUrlPath: '/beranda/仪表板',
});
const uniLit = literalAfter(unicode, 'overrides?.successUrl ??');
assert.ok(uniLit, 'unicode fallback literal missing');
assert.equal(decodeTsLiteral(uniLit!), '/beranda/仪表板', 'Unicode successUrlPath must round-trip');

// Role names in the header comment are quoted literals too (the `// ` prefix
// is stripped when the comment is embedded in the file docstring)
assert.ok(
  nasty.includes("Roles in scope: 'user', \"o'brien\""),
  'role names comment must quote literals',
);

// ─── Task 8.5 — cleanup order + best-effort storage clears ─────────────────────

function assertOrder(haystack: string, needles: string[], label: string): void {
  const idx = needles.map((n) => haystack.indexOf(n));
  for (let i = 0; i < idx.length; i++) {
    assert.ok(idx[i] >= 0, `${label}: "${needles[i]}" not found`);
    if (i > 0) {
      assert.ok(
        idx[i] > idx[i - 1],
        `${label}: "${needles[i]}" must come after "${needles[i - 1]}"`,
      );
    }
  }
}

// Documented cleanup order: initial login nav → clear cookies → clear
// localStorage → clear sessionStorage → second login nav → fill → submit → save.
assertOrder(
  v2,
  [
    "test.step('Buka halaman login'",
    "test.step('Bersihkan sisa sesi lama di context'",
    "test.step('Isi kredensial dan submit form login'",
    "test.step('Tunggu redirect sukses dan simpan session baru'",
  ],
  'step order',
);
// Cleanup order within the "Bersihkan" step — search sequentially from the
// previous hit so the FIRST login goto (before the clears) is skipped.
{
  const start = v2.indexOf("test.step('Bersihkan sisa sesi lama di context'");
  assert.ok(start >= 0);
  let cursor = start;
  const cleanupOrder = [
    'clearCookies()',
    'localStorage.clear()',
    'sessionStorage.clear()',
    'page.goto(resolveAppUrl(roleLoginUrl))',
  ];
  for (const needle of cleanupOrder) {
    const idx = v2.indexOf(needle, cursor);
    assert.ok(
      idx > cursor,
      `cleanup order: "${needle}" must come after "${cursor === start ? 'step start' : cleanupOrder[Math.max(0, cleanupOrder.indexOf(needle) - 1)]}"`,
    );
    cursor = idx;
  }
}
assertOrder(
  v2,
  [
    'input[type="email"]',
    'input[type="password"]',
    'button[type="submit"]',
    'waitForURL',
    'saveSessionState(page, authFile)',
  ],
  'fill → submit → save order',
);

// Storage clears are best-effort: localStorage/sessionStorage wrapped in one
// try/catch (matching the canonical src/support/auth.setup.ts), while
// clearCookies stays outside the try (hard failure).
const cleanupIdx = v2.indexOf('clearCookies()');
const tryIdx = v2.indexOf('try {', cleanupIdx);
const lsIdx = v2.indexOf('localStorage.clear()', cleanupIdx);
const ssIdx = v2.indexOf('sessionStorage.clear()', cleanupIdx);
const catchIdx = v2.indexOf('} catch {', cleanupIdx);
assert.ok(tryIdx > cleanupIdx, 'clearCookies must run before the try block');
assert.ok(lsIdx > tryIdx, 'localStorage.clear must be inside try');
assert.ok(ssIdx > lsIdx, 'sessionStorage.clear must be inside try');
assert.ok(catchIdx > ssIdx, 'catch must close after sessionStorage.clear');
assert.ok(v2.includes('Page never reached the app origin'), 'best-effort catch comment missing');

// AUTH_FORCE_LOGIN gate is emitted at template level (loginRole is not
// exported, so the force-login branch is covered here, not in unit tests).
assert.ok(v2.includes("process.env.AUTH_FORCE_LOGIN === 'true'"), 'AUTH_FORCE_LOGIN gate missing');
assert.ok(v2.includes('if (!forceLogin) {'), 'force-login skip gate missing');

// ─── Task 8.3 — compile matrix of generated variants ───────────────────────────

const repoRoot = path.resolve(__dirname, '../../..');
const repoRootPosix = repoRoot.replace(/\\/g, '/');

interface MatrixVariant {
  name: string;
  opts: Parameters<typeof generateAuthSetupContent>[0];
}

const matrixVariants: MatrixVariant[] = [
  {
    name: 'single-role-default-urls',
    opts: {
      roles: [{ name: 'user', authFile: '.auth/local/user.json' }],
      loginUrl: '/login',
      successUrlPath: '/dashboard',
    },
  },
  {
    name: 'multi-role-default-urls',
    opts: {
      roles: [
        { name: 'user', authFile: '.auth/local/user.json' },
        { name: 'finance', authFile: '.auth/local/finance.json' },
      ],
      loginUrl: '/login',
      successUrlPath: '/home',
    },
  },
  {
    name: 'single-role-custom-urls',
    opts: {
      roles: [
        {
          name: 'admin',
          authFile: '.auth/local/admin.json',
          loginUrl: '/admin/login?next=/x',
          successUrlPath: '/admin/dashboard',
        },
      ],
      loginUrl: '/login',
      successUrlPath: '/dashboard',
    },
  },
  {
    name: 'multi-role-mixed-urls',
    opts: {
      roles: [
        { name: 'user', authFile: '.auth/local/user.json' },
        {
          name: "o'brien",
          authFile: '.auth/local/o-brien.json',
          loginUrl: "/login?next=/x&from=O'Brien",
          successUrlPath: 'C:\\path\\dashboard',
        },
        {
          name: 'finance',
          authFile: '.auth/local/finance.json',
          successUrlPath: '/beranda/仪表板',
        },
      ],
      loginUrl: '/login',
      successUrlPath: '/dashboard',
    },
  },
];

/** Stub the generated file's relative imports so the temp compile resolves. */
function writeStubModules(dir: string): void {
  const sharedDir = path.join(dir, 'shared', 'utils');
  fs.mkdirSync(sharedDir, { recursive: true });
  fs.writeFileSync(
    path.join(sharedDir, 'role-credentials.ts'),
    `export interface RoleCredentialRef {
  name: string;
  authFile: string;
  emailKey: string;
  usernameKey: string;
  phoneKey: string;
  passwordKey: string;
  loginIdPrefKey: string;
  loginUrlPathKey: string;
  successUrlPathKey: string;
}
export function parseRolesFromEnvMap(map: Record<string, string>): RoleCredentialRef[] { return []; }
export function roleCredentialKeys(roleName: string): RoleCredentialRef {
  return {
    name: roleName,
    authFile: '.auth/local/' + roleName + '.json',
    emailKey: 'X_EMAIL',
    usernameKey: 'X_USERNAME',
    phoneKey: 'X_PHONE',
    passwordKey: 'X_PASSWORD',
    loginIdPrefKey: 'X_LOGIN_ID_PREF',
    loginUrlPathKey: 'X_LOGIN_URL_PATH',
    successUrlPathKey: 'X_SUCCESS_URL_PATH',
  };
}
export function isPlaceholderCredential(value: string | undefined | null): boolean { return false; }
`,
  );
}

/** Stub the generated file's same-dir imports (./test-metadata, ./auth-helpers, …). */
function writeSiblingStubs(dir: string): void {
  fs.writeFileSync(
    path.join(dir, 'test-metadata.ts'),
    `export function setTestMetadata(metadata: Record<string, unknown>): void {}
export function captureActualResult(result: string): void {}
`,
  );
  fs.writeFileSync(
    path.join(dir, 'auth-helpers.ts'),
    `// Stub: Page type is structural here — the generated file only calls
// goto/url/context().storageState, so a minimal structural type suffices.
export interface ResolvedRoleCredentials {
  loginId: string;
  idKind: 'email' | 'username' | 'phone';
  password: string;
  loginUrl: string;
  successUrl: string;
  authFile: string;
}
export function resolveRoleCredentials(roleName: string): ResolvedRoleCredentials {
  return { loginId: 'x', idKind: 'email', password: 'x', loginUrl: '/login', successUrl: '/dashboard', authFile: '.auth/local/' + roleName + '.json' };
}
export async function isSessionValid(page: { goto(url: string): Promise<unknown> }, options: { authFile: string; checkUrl: string; loginUrl: string }): Promise<boolean> { return false; }
export async function saveSessionState(page: { context(): { storageState(o: { path: string }): Promise<unknown> } }, authFile: string): Promise<void> {}
`,
  );
  fs.writeFileSync(
    path.join(dir, 'human-challenge.ts'),
    `export type ChallengeMode = 'auto' | 'none' | 'otp-browser' | 'otp-stdin' | 'captcha-browser';
export type DetectedChallenge = 'none' | 'otp' | 'captcha' | 'unknown';
export function resolveChallengeMode(): ChallengeMode { return 'none'; }
export function isInteractiveChallengeMode(mode: ChallengeMode): boolean { return false; }
export function resolveChallengeTimeoutMs(): number { return 180_000; }
export async function handlePostLoginChallenge(page: unknown, opts: { mode?: ChallengeMode }): Promise<DetectedChallenge> { return 'none'; }
`,
  );
  fs.writeFileSync(
    path.join(dir, 'app-url.ts'),
    `export function resolveAppUrl(pathOrUrl: string): string { return pathOrUrl; }
`,
  );
}

function compileTsconfig(tsconfigPath: string): string[] {
  const configFile = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
  assert.ok(!configFile.error, `cannot read temp tsconfig: ${tsconfigPath}`);
  const parsed = ts.parseJsonConfigFileContent(
    configFile.config,
    ts.sys,
    path.dirname(tsconfigPath),
  );
  const program = ts.createProgram(parsed.fileNames, parsed.options);
  return ts
    .getPreEmitDiagnostics(program)
    .filter((d) => d.category === ts.DiagnosticCategory.Error)
    .map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n'));
}

const matrixDir = fs.mkdtempSync(path.join(os.tmpdir(), 'auth-matrix-'));
// Generated file lives at <variantDir>/auth.setup.ts and imports
// '../shared/...' — stubs must be siblings of each variant dir.
writeStubModules(matrixDir);
for (const variant of matrixVariants) {
  const variantDir = path.join(matrixDir, variant.name);
  fs.mkdirSync(variantDir, { recursive: true });
  writeSiblingStubs(variantDir);
  fs.writeFileSync(
    path.join(variantDir, 'auth.setup.ts'),
    generateAuthSetupContent(variant.opts),
    'utf-8',
  );
  fs.writeFileSync(
    path.join(variantDir, 'tsconfig.json'),
    JSON.stringify(
      {
        compilerOptions: {
          target: 'ES2023',
          module: 'preserve',
          moduleResolution: 'bundler',
          strict: true,
          skipLibCheck: true,
          noEmit: true,
          types: ['node'],
          typeRoots: [`${repoRootPosix}/node_modules/@types`],
          paths: {
            '@playwright/test': [`${repoRootPosix}/node_modules/@playwright/test`],
          },
        },
        include: ['auth.setup.ts'],
      },
      null,
      2,
    ),
    'utf-8',
  );
  const errors = compileTsconfig(path.join(variantDir, 'tsconfig.json'));
  assert.deepEqual(
    errors,
    [],
    `variant "${variant.name}" failed to compile:\n${errors.join('\n')}`,
  );
  process.stdout.write(`  ✓ matrix variant compiles: ${variant.name}\n`);
}

// ─── Task 8.6 — generated file must already be Biome-formatted ────────────────
// A regenerated src/support/auth.setup.ts used to break `npm run format:check`
// straight after setup: tab-indented imports, an empty override table rendered
// as `= {\n\n};`, unwrapped long lines, and double-quoted literals under
// `quoteStyle: single`. This gate fails if the formatter would rewrite the
// generated file — i.e. if the template drifts from the repo's format rules.
{
  const biome = localBin(repoRoot, 'biome', process.platform);
  assert.ok(fs.existsSync(biome), `biome binary not found at ${biome} (run npm install)`);

  const assertBiomeFormatted = (content: string, label: string): void => {
    assert.ok(!/^\t/m.test(content), `${label}: generated file must not contain tab indentation`);
    const res = spawnSync(biome, ['format', '--stdin-file-path=src/support/auth.setup.ts'], {
      input: content,
      encoding: 'utf-8',
      shell: process.platform === 'win32',
    });
    assert.equal(res.status, 0, `${label}: biome format failed\n${res.stderr ?? ''}`);
    assert.equal(
      res.stdout,
      content,
      `${label}: generated file is not Biome-formatted (the formatter would rewrite it)`,
    );
  };

  const gateVariants: Array<{
    label: string;
    opts: Parameters<typeof generateAuthSetupContent>[0];
  }> = [
    {
      label: 'single-role-no-overrides',
      opts: {
        roles: [{ name: 'user', authFile: '.auth/dev/user.json' }],
        loginUrl: '/login',
        successUrlPath: '/dashboard',
      },
    },
    {
      label: 'multi-role-with-overrides',
      opts: {
        roles: [
          { name: 'user', authFile: '.auth/dev/user.json' },
          {
            name: 'admin',
            authFile: '.auth/dev/admin.json',
            loginUrl: '/admin/login',
            successUrlPath: '/admin/dashboard',
          },
        ],
        loginUrl: '/login',
        successUrlPath: '/dashboard',
      },
    },
    {
      label: 'apostrophe-role-and-unicode',
      opts: {
        roles: [
          {
            name: "o'brien",
            authFile: '.auth/dev/o-brien.json',
            loginUrl: '/sso?next=/y\\backslash',
            successUrlPath: '/beranda/仪表板',
          },
        ],
        loginUrl: "/login?next=/x&from=O'Brien",
        successUrlPath: 'C:\\path\\dashboard',
      },
    },
  ];

  for (const v of gateVariants) {
    assertBiomeFormatted(generateAuthSetupContent(v.opts), v.label);
    process.stdout.write(`  ✓ biome-formatted: ${v.label}\n`);
  }

  // An empty override table must be single-line — `= {\n\n};` is a format error.
  assert.ok(
    generateAuthSetupContent(gateVariants[0]!.opts).includes(
      'const ROLE_URL_OVERRIDES: Record<string, { loginUrl: string; successUrl: string }> = {};',
    ),
    'empty override table must render as a single line `= {};`',
  );
  // A populated override table must still render.
  assert.ok(
    // Biome's `quoteProperties: asNeeded` keeps identifier-safe keys unquoted.
    generateAuthSetupContent(gateVariants[1]!.opts).includes('  admin: {'),
    'populated override table must still render',
  );
}

fs.rmSync(tmp, { recursive: true, force: true });
fs.rmSync(matrixDir, { recursive: true, force: true });
process.stdout.write('wizard-auth-template backup tests passed\n');
