/**
 * Standalone Node assert harness (not a Playwright test).
 * Run: npx tsx tools/scripts/__tests__/wizard-auth-template.test.ts
 */
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { writeAuthSetup } from '../wizard-auth-template';

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

fs.rmSync(tmp, { recursive: true, force: true });
process.stdout.write('wizard-auth-template backup tests passed\n');
