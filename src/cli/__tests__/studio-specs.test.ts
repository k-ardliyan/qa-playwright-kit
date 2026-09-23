import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { listStudioSpecs } from '../studio-specs';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-specs-'));
fs.mkdirSync(path.join(root, 'tests', 'nested'), { recursive: true });
fs.writeFileSync(path.join(root, 'tests', 'a.spec.ts'), '');
fs.writeFileSync(path.join(root, 'tests', 'nested', 'b.spec.ts'), '');
fs.writeFileSync(path.join(root, 'tests', 'auth.setup.ts'), '');
fs.writeFileSync(path.join(root, 'tests', 'nope.md'), '');

assert.deepEqual(listStudioSpecs(root), ['tests/a.spec.ts', 'tests/nested/b.spec.ts']);
assert.deepEqual(listStudioSpecs(path.join(root, 'missing')), []);

console.log('studio-specs: ok');
