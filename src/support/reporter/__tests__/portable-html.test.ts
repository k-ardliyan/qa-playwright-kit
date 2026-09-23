import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { buildPortableHtml, inlineScreenshot } from '../portable-html';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'portable-'));
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
fs.writeFileSync(path.join(dir, 'shot.png'), png);
fs.writeFileSync(path.join(dir, 'note.txt'), 'secret');

const data = inlineScreenshot(dir, 'shot.png');
assert.ok(data?.startsWith('data:image/png;base64,'));
assert.equal(inlineScreenshot(dir, '../package.json'), null);
assert.equal(inlineScreenshot(dir, 'note.txt'), null);
assert.equal(inlineScreenshot(dir, 'missing.png'), null);

const html = buildPortableHtml(
  {
    appEnv: 'staging',
    timestamp: '2026-09-22T10:00:00.000Z',
    aiInsights: ['Tombol diskon <b>hilang</b> di mobile', '  ', 42],
    runMeta: { requirementPath: 'requirements/checkout.md', totalDurationMs: 4321 },
    testCases: [
      {
        title: 'Checkout <script>',
        status: 'failed',
        role: 'finance',
        expectedResult: 'diskon tampil',
        errorMessage: 'tombol hilang',
        duration: 1200,
        attachments: [
          { kind: 'screenshot', relativePath: 'shot.png' },
          { kind: 'trace', relativePath: 'trace.zip' },
        ],
      },
      { title: 'Login', status: 'passed', role: 'admin', expectedResult: 'masuk' },
      {
        title: 'Bayar',
        status: 'passed',
        role: 'finance',
        expectedResult: 'lunas',
        reqRef: 'REQ-1',
        track: 'express',
      },
      { title: 'Lewat', status: 'skipped', role: 'admin' },
    ],
  },
  dir,
);
assert.match(html, /50%<\/strong> lulus/);
assert.match(html, /2<\/strong> lulus/);
assert.match(html, /1<\/strong> gagal/);
assert.match(html, /1<\/strong> dilewati/);
assert.match(html, /4<\/strong> total/);
assert.match(html, /Environment: staging/);
assert.match(html, /Requirement: requirements\/checkout\.md/);
assert.match(html, /Durasi: 4\.3s/);
assert.match(html, /Tombol diskon &lt;b&gt;hilang&lt;\/b&gt; di mobile/);
assert.doesNotMatch(html, /<li>42<\/li>/);
assert.match(html, /<a href="trace\.zip">trace<\/a>/);
assert.match(html, /1200ms/);
assert.match(html, /Checkout &lt;script&gt;/);
assert.doesNotMatch(html, /<script>alert/);
assert.match(html, /id="eng"/);
assert.match(html, /<pre class="eng">tombol hilang<\/pre>/);
assert.match(html, /data:image\/png;base64,/);
assert.equal((html.match(/<tbody>[\s\S]*<\/tbody>/)?.[0].match(/<tr>/g) ?? []).length, 4);
assert.equal((html.match(/<code>REQ-1<\/code>/g) ?? []).length, 1);
assert.equal((html.match(/express/g) ?? []).length, 1);

fs.rmSync(dir, { recursive: true, force: true });
console.log('portable-html: ok');
