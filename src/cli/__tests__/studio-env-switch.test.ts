/**
 * Run: npx tsx src/cli/__tests__/studio-env-switch.test.ts
 */
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { switchStudioEnv } from '../studio-env-switch';

function test(name: string, fn: () => void): void {
  try {
    fn();
    process.stdout.write(`  ✓ ${name}\n`);
  } catch (err) {
    process.stdout.write(`  ✗ ${name}\n`);
    throw err;
  }
}

process.stdout.write('\nstudio-env-switch tests\n');

test('local pin file contains local', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-env-switch-'));
  try {
    const result = switchStudioEnv('local', dir);
    assert.deepEqual(result, { ok: true, appEnv: 'local' });
    const pin = path.join(dir, 'config', 'environments', '.active-env');
    assert.equal(fs.readFileSync(pin, 'utf8').trim(), 'local');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('unknown env fails', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-env-switch-'));
  try {
    const result = switchStudioEnv('nope', dir);
    assert.deepEqual(result, { ok: false, error: 'unknown env: nope' });
    assert.equal(fs.existsSync(path.join(dir, 'config', 'environments', '.active-env')), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('production without confirm fails and does not write', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-env-switch-'));
  try {
    const result = switchStudioEnv('production', dir);
    assert.deepEqual(result, { ok: false, error: 'production requires confirm' });
    assert.equal(fs.existsSync(path.join(dir, 'config', 'environments', '.active-env')), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

process.stdout.write('ok\n');
