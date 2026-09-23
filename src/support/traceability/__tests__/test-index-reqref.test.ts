import assert from 'node:assert/strict';
import { extractTestMetadataFromSpec } from '../test-index';

const reqRefSpec = `test('x', async () => { setTestMetadata({ reqRef: 'requirements/login.md', testId: 'TC-01' }); });`;
const reqRefEntries = extractTestMetadataFromSpec(reqRefSpec, 'tests/x.spec.ts');
assert.equal(reqRefEntries[0].requirementPath, 'requirements/login.md');
assert.equal(reqRefEntries[0].testId, 'TC-01');

const infoSpec = `test('y', async () => { setTestMetadata(test.info(), { requirementPath: 'requirements/a.md' }); });`;
const infoEntries = extractTestMetadataFromSpec(infoSpec, 'tests/y.spec.ts');
assert.equal(infoEntries[0].requirementPath, 'requirements/a.md');
