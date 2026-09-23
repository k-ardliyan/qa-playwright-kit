/**
 * Static auth probe contract used by getStudioEnvStatus.
 * Run: npx tsx src/cli/__tests__/studio-env.test.ts
 */
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { probeAuthRoles } from '../../shared/mcp/auth-probe';

function test(name: string, fn: () => void): void {
  try {
    fn();
    process.stdout.write(`  ✓ ${name}\n`);
  } catch (err) {
    process.stdout.write(`  ✗ ${name}\n`);
    throw err;
  }
}

process.stdout.write('\nstudio-env tests\n');

test('missing auth dir returns []', () => {
  const missing = path.join(os.tmpdir(), `studio-env-missing-${process.pid}`);
  assert.deepEqual(probeAuthRoles(missing), []);
});

test('cookies: [] does not throw; ready is null or false', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-env-'));
  try {
    fs.writeFileSync(path.join(dir, 'admin.json'), JSON.stringify({ cookies: [] }), 'utf8');
    const roles = probeAuthRoles(dir);
    assert.equal(roles.length, 1);
    assert.equal(roles[0].role, 'admin');
    assert.ok(roles[0].ready === null || roles[0].ready === false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

process.stdout.write('ok\n');
