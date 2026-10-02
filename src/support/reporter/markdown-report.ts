import * as fs from 'node:fs';
import * as path from 'node:path';
import { formatMarkdownInText } from '../../../tools/scripts/format-markdown';
import { resolveWorkspaceReportDir } from '../../shared/workspace-paths';
import { loadLatestTestNotes, mergeTestNotes } from '../../agents/reporter/test-notes';

/**
 * Markdown export of a run — the same content as the portable HTML report, as
 * a `.md` a QA can paste into a ticket, PR, or Confluence page.
 *
 * Output is piped through the repo's own `formatMarkdownInText` so the file
 * satisfies the project's markdown standard by construction (aligned tables,
 * `-` bullets, ATX headings, single trailing newline) instead of re-implementing
 * those rules here and drifting from them.
 */

/**
 * Escape the two characters that would otherwise be parsed as raw HTML when the
 * markdown is rendered. Entity form is valid markdown and displays as the
 * literal character, so a test title like `<script>` stays text everywhere.
 * Applied to prose/table text only — never inside a code fence.
 */
function escapeAngle(value: string): string {
  return value.replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Bounded cell text — a table cell must stay one line to remain a valid row. */
function cell(value: unknown): string {
  const text = value === undefined || value === null ? '' : String(value);
  const flat = text.replace(/\r?\n/g, ' ').replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();
  return flat ? escapeAngle(flat) : '-';
}

/** Multi-line prose stays out of tables so hard breaks are never needed. */
function noteLines(value: unknown): string[] {
  const text = value === undefined || value === null ? '' : String(value).trim();
  if (!text) return [];
  return text.split(/\r?\n/).map((l) => l.trimEnd());
}

function formatDuration(ms: number): string {
  const safe = Number.isFinite(ms) && ms > 0 ? ms : 0;
  return safe < 1000 ? `${Math.round(safe)}ms` : `${(safe / 1000).toFixed(2)}s`;
}

interface MdCase {
  testId?: string;
  scenarioId?: string;
  title?: string;
  role?: string;
  module?: string;
  feature?: string;
  status?: string;
  priority?: string;
  duration?: number;
  failureSource?: string;
  expectedResult?: string;
  actualResult?: string;
  errorMessage?: string;
  qaNotes?: string;
  aiNotes?: string;
  affectedLayer?: string[];
  retry?: number;
  attachments?: Array<{ kind?: string; relativePath?: string; name?: string }>;
}

const STATUS_ICON: Record<string, string> = {
  passed: '✅',
  failed: '❌',
  timedout: '⏱️',
  interrupted: '❌',
  skipped: '⊘',
};

function statusCell(status: string): string {
  const s = (status || '').toLowerCase();
  return `${STATUS_ICON[s] ?? '?'} ${(status || 'unknown').toUpperCase()}`;
}

export function buildMarkdownReport(summary: Record<string, unknown>): string {
  const rawCases = Array.isArray(summary.testCases) ? (summary.testCases as MdCase[]) : [];
  // Notes live in the sidecar, not in the summary — without this overlay the
  // Notes section and the per-failure QA/AI lines would always be empty in a
  // real run. Reading is best-effort: a missing sidecar simply means no notes.
  let cases = rawCases;
  try {
    const sidecar = loadLatestTestNotes();
    if (sidecar) {
      // NoteTarget declares non-optional ids; the export tolerates partial
      // rows, so the cast is on the shape, not on the data.
      cases = mergeTestNotes(rawCases as never, sidecar) as unknown as MdCase[];
    }
  } catch {
    // No sidecar / unreadable — render without notes rather than failing the export.
  }
  const runMeta = (summary.runMeta as Record<string, unknown> | undefined) ?? {};

  // Prefer the summary's own counts: they are the numbers every other surface
  // (dashboard, CSV, Confluence) shows, and a markdown that disagreed with them
  // would be a second, conflicting source of truth.
  const num = (key: string, fallback: number): number =>
    typeof summary[key] === 'number' ? (summary[key] as number) : fallback;
  const passed = num('passed', cases.filter((c) => c.status === 'passed').length);
  const failed = num(
    'failed',
    cases.filter(
      (c) => c.status === 'failed' || c.status === 'timedOut' || c.status === 'interrupted',
    ).length,
  );
  const skipped = num('skipped', cases.filter((c) => c.status === 'skipped').length);
  const total = num('total', cases.length);
  const passRate = num('passRate', total > 0 ? Math.round((passed / total) * 100) : 0);

  const appEnv =
    (typeof runMeta.appEnv === 'string' && runMeta.appEnv) ||
    (typeof summary.appEnv === 'string' && summary.appEnv) ||
    '-';
  const requirementPath =
    (typeof runMeta.requirementPath === 'string' && runMeta.requirementPath) ||
    (typeof summary.requirementPath === 'string' && summary.requirementPath) ||
    '-';
  const ranAt =
    (typeof summary.timestamp === 'string' && summary.timestamp) ||
    (typeof runMeta.generatedAt === 'string' && runMeta.generatedAt) ||
    '-';
  const runId = typeof runMeta.runId === 'string' ? runMeta.runId : '';
  // A local run has no CI run id; the timestamp is the only stable identity, so
  // the title never renders as "QA Report — -".
  const identity = runId || ranAt;
  const totalMs =
    typeof runMeta.totalDurationMs === 'number'
      ? runMeta.totalDurationMs
      : cases.reduce((sum, c) => sum + (c.duration ?? 0), 0);

  const lines: string[] = [];

  lines.push(`# QA Report — ${identity}`);
  lines.push('');
  lines.push(
    `**Result:** ${passRate}% passed · ${passed} passed · ${failed} failed · ${skipped} skipped · ${total} total`,
  );
  lines.push('');

  // Run context as a compact two-column table (pairs, not a list of sentences).
  lines.push('## Run context');
  lines.push('');
  lines.push('| Field | Value |');
  lines.push('| --- | --- |');
  lines.push(`| Environment | ${cell(appEnv)} |`);
  if (runId) lines.push(`| Run ID | ${cell(runId)} |`);
  lines.push(`| Requirement | ${cell(requirementPath)} |`);
  lines.push(`| Generated | ${cell(ranAt)} |`);
  lines.push(`| Total duration | ${cell(formatDuration(totalMs))} |`);
  lines.push('');

  // AI analysis verdict — the gate QA must clear before APPROVE.
  const verdict = typeof summary.analysisVerdict === 'string' ? summary.analysisVerdict : '';
  if (verdict) {
    lines.push('## AI analysis');
    lines.push('');
    // NOT-APPLICABLE means the Analyze sub-phase had nothing to judge — saying
    // "not verified" there would read as a failed gate when nothing failed.
    const isNotApplicable = verdict.toLowerCase() === 'not-applicable';
    const verified = summary.analysisVerified === true;
    const suffix = isNotApplicable ? '' : verified ? ' (verified)' : ' (not verified)';
    lines.push(`**Verdict:** ${verdict.toUpperCase()}${suffix}`);
    const issues = Array.isArray(summary.analysisIssues)
      ? (summary.analysisIssues as unknown[]).filter(
          (i): i is string => typeof i === 'string' && i.trim().length > 0,
        )
      : [];
    for (const issue of issues) lines.push(`- ${escapeAngle(issue)}`);
    lines.push('');
  }

  // AI run insights — cross-scenario findings.
  const insights = Array.isArray(summary.aiInsights)
    ? (summary.aiInsights as unknown[]).filter(
        (i): i is string => typeof i === 'string' && i.trim().length > 0,
      )
    : [];
  if (insights.length > 0) {
    lines.push('## AI run insights');
    lines.push('');
    for (const insight of insights) lines.push(`- ${escapeAngle(insight.trim())}`);
    lines.push('');
  }

  // Results table — one row per test, the export's core payload.
  lines.push('## Results');
  lines.push('');
  lines.push(
    '| Test ID | Role | Module | Feature | Description | Status | Priority | Duration | Source |',
  );
  lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const c of cases) {
    lines.push(
      `| ${cell(c.testId)} | ${cell(c.role)} | ${cell(c.module)} | ${cell(c.feature)} | ${cell(
        c.title,
      )} | ${cell(statusCell(c.status ?? ''))} | ${cell((c.priority ?? '').toUpperCase())} | ${cell(
        formatDuration(c.duration ?? 0),
      )} | ${cell((c.failureSource ?? '').toUpperCase())} |`,
    );
  }
  lines.push('');

  // Failures in depth — the part a QA actually reads. Prose blocks, not table
  // cells, so multi-line errors and notes survive intact.
  const unhealthy = cases.filter(
    (c) => c.status === 'failed' || c.status === 'timedOut' || c.status === 'interrupted',
  );
  if (unhealthy.length > 0) {
    lines.push('## Failures');
    lines.push('');

    // Rollup first: a reviewer needs the shape of the failure set (which
    // decision each class implies) before reading cases one by one.
    const bySource = new Map<string, number>();
    for (const c of unhealthy) {
      const key = (c.failureSource || 'unknown').toLowerCase();
      bySource.set(key, (bySource.get(key) ?? 0) + 1);
    }
    if (bySource.size > 1) {
      const order = ['app', 'test', 'requirement', 'env', 'ai_generation', 'unknown'];
      const ranked = [...bySource.entries()].sort(
        (a, b) => (order.indexOf(a[0]) + 1 || 99) - (order.indexOf(b[0]) + 1 || 99),
      );
      lines.push(`**By source:** ${ranked.map(([src, n]) => `${src} ×${n}`).join(' · ')}`);
      lines.push('');
    }

    for (const c of unhealthy) {
      lines.push(
        `### ${escapeAngle(c.testId || 'unknown')} — ${escapeAngle(c.title || 'untitled')}`,
      );
      lines.push('');
      lines.push(
        `- **Status:** ${statusCell(c.status ?? '')}${c.retry ? ` · retry ×${c.retry}` : ''}`,
      );
      if (c.failureSource) lines.push(`- **Failure source:** ${cell(c.failureSource)}`);
      if (c.affectedLayer?.length) {
        lines.push(`- **Affected layer:** ${cell(c.affectedLayer.join(', '))}`);
      }
      // Evidence links are the difference between "a test failed" and "here is
      // why" — the trace replays the failure, the screenshot shows the state.
      const shots = (c.attachments ?? []).filter((a) => a.kind === 'screenshot' && a.relativePath);
      const traces = (c.attachments ?? []).filter((a) => a.kind === 'trace' && a.relativePath);
      if (shots.length || traces.length) {
        const parts: string[] = [];
        if (traces.length) {
          parts.push(traces.map((t) => `[trace](${t.relativePath})`).join(' '));
        }
        if (shots.length) {
          parts.push(shots.map((s) => `[screenshot](${s.relativePath})`).join(' '));
        }
        lines.push(`- **Evidence:** ${parts.join(' · ')}`);
      }
      lines.push('');
      if (c.expectedResult) {
        lines.push(`**Expected:** ${escapeAngle(c.expectedResult)}`);
        lines.push('');
      }
      if (c.actualResult) {
        lines.push(`**Actual:** ${escapeAngle(c.actualResult)}`);
        lines.push('');
      }
      if (c.errorMessage) {
        lines.push('**Error:**');
        lines.push('');
        lines.push('```text');
        for (const l of c.errorMessage.split(/\r?\n/).slice(0, 30)) lines.push(l);
        lines.push('```');
        lines.push('');
      }
      for (const note of noteLines(c.qaNotes)) {
        lines.push(`> **QA note:** ${escapeAngle(note)}`);
      }
      for (const note of noteLines(c.aiNotes)) {
        lines.push(`> **AI note:** ${escapeAngle(note)}`);
      }
      lines.push('');
    }
  }

  // QA notes on passing tests still carry insight worth keeping.
  const noted = cases.filter(
    (c) =>
      !unhealthy.includes(c) &&
      ((c.qaNotes && c.qaNotes.trim()) || (c.aiNotes && c.aiNotes.trim())),
  );
  if (noted.length > 0) {
    lines.push('## Notes');
    lines.push('');
    for (const c of noted) {
      lines.push(
        `- **${escapeAngle(c.testId || 'unknown')}** — ${escapeAngle(c.title || 'untitled')}`,
      );
      for (const note of noteLines(c.qaNotes)) lines.push(`  - QA: ${escapeAngle(note)}`);
      for (const note of noteLines(c.aiNotes)) lines.push(`  - AI: ${escapeAngle(note)}`);
    }
    lines.push('');
  }

  lines.push('---');
  lines.push('');
  lines.push(`_Generated from ${identity} by QA Playwright Kit._`);

  // The repo formatter owns the final shape: aligned tables, blank-line
  // discipline, canonical bullets, single trailing newline.
  return formatMarkdownInText(lines.join('\n'));
}

export function writeMarkdownReport(summaryPath?: string): string {
  const reportDir = resolveWorkspaceReportDir();
  const src = summaryPath ?? path.join(reportDir, 'test-summary.json');
  const summary = JSON.parse(fs.readFileSync(src, 'utf-8')) as Record<string, unknown>;
  const markdown = buildMarkdownReport(summary);
  const out = path.join(reportDir, 'qa-report.md');
  fs.writeFileSync(out, markdown, 'utf-8');
  return out;
}
