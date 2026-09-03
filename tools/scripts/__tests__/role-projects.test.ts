/**
 * Standalone Node assert harness (not a Playwright test).
 * Run: npx tsx tools/scripts/__tests__/role-projects.test.ts
 */
import assert from 'node:assert/strict';
import { roleStorageStatePath, buildRoleProject } from '../../../src/support/pw/role-projects';

function test(name: string, fn: () => void): void {
  try {
    fn();
    process.stdout.write(`  ✓ ${name}\n`);
  } catch (err) {
    process.stdout.write(`  ✗ ${name}\n`);
    throw err;
  }
}

process.stdout.write('\nrole-projects tests\n');

const prev = process.env.APP_ENV;

test('roleStorageStatePath scopes by APP_ENV', () => {
  process.env.APP_ENV = 'staging';
  assert.equal(roleStorageStatePath('finance'), '.auth/staging/finance.json');
  assert.equal(roleStorageStatePath('user'), '.auth/staging/user.json');
  assert.equal(roleStorageStatePath('general'), '.auth/staging/user.json');
  assert.equal(roleStorageStatePath('default'), '.auth/staging/user.json');
});

test('buildRoleProject uses scoped default', () => {
  process.env.APP_ENV = 'dev';
  const p = buildRoleProject({ role: 'finance' });
  const use = p.use as { storageState?: string } | undefined;
  assert.equal(use?.storageState, '.auth/dev/finance.json');
  assert.equal(p.name, 'finance-tests');
});

test('buildRoleProject accepts override', () => {
  const p = buildRoleProject({ role: 'hrd', storageState: '.auth/custom/hrd.json' });
  const use = p.use as { storageState?: string } | undefined;
  assert.equal(use?.storageState, '.auth/custom/hrd.json');
});

if (prev === undefined) delete process.env.APP_ENV;
else process.env.APP_ENV = prev;

process.stdout.write('\nAll role-projects tests passed.\n');
