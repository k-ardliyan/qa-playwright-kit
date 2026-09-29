import assert from 'node:assert/strict';
import { buildRequirementMarkdown, SLUG_RE } from '../studio';

const base = {
  slug: 'login',
  title: 'Login page',
  module: 'auth',
  feature: 'login',
  authState: 'unauthenticated',
  halamanAwal: '/login',
  scenarioTitle: 'User opens login',
  steps: 'Buka halaman login',
  expected: 'Halaman login tampil',
};

const md = buildRequirementMarkdown(base);

assert.match(md, /^\| AC-01 \| Halaman login tampil \|$/m);
assert.match(md, /^### SC-01: User opens login \(@success\)$/m);
assert.equal(md.includes('<script'), false);

// Table form is the canonical output shape
assert.equal(
  md,
  `# REQ-XXX: Login page

## Metadata

| Field | Nilai |
| --- | --- |
| Tags | #ui |
| Prioritas | medium |
| Auth state | unauthenticated |
| Halaman awal | /login |
| Module | auth |
| Feature | login |

## Kriteria Penerimaan

| ID | Kriteria |
| --- | --- |
| AC-01 | Halaman login tampil |

## Skenario Uji
### SC-01: User opens login (@success)

| Field | Nilai |
| --- | --- |
| Test ID | TC-01 |
| Covers | AC-01 |
| Langkah | 1. Buka halaman login |
| Hasil yang Diharapkan | Halaman login tampil |
`,
);

// Absent / empty scenarios array → same single SC-01
assert.equal(buildRequirementMarkdown({ ...base, scenarios: [] }), md);

const multi = buildRequirementMarkdown({
  ...base,
  scenarios: [
    { title: 'User opens login', steps: 'Buka halaman login', expected: 'Halaman login tampil' },
    {
      title: 'User submits wrong password',
      steps: 'Isi password salah\nKlik submit',
      expected: 'Pesan error tampil',
    },
  ],
});

assert.match(multi, /^### SC-01: User opens login \(@success\)$/m);
assert.match(multi, /^### SC-02: User submits wrong password \(@success\)$/m);
assert.match(multi, /^\| Test ID \| TC-01 \|$/m);
assert.match(multi, /^\| Test ID \| TC-02 \|$/m);
assert.equal((multi.match(/\| Covers \| AC-01 \|/g) ?? []).length, 2);
// Multi-line steps collapse into one `<br>` separated cell
assert.match(multi, /^\| Langkah \| 1\. Isi password salah<br>2\. Klik submit \|$/m);
assert.equal(multi.includes('SC-03'), false);

assert.equal(SLUG_RE.test('login'), true);
assert.equal(SLUG_RE.test('../etc/passwd'), false);
assert.equal(SLUG_RE.test('Bad_Slug'), false);

console.log('studio-markdown: ok');
