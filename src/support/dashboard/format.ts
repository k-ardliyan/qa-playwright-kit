/**
 * Shared formatting + serialization helpers for the dashboard HTML builders.
 *
 * Split from shared.ts (formatting seam); the document shell and inline client
 * scripts remain there. Import from shared.ts if you already depend on it — it
 * re-exports everything here.
 *
 * @module support/dashboard/format
 */

import type { TestSummary } from './report-model';

export function escapeHtml(raw: string): string {
  return String(raw ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Human duration for every dashboard surface.
 *
 * Sub-second stays in `ms` (the useful unit at that scale, and what Playwright
 * shows for a step); one second and above reads in seconds so a QA scanning a
 * column never has to divide 41230 by 1000 in their head. Two decimals keep
 * the precision the old raw-ms values carried without the four-digit noise.
 */
export function formatDuration(ms: number): string {
  const safe = Number.isFinite(ms) && ms > 0 ? ms : 0;
  if (safe < 1000) return `${Math.round(safe)}ms`;
  return `${(safe / 1000).toFixed(2)}s`;
}

/**
 * Serialize a value for embedding inside an inline <script> block safely.
 * JSON.stringify does NOT escape '<', so a string containing '</script>' would
 * terminate the script tag and allow HTML/JS injection. Replacing '<' (and
 * '>'/'&' for symmetry) with unicode escapes makes the payload inert while
 * JSON.parse still round-trips it correctly.
 */
export function jsonForScript(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026');
}

/**
 * Single source of truth for the run verdict. Previously duplicated in
 * Hero.tsx and this file, which risked the two drifting apart.
 *
 * Precedence: a failure outranks everything; unfinished coverage outranks a
 * manual skip (it is actionable work); a manual skip means reduced coverage
 * but a complete run.
 */
export function getVerdict(summary?: TestSummary): {
  label: string;
  tone: 'healthy' | 'warning' | 'critical';
  summaryLine: string;
} {
  const failed = summary?.failed ?? 0;
  const skipped = summary?.skipped ?? 0;
  const notImplemented = summary?.notImplemented ?? 0;
  const total = summary?.total ?? 0;

  if (failed > 0) {
    return {
      label: 'Run failed',
      tone: 'critical',
      summaryLine: `${failed} unhealthy test${failed === 1 ? '' : 's'} need${failed === 1 ? 's' : ''} triage.`,
    };
  }

  if (notImplemented > 0) {
    return {
      label: 'Run incomplete',
      tone: 'warning',
      summaryLine: `${notImplemented} skenario direncanakan tapi belum dibangun — utang kerja, bukan skip.`,
    };
  }

  if (skipped > 0) {
    return {
      label: 'Run degraded',
      tone: 'warning',
      summaryLine: `${skipped} skipped test${skipped === 1 ? '' : 's'} reduced coverage.`,
    };
  }

  return {
    label: 'Run healthy',
    tone: 'healthy',
    summaryLine: total > 0 ? 'All executed tests passed.' : 'No tests were captured in this run.',
  };
}
