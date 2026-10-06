/// <reference types="node" />
/**
 * Conflict-marker gate — refuses to let unresolved merge markers be committed.
 *
 * The upgrade engine leaves conflicted files with markers and unstaged BY
 * DESIGN (QA/agent resolves them), but nothing stopped a resolved-in-hurry
 * `git add` from committing `<<<<<<<` into history — and nothing in CI caught
 * it either. This gate closes that hole at two entry points:
 *
 *   - `.husky/pre-commit` runs `--staged`: only the staged content is scanned,
 *     so files the upgrade engine legitimately left conflicted-and-unstaged
 *     mid-run do NOT trip the hook.
 *   - CI / `npm run validate:conflict-markers` scans every tracked file.
 *
 * Detection is line-anchored to avoid false positives:
 *   - `^<<<<<<<` / `^>>>>>>>` are unambiguous conflict sides.
 *   - `^=======` alone is NOT enough — 7+ equals is also a valid Markdown
 *     setext underline — so it only counts when a `<<<<<<<` appears within
 *     ±10 lines (real conflict hunks always have all three together).
 *
 * Fail direction: this gate FAILS CLOSED (exit 1 on a finding) — a committed
 * marker is exactly the "silent broken state" the hardening exists to prevent.
 *
 * @module validators/check-conflict-markers
 */

import { spawnSync } from 'node:child_process';

const MARKER_LEFT = /^<{7}/;
const MARKER_RIGHT = /^>{7}/;
const MARKER_EQ = /^={7}\s*$/;
/** Distance (lines) between `<<<<<<<` and a suspicious `=======` line. */
const PROXIMITY = 10;

interface Finding {
  file: string;
  line: number;
  kind: 'left' | 'right' | 'eq';
  snippet: string;
}

function git(args: string[]): { status: number; stdout: string; stderr: string } {
  const res = spawnSync('git', args, { encoding: 'utf-8', timeout: 60_000 });
  return { status: res.status ?? 1, stdout: res.stdout ?? '', stderr: res.stderr ?? '' };
}

function scanContent(file: string, content: string): Finding[] {
  const lines = content.split('\n');
  const findings: Finding[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (MARKER_LEFT.test(line)) {
      findings.push({ file, line: i + 1, kind: 'left', snippet: line.trim() });
    } else if (MARKER_RIGHT.test(line)) {
      findings.push({ file, line: i + 1, kind: 'right', snippet: line.trim() });
    } else if (MARKER_EQ.test(line)) {
      // Only suspicious when a conflict start sits within ±PROXIMITY lines.
      const nearLeft = lines
        .slice(Math.max(0, i - PROXIMITY), Math.min(lines.length, i + PROXIMITY))
        .some((l) => MARKER_LEFT.test(l));
      if (nearLeft) {
        findings.push({ file, line: i + 1, kind: 'eq', snippet: line.trim() });
      }
    }
  }
  return findings;
}

function listFiles(stagedOnly: boolean): string[] {
  if (stagedOnly) {
    const staged = git(['diff', '--cached', '--name-only', '-z']);
    return staged.stdout.split('\0').filter((f) => f.length > 0);
  }
  const tracked = git(['ls-files', '-z']);
  return tracked.stdout.split('\0').filter((f) => f.length > 0);
}

function isBinary(content: string): boolean {
  return content.includes('\u0000');
}

export function checkConflictMarkers(stagedOnly: boolean): {
  findings: Finding[];
  scanned: number;
} {
  const files = listFiles(stagedOnly);
  const findings: Finding[] = [];
  let scanned = 0;
  for (const file of files) {
    // Scan INDEX content (`git show :file`): for --staged this is exactly what
    // would be committed; for the repo-wide scan a clean checkout's index
    // equals HEAD, and files staged-but-not-committed are still covered.
    const res = git(['show', `:${file}`]);
    if (res.status !== 0 || isBinary(res.stdout)) continue;
    scanned += 1;
    findings.push(...scanContent(file, res.stdout));
  }
  return { findings, scanned };
}

function main(): void {
  const stagedOnly = process.argv.slice(2).includes('--staged');
  const { findings, scanned } = checkConflictMarkers(stagedOnly);

  if (findings.length > 0) {
    process.stdout.write(
      [
        `❌ Unresolved merge markers detected (${findings.length} line(s) in ${new Set(findings.map((f) => f.file)).size} file(s)):`,
        ...findings.slice(0, 30).map((f) => `  • [${f.file}:${f.line}] ${f.snippet}`),
        findings.length > 30 ? `  … dan ${findings.length - 30} lainnya` : '',
        '',
        'Selesaikan konfliknya (cari `<<<<<<<`) lalu `git add <file>` ulang.',
        stagedOnly ? '(mode: staged)' : '(mode: seluruh file tracked)',
      ]
        .filter(Boolean)
        .join('\n') + '\n',
    );
    process.exit(1);
  }

  process.stdout.write(
    `✅ No conflict markers found (scanned ${scanned} text file(s)${stagedOnly ? ', staged mode' : ''}).\n`,
  );
  process.exit(0);
}

if (require.main === module) {
  main();
}
