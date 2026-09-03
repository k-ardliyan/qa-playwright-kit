/**
 * Standalone Node assert harness (not a Playwright test).
 * Run: npx tsx tools/scripts/__tests__/env-edit-lib.test.ts
 */
import assert from 'node:assert/strict';
import {
  isValidRoleName,
  roleToEnvPrefix,
  envPrefixToRole,
  roleAuthFile,
  roleCredentialKeys,
  parseRolesFromEnvMap,
  maskSecret,
  upsertEnvContent,
  removeEnvKeys,
  parseEnvText,
  isEncryptedEnvText,
  encodeEnvValue,
  resolveLoginIdentifier,
  isRoleLoginReady,
  canonicalRoleName,
  normalizeWizardRoles,
  hasDefaultUserCredentials,
} from '../env-edit-lib';

function test(name: string, fn: () => void): void {
  try {
    fn();
    process.stdout.write(`  ✓ ${name}\n`);
  } catch (err) {
    process.stdout.write(`  ✗ ${name}\n`);
    throw err;
  }
}

process.stdout.write('\nenv-edit-lib tests\n');

test('validates role names', () => {
  assert.equal(isValidRoleName('finance'), true);
  assert.equal(isValidRoleName('super-admin'), true);
  assert.equal(isValidRoleName('user'), true);
  assert.equal(isValidRoleName('Super Admin'), false);
  assert.equal(isValidRoleName('finance_role'), false);
  assert.equal(isValidRoleName(''), false);
  assert.equal(isValidRoleName('general'), false);
});

test('canonicalRoleName maps default and general to user', () => {
  assert.equal(canonicalRoleName('default'), 'user');
  assert.equal(canonicalRoleName('general'), 'user');
  assert.equal(canonicalRoleName('finance'), 'finance');
});

test('maps role to env prefix', () => {
  assert.equal(roleToEnvPrefix('default'), 'TEST_USER');
  assert.equal(roleToEnvPrefix('user'), 'TEST_USER');
  assert.equal(roleToEnvPrefix('finance'), 'FINANCE');
  assert.equal(roleToEnvPrefix('super-admin'), 'SUPER_ADMIN');
});

test('maps env prefix to role', () => {
  assert.equal(envPrefixToRole('TEST_USER'), 'user');
  assert.equal(envPrefixToRole('SUPER_ADMIN'), 'super-admin');
  assert.equal(envPrefixToRole('FINANCE'), 'finance');
});

test('maps role to auth file (scoped by APP_ENV)', () => {
  const prev = process.env.APP_ENV;
  process.env.APP_ENV = 'local';
  try {
    assert.equal(roleAuthFile('default'), '.auth/local/user.json');
    assert.equal(roleAuthFile('user'), '.auth/local/user.json');
    assert.equal(roleAuthFile('finance'), '.auth/local/finance.json');
  } finally {
    if (prev === undefined) delete process.env.APP_ENV;
    else process.env.APP_ENV = prev;
  }

  process.env.APP_ENV = 'dev';
  try {
    assert.equal(roleAuthFile('finance'), '.auth/dev/finance.json');
  } finally {
    if (prev === undefined) delete process.env.APP_ENV;
    else process.env.APP_ENV = prev;
  }
});

test('every role has email/username/phone/password/pref keys', () => {
  process.env.APP_ENV = 'local';
  const user = roleCredentialKeys('user');
  assert.equal(user.emailKey, 'TEST_USER_EMAIL');
  assert.equal(user.usernameKey, 'TEST_USER_USERNAME');
  assert.equal(user.phoneKey, 'TEST_USER_PHONE');
  assert.equal(user.passwordKey, 'TEST_USER_PASSWORD');
  assert.equal(user.loginIdPrefKey, 'TEST_USER_LOGIN_ID_PREF');

  const fin = roleCredentialKeys('finance');
  assert.equal(fin.emailKey, 'FINANCE_EMAIL');
  assert.equal(fin.usernameKey, 'FINANCE_USERNAME');
  assert.equal(fin.phoneKey, 'FINANCE_PHONE');
  assert.equal(fin.passwordKey, 'FINANCE_PASSWORD');
  assert.equal(fin.loginIdPrefKey, 'FINANCE_LOGIN_ID_PREF');
});

test('resolveLoginIdentifier: username preferred by default', () => {
  const role = roleCredentialKeys('finance');
  const r = resolveLoginIdentifier(
    {
      FINANCE_EMAIL: 'a@b.com',
      FINANCE_USERNAME: 'fin',
      FINANCE_PHONE: '081',
      FINANCE_PASSWORD: 'x',
    },
    role,
  );
  assert.ok(!('error' in r));
  if (!('error' in r)) {
    assert.equal(r.kind, 'username');
    assert.equal(r.value, 'fin');
  }
});

test('resolveLoginIdentifier: PREF=phone wins', () => {
  const role = roleCredentialKeys('user');
  const r = resolveLoginIdentifier(
    {
      TEST_USER_EMAIL: 'a@b.com',
      TEST_USER_PHONE: '08123',
      TEST_USER_PASSWORD: 'x',
      TEST_USER_LOGIN_ID_PREF: 'phone',
    },
    role,
  );
  assert.ok(!('error' in r));
  if (!('error' in r)) {
    assert.equal(r.kind, 'phone');
    assert.equal(r.value, '08123');
    assert.equal(r.source, 'pref');
  }
});

test('resolveLoginIdentifier: username only', () => {
  const role = roleCredentialKeys('hrd');
  const r = resolveLoginIdentifier({ HRD_USERNAME: 'hrd1', HRD_PASSWORD: 'x' }, role);
  assert.ok(!('error' in r));
  if (!('error' in r)) {
    assert.equal(r.kind, 'username');
  }
});

test('resolveLoginIdentifier: rejects password without identity', () => {
  const role = roleCredentialKeys('user');
  const r = resolveLoginIdentifier({ TEST_USER_PASSWORD: 'x' }, role);
  assert.ok('error' in r);
});

test('isRoleLoginReady', () => {
  const role = roleCredentialKeys('user');
  assert.equal(
    isRoleLoginReady({ TEST_USER_PASSWORD: 'x', TEST_USER_EMAIL: 'a@b.com' }, role),
    true,
  );
  assert.equal(isRoleLoginReady({ TEST_USER_PASSWORD: 'x' }, role), false);
  // Template/example values must never count as login-ready (CI dummy env)
  assert.equal(
    isRoleLoginReady(
      { TEST_USER_PASSWORD: 'your_password_here', TEST_USER_EMAIL: 'test@example.com' },
      role,
    ),
    false,
  );
});

test('normalize multi N=1 finance + mirror writes TEST_USER and FINANCE', () => {
  const r = normalizeWizardRoles(
    [{ name: 'finance', fields: { email: 'f@x.com', password: 'p' } }],
    { mirrorToUser: true, appEnv: 'local' },
  );
  assert.equal(r.envUpserts.TEST_USER_EMAIL, 'f@x.com');
  assert.equal(r.envUpserts.TEST_USER_PASSWORD, 'p');
  assert.equal(r.envUpserts.FINANCE_EMAIL, 'f@x.com');
  assert.equal(r.envUpserts.FINANCE_PASSWORD, 'p');
  assert.equal(r.collapsedToSingle, false);
  assert.ok(r.roles.some((x) => x.name === 'user'));
  assert.ok(r.roles.some((x) => x.name === 'finance'));
});

test('normalize multi N=1 user collapses to TEST_USER only', () => {
  const r = normalizeWizardRoles([{ name: 'user', fields: { email: 'u@x.com', password: 'p' } }], {
    appEnv: 'local',
  });
  assert.equal(r.collapsedToSingle, true);
  assert.equal(r.envUpserts.TEST_USER_EMAIL, 'u@x.com');
  assert.equal(
    Object.keys(r.envUpserts).some((k) => k.startsWith('FINANCE_')),
    false,
  );
  assert.deepEqual(
    r.roles.map((x) => x.name),
    ['user'],
  );
});

test('normalize multi N=1 without mirror warns', () => {
  const r = normalizeWizardRoles(
    [{ name: 'finance', fields: { email: 'f@x.com', password: 'p' } }],
    { mirrorToUser: false, appEnv: 'local' },
  );
  assert.ok(r.warnings.length > 0);
  assert.equal(r.envUpserts.TEST_USER_EMAIL, undefined);
});

test('parseRolesFromEnvMap finds multi-role', () => {
  const prev = process.env.APP_ENV;
  process.env.APP_ENV = 'local';
  try {
    const roles = parseRolesFromEnvMap({
      BASE_URL: 'http://localhost',
      TEST_USER_EMAIL: 'a@b.com',
      TEST_USER_PASSWORD: 'secret',
      FINANCE_EMAIL: 'f@b.com',
      FINANCE_PASSWORD: 'fpw',
      SUPER_ADMIN_EMAIL: 's@b.com',
      SUPER_ADMIN_PASSWORD: 'spw',
    });
    const names = roles.map((r) => r.name);
    assert.ok(names.includes('user'));
    assert.ok(names.includes('finance'));
    assert.ok(names.includes('super-admin'));
    assert.equal(roles.find((r) => r.name === 'finance')?.authFile, '.auth/local/finance.json');
  } finally {
    if (prev === undefined) delete process.env.APP_ENV;
    else process.env.APP_ENV = prev;
  }
});

test('parseRolesFromEnvMap finds username-only role', () => {
  const roles = parseRolesFromEnvMap({
    HRD_USERNAME: 'hrd1',
    HRD_PASSWORD: 'x',
  });
  assert.deepEqual(
    roles.map((r) => r.name),
    ['hrd'],
  );
});

test('parseRolesFromEnvMap skips empty emails', () => {
  const roles = parseRolesFromEnvMap({
    FINANCE_EMAIL: '',
    HRD_EMAIL: 'h@b.com',
    HRD_PASSWORD: 'x',
  });
  assert.deepEqual(
    roles.map((r) => r.name),
    ['hrd'],
  );
});

test('hasDefaultUserCredentials', () => {
  assert.equal(
    hasDefaultUserCredentials({ TEST_USER_EMAIL: 'a@b.com', TEST_USER_PASSWORD: 'x' }),
    true,
  );
  assert.equal(
    hasDefaultUserCredentials({ FINANCE_EMAIL: 'f@b.com', FINANCE_PASSWORD: 'x' }),
    false,
  );
});

test('maskSecret', () => {
  assert.equal(maskSecret('encrypted:BA+84xxx'), '[encrypted]');
  assert.equal(maskSecret('ab'), '****');
  assert.match(maskSecret('password1'), /^\w\w\*\*\*\*\w\w$/);
  assert.equal(maskSecret(''), '(empty)');
});

test('parseEnvText', () => {
  const map = parseEnvText('# c\nFOO=bar\nBAZ="qux"\n');
  assert.equal(map.FOO, 'bar');
  assert.equal(map.BAZ, 'qux');
});

test('upsertEnvContent', () => {
  const out = upsertEnvContent('A=1\nB=2\n', { B: '9', C: '3' }, 'New');
  assert.ok(out.includes('A=1'));
  assert.ok(out.includes('B=9'));
  assert.ok(out.includes('C=3'));
  assert.ok(out.includes('# New'));
});

test('upsert quotes special passwords and roundtrips', () => {
  const special = 'p@ss#word=1! $x';
  const out = upsertEnvContent('TEST_USER_PASSWORD=old\n', {
    TEST_USER_PASSWORD: special,
  });
  assert.ok(out.includes("TEST_USER_PASSWORD='") || out.includes('TEST_USER_PASSWORD="'));
  assert.equal(parseEnvText(out).TEST_USER_PASSWORD, special);
});

test('encode prefers single quotes for dollar passwords', () => {
  assert.equal(encodeEnvValue('a$b'), "'a$b'");
  assert.equal(encodeEnvValue('plain'), 'plain');
});

test('upsert rejects newline in value', () => {
  let threw = false;
  try {
    upsertEnvContent('A=1\n', { PW: 'a\nb' });
  } catch {
    threw = true;
  }
  assert.equal(threw, true);
});

test('removeEnvKeys', () => {
  const out = removeEnvKeys('A=1\nB=2\nC=3\n', ['B']);
  assert.ok(out.includes('A=1'));
  assert.ok(!out.includes('B=2'));
  assert.ok(out.includes('C=3'));
});

test('isEncryptedEnvText', () => {
  assert.equal(isEncryptedEnvText('X=encrypted:abc'), true);
  assert.equal(isEncryptedEnvText('X=plain'), false);
});

process.stdout.write('\nAll env-edit-lib tests passed.\n');
