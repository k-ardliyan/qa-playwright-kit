/**
 * Deterministic AI notes — auto-generated per-test and per-run insight
 * composed from signals the reporter already collected (status, retries,
 * failure source, errors, steps, fingerprints). Language: Indonesian,
 * matching REPORT-GUIDE.
 *
 * Two layers:
 *   1. Per-test notes (AI NOTES column) — baked into `testCases[].aiNotes`.
 *   2. Cross-scenario run insights — baked into `TestSummary.aiInsights` and
 *      surfaced in the dashboard overview panel.
 *
 * Every deterministic insight carries a `Jenis:` tag from the canonical
 * taxonomy (see skills/qa-playwright-kit/references/ai-insight-format.md);
 * richer narrative insights come from the agents via `record_ai_note`.
 *
 * @module src/agents/reporter/ai-notes
 */

import { explainFailure } from '../../support/custom-dashboard/failure-source';
import { generateErrorFingerprint } from '../../support/classifier/fingerprint';
import type { CollectedStep, CollectedTestData } from '../../support/custom-dashboard/types';

/** Failure-source → suspected cause + next action, Indonesian. */
const FAILURE_SOURCE_HINTS: Record<string, string> = {
  app: 'bug aplikasi — siapkan defect ticket',
  test: 'kode test (selector/assertion) — perbaiki test lalu rerun',
  requirement: 'kecocokan requirement — revisi requirement lalu regenerate',
  env: 'auth/environment/seed — perbaiki environment lalu rerun',
  ai_generation: 'hasil generate AI — perbaiki generator/input lalu rerun',
  unknown: 'belum terklasifikasi — cek trace/screenshot',
};

/** Canonical insight kinds (Jenis) used by deterministic and agent notes. */
export const AI_INSIGHT_KINDS = [
  'ui-ux',
  'flow',
  'data',
  'stability',
  'security',
  'test-quality',
  'root-cause',
  'coverage',
  'trend',
] as const;
export type AiInsightKind = (typeof AI_INSIGHT_KINDS)[number];

function findLastFailedStep(steps: CollectedStep[]): string | undefined {
  let found: string | undefined;
  const walk = (list: CollectedStep[]): void => {
    for (const step of list) {
      if (step.status === 'failed' && step.title) found = step.title;
      if (step.steps?.length) walk(step.steps);
    }
  };
  walk(steps);
  return found;
}

function hasExpectStep(steps: CollectedStep[]): boolean {
  for (const step of steps) {
    if (step.title && /expect/i.test(step.title)) return true;
    if (step.steps?.length && hasExpectStep(step.steps)) return true;
  }
  return false;
}

function formatSeconds(ms: number): string {
  return `${(ms / 1000).toFixed(2)}s`;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

function capNames(names: string[], max = 4): string {
  return names.slice(0, max).join(', ') + (names.length > max ? `, +${names.length - max}` : '');
}

/** Run-level context for relative (non-hardcoded) per-test signals. */
export interface AiNoteContext {
  /** Median duration of passed tests in the run — set when ≥5 passed tests. */
  medianPassedMs?: number;
}

/**
 * Build the deterministic AI note for one collected test. Returns '' when
 * there is nothing worth saying — anti-noise. Passed scenarios are NOT silent
 * by design: metadata gaps, weak assertions, and run-relative slow durations
 * surface here, while richer UI/UX suggestions and flow comparisons come from
 * the agents via `record_ai_note`.
 */
export function buildAutoAiNote(test: CollectedTestData, context?: AiNoteContext): string {
  const lines: string[] = [];
  const unhealthy = test.status !== 'passed' && test.status !== 'skipped';

  if (test.status === 'not-generated') {
    return 'Jenis: Coverage — Test belum digenerate — jalankan fase Generate untuk scenario ini.';
  }

  if (unhealthy) {
    const explained = explainFailure(test.errorMessage);
    const first = explained
      ? `Jenis: Root Cause — Analisa: ${explained}.`
      : 'Jenis: Root Cause — Gagal tanpa pola dikenal — cek trace/screenshot.';
    lines.push(first);
    if (test.errorMessage) {
      const fingerprint = generateErrorFingerprint(test.errorMessage);
      const evidence = [`fingerprint ${fingerprint.fingerprintId}`];
      if (test.hasTrace) evidence.push('trace tersedia');
      else if (test.attachments.some((a) => a.kind === 'screenshot'))
        evidence.push('screenshot tersedia');
      lines.push(`Bukti: ${evidence.join(' · ')}.`);
    }
    if (explained && test.failureSource) {
      lines.push(
        `Diduga penyebab: ${FAILURE_SOURCE_HINTS[test.failureSource] ?? FAILURE_SOURCE_HINTS.unknown!}.`,
      );
    }
    const failedStep = findLastFailedStep(test.steps);
    if (failedStep) lines.push(`Berhenti di langkah "${failedStep}".`);
    if ((test.retry ?? 0) > 0) {
      lines.push(
        `Gagal konsisten di ${test.attempts ?? (test.retry ?? 0) + 1} attempt — bukan flake, cek root cause.`,
      );
    }
  } else if (test.status === 'passed') {
    if ((test.retry ?? 0) > 0) {
      lines.push(
        `Jenis: Stability — Flaky: lulus setelah retry ×${test.retry} — stabilkan timing/selector atau seed data.`,
      );
    }
    if (!hasExpectStep(test.steps)) {
      lines.push(
        'Jenis: Test Quality — Tidak terdeteksi assertion (expect) pada langkah yang dikumpulkan — assertion dari helper bisa tidak terlihat; validasi manual bila perlu.',
      );
    }
    if (test.metadataIncomplete) {
      lines.push(
        'Jenis: Test Quality — Actual result belum diisi generator — lengkapi annotation captureActualResult agar report makin informatif.',
      );
    }
    const medianMs = context?.medianPassedMs;
    if (medianMs && test.duration > medianMs * 3) {
      lines.push(
        `Jenis: Stability — Durasi ${formatSeconds(test.duration)} — di atas median scenario passed (${formatSeconds(medianMs)}): cek wait/poll berlebih atau data setup lambat.`,
      );
    }
  } else if (test.status === 'skipped') {
    lines.push('Jenis: Coverage — Scenario dilewati (skip) — pastikan bukan blocker environment.');
  }

  return lines.join('\n');
}

/**
 * Bake deterministic AI notes into every collected test, enriching per-test
 * signals with run-relative context (median of passed durations, computed
 * only when enough samples exist to be meaningful).
 */
export function bakeAutoAiNotes(tests: CollectedTestData[]): void {
  const passed = tests.filter((t) => t.status === 'passed');
  const medianPassedMs =
    passed.length >= 5 ? median(passed.map((t) => t.duration || 0)) : undefined;
  for (const t of tests) {
    t.aiNotes = buildAutoAiNote(t, { medianPassedMs });
  }
}

/** Cross-run history context for trend insights (from the latest archive). */
export interface RunHistoryContext {
  /** Previous run pass rate (0-100) when a comparable archive exists. */
  previousPassRate?: number;
  /** `scenarioId||testId :: role` → status map from the previous run. */
  previousStatusByKey?: Record<string, string>;
}

/** History key matching the per-test note identity. */
export function historyKey(scenarioId?: string, testId?: string, role?: string): string {
  const id = (scenarioId || '').trim() || (testId || '').trim() || '';
  const r = (role || '').trim().toLowerCase();
  return `${id}::${r || 'general'}`;
}

/**
 * Cross-scenario run insights — patterns across the whole run plus, when a
 * previous archive is provided, trend signals vs that run: regressions,
 * persistent failures, pass-rate delta. Returns compact Indonesian lines
 * (each prefixed with its Jenis tag); empty when the run is too small or
 * clean to say anything meaningful.
 */
export function buildRunInsights(
  tests: CollectedTestData[],
  history?: RunHistoryContext,
): string[] {
  const insights: string[] = [];
  const unhealthy = tests.filter(
    (t) => t.status !== 'passed' && t.status !== 'skipped' && t.status !== 'not-generated',
  );
  const passed = tests.filter((t) => t.status === 'passed');
  const skipped = tests.filter((t) => t.status === 'skipped');

  // 1. Cross-run trend: regressions and persistent failures
  if (history?.previousStatusByKey && Object.keys(history.previousStatusByKey).length > 0) {
    const regressions: string[] = [];
    const persistent: string[] = [];
    for (const t of unhealthy) {
      const key = historyKey(t.scenarioId, t.testId, t.role);
      const prev = history.previousStatusByKey[key];
      if (prev === 'passed') regressions.push(t.testId || t.title);
      else if (prev && prev !== 'skipped') persistent.push(t.testId || t.title);
    }
    if (regressions.length > 0) {
      insights.push(
        `Jenis: Trend — Regresi: ${regressions.length} test gagal padahal lulus di run sebelumnya: ${capNames(regressions)} — cari perubahan sejak run terakhir.`,
      );
    }
    if (persistent.length > 0) {
      insights.push(
        `Jenis: Trend — ${persistent.length} failure berulang dari run sebelumnya: ${capNames(persistent)} — eskalasi, jangan diperlakukan sebagai kasus baru.`,
      );
    }
    if (
      history.previousPassRate !== undefined &&
      tests.length > 0 &&
      history.previousPassRate - passRateOf(tests) >= 10
    ) {
      insights.push(
        `Jenis: Trend — Pass rate turun signifikan: ${history.previousPassRate}% → ${passRateOf(tests)}% — cek perubahan app/environment antara kedua run.`,
      );
    }
  }

  // 2. Hot module — most failures (meaningful only when ≥2)
  const byModule = new Map<string, number>();
  for (const t of unhealthy) {
    const m = (t.module || '').trim();
    if (m) byModule.set(m, (byModule.get(m) ?? 0) + 1);
  }
  const hotModule = [...byModule.entries()].sort((a, b) => b[1] - a[1])[0];
  if (hotModule && hotModule[1] >= 2) {
    insights.push(
      `Jenis: Trend — Modul "${hotModule[0]}" mencatat failure terbanyak (${hotModule[1]} dari ${unhealthy.length} gagal) — prioritaskan triage di modul ini.`,
    );
  }

  // 3. Hot role (role-aware runs only)
  const byRole = new Map<string, number>();
  for (const t of unhealthy) {
    const r = (t.role || '').trim();
    if (r) byRole.set(r, (byRole.get(r) ?? 0) + 1);
  }
  const hotRole = [...byRole.entries()].sort((a, b) => b[1] - a[1])[0];
  if (hotRole && hotRole[1] >= 2 && byRole.size > 1) {
    insights.push(
      `Jenis: Trend — Role "${hotRole[0]}" paling sering gagal (${hotRole[1]}x) — cek permission/seed untuk role ini.`,
    );
  }

  // 4. Flaky survivors
  const flaky = passed.filter((t) => (t.retry ?? 0) > 0);
  if (flaky.length > 0) {
    insights.push(
      `Jenis: Stability — ${flaky.length} test flaky (lulus setelah retry): ${capNames(flaky.map((t) => t.testId || t.title))} — stabilkan sebelum jadi baseline.`,
    );
  }

  // 5. Repeated error fingerprints (shared root cause candidates)
  const byFingerprint = new Map<string, string[]>();
  for (const t of unhealthy) {
    if (!t.errorMessage) continue;
    const fp = generateErrorFingerprint(t.errorMessage);
    const list = byFingerprint.get(fp.fingerprintId) ?? [];
    list.push(t.testId || t.title);
    byFingerprint.set(fp.fingerprintId, list);
  }
  for (const [fpId, names] of byFingerprint) {
    if (names.length >= 2) {
      insights.push(
        `Jenis: Root Cause — Pola error berulang (${fpId}) di ${names.length} test: ${capNames(names)} — satu perbaikan bisa menutup semua.`,
      );
      break; // one representative pattern is enough for the overview
    }
  }

  // 6. Slowest test in the run
  const slowest = [...tests].sort((a, b) => (b.duration || 0) - (a.duration || 0))[0];
  if (slowest && tests.length >= 5 && (slowest.duration || 0) > 0) {
    const avg = tests.reduce((sum, t) => sum + (t.duration || 0), 0) / tests.length;
    if (slowest.duration > avg * 3) {
      insights.push(
        `Jenis: Stability — Flow paling lambat: ${slowest.testId || slowest.title} (${formatSeconds(slowest.duration)} vs rata-rata ${formatSeconds(avg)}) — cek wait/poll atau beban data.`,
      );
    }
  }

  // 7. Weak assertions on passed tests (false-green risk) — cluster threshold
  // keeps tiny runs quiet; per-row notes already flag individual cases.
  const weak = passed.filter((t) => !hasExpectStep(t.steps));
  if (weak.length >= 3) {
    insights.push(
      `Jenis: Test Quality — ${weak.length} test passed tanpa assertion terdeteksi pada langkah (false-green risk): ${capNames(weak.map((t) => t.testId || t.title))} — assertion helper tidak terlihat oleh reporter; validasi manual.`,
    );
  }

  // 8. Skipped coverage
  if (skipped.length > 0 && tests.length > 0 && skipped.length / tests.length >= 0.2) {
    insights.push(
      `Jenis: Coverage — ${skipped.length} dari ${tests.length} scenario skipped — pastikan ini rencana, bukan coverage gap.`,
    );
  }

  return insights;
}

function passRateOf(tests: CollectedTestData[]): number {
  if (tests.length === 0) return 0;
  const passed = tests.filter((t) => t.status === 'passed').length;
  return Math.round((passed / tests.length) * 100);
}
