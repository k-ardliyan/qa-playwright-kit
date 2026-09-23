import assert from 'node:assert/strict';
import { authArgs, authRefreshState } from '../studio-auth';

const headless = authArgs(false);
const headed = authArgs(true);

assert.ok(headless.includes('tests/auth.setup.ts'));
assert.ok(headless.includes('--project=setup'));
assert.ok(headless.includes('--workers=1'));
assert.equal(headless.includes('--headed'), false);

assert.ok(headed.includes('tests/auth.setup.ts'));
assert.ok(headed.includes('--project=setup'));
assert.ok(headed.includes('--workers=1'));
assert.ok(headed.includes('--headed'));

assert.equal(authRefreshState().running, false);

console.log('studio-auth: ok');
