/**
 * Standalone Node assert harness (not a Playwright test).
 * network-assert-core (demo fixtures only — not product schema).
 * Run: npx tsx src/support/pw/__tests__/network-assert-core.test.ts
 */
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  assertNetworkContractHit,
  hasRequiredKeys,
  loadNetworkContract,
  matchNetworkHit,
  objectContainsMatch,
  redactBody,
  redactHeaders,
  redactHit,
  resolveNetworkContractPath,
  type NetworkHit,
} from '../network-assert-core';

function test(name: string, fn: () => void | Promise<void>): void {
  const run = async () => {
    try {
      await fn();
      process.stdout.write(`  ✓ ${name}\n`);
    } catch (err) {
      process.stdout.write(`  ✗ ${name}\n`);
      throw err;
    }
  };
  const g = globalThis as unknown as { __networkAssertTests?: Array<() => Promise<void>> };
  g.__networkAssertTests ??= [];
  g.__networkAssertTests.push(run);
}

process.stdout.write('\nnetwork-assert-core tests\n');

const sampleHit = (): NetworkHit => ({
  method: 'POST',
  url: 'https://pw-power.local/api/demo/submit',
  status: 201,
  requestHeaders: { authorization: 'Bearer secret-token', 'content-type': 'application/json' },
  responseHeaders: { 'set-cookie': 'sid=abc', 'content-type': 'application/json' },
  requestBody: { name: 'QA-KIT-NETWORK-OK', qty: 2 },
  responseBody: { ok: true, id: 'demo-1', token: 'SECRET' },
});

test('redactHeaders redacts authorization and cookie', () => {
  const h = redactHeaders({
    authorization: 'Bearer x',
    cookie: 'a=b',
    'content-type': 'application/json',
  });
  assert.equal(h?.authorization, '[REDACTED]');
  assert.equal(h?.cookie, '[REDACTED]');
  assert.equal(h?.['content-type'], 'application/json');
});

test('redactBody redacts token leaf and nested path', () => {
  const body = redactBody({ token: 'x', data: { secret: 'y', keep: 1 } }, [
    'token',
    'secret',
    'data.secret',
  ]) as Record<string, unknown>;
  assert.equal(body.token, '[REDACTED]');
  assert.equal((body.data as Record<string, unknown>).secret, '[REDACTED]');
  assert.equal((body.data as Record<string, unknown>).keep, 1);
});

test('redactHit applies defaults', () => {
  const r = redactHit(sampleHit());
  assert.equal(r.requestHeaders?.authorization, '[REDACTED]');
  assert.equal(r.responseHeaders?.['set-cookie'], '[REDACTED]');
  assert.equal((r.responseBody as Record<string, unknown>).token, '[REDACTED]');
  assert.equal((r.responseBody as Record<string, unknown>).ok, true);
});

test('hasRequiredKeys reports missing', () => {
  assert.deepEqual(hasRequiredKeys({ a: 1 }, ['a', 'b']), ['b']);
  assert.deepEqual(hasRequiredKeys({ a: 1, b: 2 }, ['a', 'b']), []);
});

test('objectContainsMatch partial nested', () => {
  const ok = objectContainsMatch({ a: 1, b: { c: 2, d: 3 } }, { b: { c: 2 } });
  assert.equal(ok.ok, true);
  const bad = objectContainsMatch({ a: 1 }, { b: 2 });
  assert.equal(bad.ok, false);
});

test('matchNetworkHit happy path', () => {
  const result = matchNetworkHit(sampleHit(), {
    method: 'POST',
    urlIncludes: '/api/demo/submit',
    status: [200, 201],
    request: { requiredKeys: ['name', 'qty'], matchObject: { name: 'QA-KIT-NETWORK-OK' } },
    response: { requiredKeys: ['ok', 'id'], matchObject: { ok: true } },
  });
  assert.equal(result.ok, true, result.errors.join('; '));
});

test('matchNetworkHit fails wrong status', () => {
  const result = matchNetworkHit(sampleHit(), { status: 200, urlIncludes: '/api/demo' });
  assert.equal(result.ok, false);
  assert.match(result.errors.join(' '), /status/);
});

test('matchNetworkHit fails missing required key', () => {
  const result = matchNetworkHit(sampleHit(), {
    urlIncludes: '/api/demo',
    request: { requiredKeys: ['name', 'missingField'] },
  });
  assert.equal(result.ok, false);
  assert.match(result.errors.join(' '), /missingField/);
});

test('matchNetworkHit forbidKeys', () => {
  const hit = sampleHit();
  hit.requestBody = { name: 'x', password: 'nope' };
  const result = matchNetworkHit(hit, {
    urlIncludes: '/api/demo',
    request: { forbidKeys: ['password'] },
  });
  assert.equal(result.ok, false);
  assert.match(result.errors.join(' '), /password/);
});

test('resolve + load demo contract fixture', () => {
  const p = resolveNetworkContractPath('tests/data/network/contracts/demo/submit-success.json');
  assert.ok(fs.existsSync(p), `missing ${p}`);
  const c = loadNetworkContract('tests/data/network/contracts/demo/submit-success.json');
  assert.equal(c.id, 'demo.submit.success');
});

test('rejects absolute and traversal contract paths', () => {
  assert.throws(() => resolveNetworkContractPath(path.resolve('secret.json')), /must be relative/);
  assert.throws(() => resolveNetworkContractPath('../secret.json'), /stay inside/);
});

test('assertNetworkContractHit passes demo fixture', () => {
  assertNetworkContractHit(sampleHit(), 'tests/data/network/contracts/demo/submit-success.json');
});

test('assertNetworkContractHit fails when name wrong', () => {
  const hit = sampleHit();
  hit.requestBody = { name: 'WRONG', qty: 1 };
  assert.throws(
    () => assertNetworkContractHit(hit, 'tests/data/network/contracts/demo/submit-success.json'),
    /Network contract failed/,
  );
});

(async () => {
  const g = globalThis as unknown as { __networkAssertTests?: Array<() => Promise<void>> };
  const tests = g.__networkAssertTests ?? [];
  for (const t of tests) {
    await t();
  }
  process.stdout.write('network-assert-core: all passed\n');
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
