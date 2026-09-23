import assert from 'node:assert/strict';
import { claimStudioChild, releaseStudioChild, studioChildRunning } from '../spawn-playwright';
import type { ChildProcess } from 'node:child_process';

// A stand-in for a spawned Playwright child — the slot only tracks identity.
const fakeA = { pid: 111 } as unknown as ChildProcess;
const fakeB = { pid: 222 } as unknown as ChildProcess;

assert.equal(studioChildRunning(), false, 'slot starts empty');

assert.equal(claimStudioChild(fakeA), true, 'first child claims the slot');
assert.equal(studioChildRunning(), true);
assert.equal(claimStudioChild(fakeB), false, 'second child is refused while the first holds it');

// Releasing a child that does not own the slot must not free it.
releaseStudioChild(fakeB);
assert.equal(studioChildRunning(), true, 'foreign release is ignored');

releaseStudioChild(fakeA);
assert.equal(studioChildRunning(), false, 'owner release frees the slot');
assert.equal(claimStudioChild(fakeB), true, 'slot is reusable after release');
releaseStudioChild(fakeB);

console.log('studio-child-slot: ok');
