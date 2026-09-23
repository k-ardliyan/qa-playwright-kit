import assert from 'node:assert/strict';
import { isAllowedSpec } from '../studio-run';

assert.equal(isAllowedSpec('tests/login.spec.ts'), true);
assert.equal(isAllowedSpec('tests/../package.json'), false);
assert.equal(isAllowedSpec('tests/foo.md'), false);
assert.equal(isAllowedSpec('/abs'), false);
assert.equal(isAllowedSpec('tests/a/b.spec.ts'), true);

console.log('studio-run-guard: ok');
