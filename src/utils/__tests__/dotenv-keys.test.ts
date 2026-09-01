/**
 * Unit tests for src/utils/dotenv-keys.ts (merge-safe key migration)
 * Run: npx tsx src/utils/__tests__/dotenv-keys.test.ts
 */
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  mergeLocalKeysIntoSecure,
  listWorkspaceKeyCandidates,
  resolveProjectName,
} from '../dotenv-keys';

function test(name: string, fn: () => void): void {
  try {
    fn();
    process.stdout.write(`  ✓ ${name}\n`);
  } catch (err) {
    process.stdout.write(`  ✗ ${name}\n`);
    throw err;
  }
}

process.stdout.write('\ndotenv-keys tests\n');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dotenv-keys-'));
const globalPath = path.join(tmp, 'global.env.keys');
const localPath = path.join(tmp, 'local.env.keys');

test('copies when global missing', () => {
  fs.writeFileSync(
    localPath,
    '# local\nDOTENV_PRIVATE_KEY_A=aaa\nDOTENV_PRIVATE_KEY_B=bbb\n',
    'utf-8',
  );
  if (fs.existsSync(globalPath)) fs.unlinkSync(globalPath);
  const r = mergeLocalKeysIntoSecure(localPath, globalPath);
  assert.equal(r.migrated, true);
  assert.equal(r.added, 2);
  assert.equal(fs.existsSync(localPath), false);
  const g = fs.readFileSync(globalPath, 'utf-8');
  assert.ok(g.includes('DOTENV_PRIVATE_KEY_A=aaa'));
  assert.ok(g.includes('DOTENV_PRIVATE_KEY_B=bbb'));
});

test('merges without overwriting existing keys', () => {
  fs.writeFileSync(
    globalPath,
    'DOTENV_PRIVATE_KEY_A=KEEP_ME\nDOTENV_PRIVATE_KEY_OLD=old\n',
    'utf-8',
  );
  fs.writeFileSync(
    localPath,
    'DOTENV_PRIVATE_KEY_A=SHOULD_NOT_WIN\nDOTENV_PRIVATE_KEY_NEW=newval\n',
    'utf-8',
  );
  const r = mergeLocalKeysIntoSecure(localPath, globalPath);
  assert.equal(r.migrated, true);
  assert.equal(r.added, 1);
  const g = fs.readFileSync(globalPath, 'utf-8');
  assert.ok(g.includes('DOTENV_PRIVATE_KEY_A=KEEP_ME'));
  assert.ok(!g.includes('SHOULD_NOT_WIN'));
  assert.ok(g.includes('DOTENV_PRIVATE_KEY_NEW=newval'));
  assert.ok(g.includes('DOTENV_PRIVATE_KEY_OLD=old'));
  assert.equal(fs.existsSync(localPath), false);
});

test('noop when local missing', () => {
  const r = mergeLocalKeysIntoSecure(path.join(tmp, 'nope.keys'), globalPath);
  assert.equal(r.migrated, false);
  assert.equal(r.added, 0);
});

test('listWorkspaceKeyCandidates paths', () => {
  const c = listWorkspaceKeyCandidates('/repo');
  const norm = c.map((p) => p.replace(/\\/g, '/'));
  assert.ok(norm.some((p) => p.endsWith('config/environments/.env.keys')));
  assert.ok(norm.some((p) => p.endsWith('/.env.keys')));
  assert.equal(
    norm.some((p) => p.endsWith('environments/.env.keys') && !p.includes('config/')),
    false,
  );
});

test('resolveProjectName from package.json', () => {
  const pkgDir = path.join(tmp, 'pkg');
  fs.mkdirSync(pkgDir, { recursive: true });
  fs.writeFileSync(path.join(pkgDir, 'package.json'), JSON.stringify({ name: 'my-fork' }), 'utf-8');
  assert.equal(resolveProjectName(pkgDir), 'my-fork');
  assert.equal(resolveProjectName(path.join(tmp, 'empty')), 'qa-playwright-kit');
});

// cleanup
fs.rmSync(tmp, { recursive: true, force: true });
process.stdout.write('\nAll dotenv-keys tests passed.\n');
