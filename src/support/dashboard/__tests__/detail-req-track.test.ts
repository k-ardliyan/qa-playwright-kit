import assert from 'node:assert/strict';
import { buildDetailPage } from '../build-fragments';

const html = buildDetailPage({
  runId: 'run-req-track',
  scenarios: [
    { title: 'with meta', status: 'passed', reqRef: 'REQ-1', track: 'express' },
    { title: 'plain', status: 'passed' },
    { title: 'strict', status: 'passed', track: 'strict' },
  ],
});

assert.match(html, /<code class="req-ref">REQ-1<\/code>/);
assert.match(html, /<span class="track-chip">express<\/span>/);
assert.equal((html.match(/track-chip">express/g) ?? []).length, 1);
console.log('detail-req-track: ok');
