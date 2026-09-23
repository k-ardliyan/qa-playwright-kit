import assert from 'node:assert/strict';
import { extractTestMetadataFromSpec } from '../test-index';

// Native Playwright annotation form — the form the docs tell SDETs to write.
const annotationSpec = `
test('express probe', { annotation: { type: 'requirement', description: 'REQ-LOGIN' } }, async () => {
  await expect(page).toHaveTitle(/Login/);
});
`;
const a = extractTestMetadataFromSpec(annotationSpec, 'tests/express.spec.ts');
assert.equal(a.length, 1);
assert.equal(a[0].requirementPath, 'REQ-LOGIN');

// setTestMetadata must still win when both are present (explicit beats implicit).
const bothSpec = `
test('both', { annotation: { type: 'requirement', description: 'REQ-ANNOT' } }, async () => {
  setTestMetadata({ reqRef: 'requirements/explicit.md' });
});
`;
const b = extractTestMetadataFromSpec(bothSpec, 'tests/both.spec.ts');
assert.equal(b[0].requirementPath, 'requirements/explicit.md');

// A spec with no requirement linkage at all must not invent one.
const plainSpec = `
test('plain', async () => {
  await expect(page).toHaveTitle(/Home/);
});
`;
const c = extractTestMetadataFromSpec(plainSpec, 'tests/plain.spec.ts');
assert.equal(c[0].requirementPath, undefined);

console.log('test-index-annotation: ok');
