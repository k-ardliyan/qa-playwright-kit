#!/usr/bin/env node
/**
 * check-inline-js.mjs — verify all inline <script> blocks parse without errors.
 *
 * Pitfall #71a: TS template literals DO interpret \\n escapes at runtime.
 * A TS body like `if (confirm('Delete?\\n\\nCannot undo'))` evaluates to a JS
 * string with REAL newlines inside single-quotes, which is a SyntaxError.
 * The entire inline <script> block fails to parse, killing every handler
 * (clipboard, save, delete, copy-CLI, step filter, etc.).
 *
 * This script extracts every inline <script> from a rendered dashboard HTML
 * and runs `new vm.Script(body)` on it (same V8 the browser uses).
 *
 * Usage:
 *   node scripts/check-inline-js.mjs                    # default artifacts/reports/custom-dashboard.html
 *   node scripts/check-inline-js.mjs artifacts/reports/preview/heavy-local.html
 *
 * Exit code:
 *   0 — all script blocks parse cleanly
 *   1 — at least one script block has a SyntaxError
 */
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const target = process.argv[2] || 'artifacts/reports/custom-dashboard.html';

let html;
try {
  html = readFileSync(target, 'utf-8');
} catch (e) {
  console.error(`✗ Cannot read ${target}: ${e.message}`);
  process.exit(1);
}

// Extract every <script> block WITHOUT a src attribute (inline only).
const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(
  (m) => m[1],
);

if (scripts.length === 0) {
  console.error(`✗ No inline <script> blocks found in ${target}`);
  process.exit(1);
}

console.log(`Checking ${scripts.length} inline <script> block(s) in ${target}…`);

let failed = 0;
for (let i = 0; i < scripts.length; i++) {
  try {
    new vm.Script(scripts[i], { filename: `inline-${i}.js` });
    console.log(`  ✓ block ${i}`);
  } catch (e) {
    failed++;
    const lineMatch = e.stack?.match(/inline-\d+\.js:(\d+)/);
    const line = lineMatch ? lineMatch[1] : '?';
    const body = scripts[i];
    const lineText = body.split('\n')[parseInt(line, 10) - 1] ?? '<unknown>';
    console.error(`  ✗ block ${i} (line ${line}): ${e.message}`);
    console.error(`    ${lineText.trim().slice(0, 120)}`);
  }
}

if (failed > 0) {
  console.error(`\n✗ ${failed} of ${scripts.length} inline script block(s) failed to parse.`);
  console.error(
    '  Common cause: TS template literal emits a real \\n inside a single-quoted JS string.',
  );
  console.error(
    '  Fix: use \\`backtick\\` JS literals, flatten newlines to " · ", or use String.fromCharCode.',
  );
  process.exit(1);
}

console.log(`\n✓ All ${scripts.length} inline script blocks parse cleanly.`);
