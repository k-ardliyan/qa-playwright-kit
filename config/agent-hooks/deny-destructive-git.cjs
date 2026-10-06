#!/usr/bin/env node
/**
 * deny-destructive-git.cjs — PreToolUse hook script for agent clients
 * (Claude Code / ZCode / anything speaking the hook stdin-JSON protocol).
 *
 * Denies the git commands that can destroy uncommitted QA work without any
 * git hook of their own (reset/clean/checkout have no pre- hooks to hook into):
 *
 *   git reset --hard          git clean -f[d]        git checkout -- <paths>
 *   git restore --worktree    git stash clear/drop   git commit/push --no-verify
 *
 * Fail direction: BLOCKS the listed commands, allows everything else, and
 * FAILS OPEN (allow + stderr note) on its own errors — same philosophy as the
 * upgrade commit-guard: this defends against accidents, not adversaries.
 *
 * Install: see config/agent-hooks/README.md.
 */

'use strict';

const DENY_PATTERNS = [
  [
    /git\s+reset\s+--hard/i,
    'git reset --hard membuang seluruh perubahan uncommitted — kalau perlu membatalkan merge/staging, pakai `git restore --staged --worktree .` (hasil upgrade) atau commit dulu.',
  ],
  [
    /git\s+clean\s+[^|;&]*-[a-zA-Z]*f/i,
    'git clean -f menghapus file untracked permanen — requirement/spec/test yang belum di-commit tidak bisa dipulihkan.',
  ],
  [
    /git\s+checkout\s+(--\s+\.|--\s+[^|;&]*|(?:"|\x27)?\.)/i,
    'git checkout -- <path> membuang perubahan lokal pada file itu tanpa konfirmasi.',
  ],
  [
    /git\s+restore\s+[^|;&]*--worktree/i,
    'git restore --worktree membuang perubahan lokal pada file itu tanpa konfirmasi.',
  ],
  [
    /git\s+stash\s+(clear|drop)/i,
    'git stash clear/drop menghapus checkpoint stash — jangan dipakai pada repo kerja QA.',
  ],
  [
    /--no-verify/i,
    'Hook pre-commit ada karena alasannya (commit-guard, marker gate, lint) — jangan pernah dilewati.',
  ],
];

function readStdinJson() {
  try {
    const raw = require('fs').readFileSync(0, 'utf-8');
    return raw.trim().length > 0 ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function denyReason(command) {
  for (const [pattern, reason] of DENY_PATTERNS) {
    if (pattern.test(command)) return reason;
  }
  return null;
}

const input = readStdinJson();
const command = (input.tool_input && (input.tool_input.command || input.tool_input.cmd)) || '';

const reason = denyReason(String(command));
if (reason) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: `[agent-git-safety] DITOLAK: ${reason}`,
      },
    }),
  );
  process.exit(0);
}
process.exit(0);
