/**
 * Triage domain — pure helpers for the run-level review workflow.
 *
 * Groups unhealthy tests (failed/timedOut/interrupted) by their failure source
 * and derives the suggested run-level QA exit decision from the dominant
 * source. No DOM, no state — unit-testable.
 *
 * @module src/support/custom-dashboard/domain/triage
 */

import type { QaDecision } from '../../../agents/reporter/report-archive';
import type { FailureSource } from '../types';

/** Test statuses that count as needing triage. */
export const UNHEALTHY_STATUSES = new Set(['failed', 'timedOut', 'interrupted']);

/** One grouped triage bucket: unhealthy tests sharing a failure source. */
export interface TriageGroup {
  source: FailureSource | 'unknown';
  tests: TriageTest[];
  count: number;
  /** Suggested QA exit decision for this group's source. */
  suggestedDecision: QaDecision;
}

/** Minimal unhealthy-test view for the triage strip. */
export interface TriageTest {
  testId: string;
  scenarioId?: string;
  title: string;
  status: string;
  failureSource: FailureSource | 'unknown';
  errorMessage?: string;
  tracePath?: string;
  screenshotPath?: string;
  hasAttachment?: boolean;
}

/** Map failure source → QA exit decision (mirrors AGENTS.md decision table). */
export function decisionForSource(source: FailureSource | 'unknown' | undefined): QaDecision {
  switch (source) {
    case 'app':
      return 'FILE_BUG';
    case 'test':
      return 'FIX_TEST';
    case 'ai_generation':
      return 'FIX_TEST';
    case 'requirement':
      return 'REVISE_REQUIREMENT';
    case 'env':
      return 'FIX_ENV';
    case 'unknown':
    default:
      return 'MARK_BLOCKED';
  }
}

const SOURCE_ORDER: Array<FailureSource | 'unknown'> = [
  'app',
  'test',
  'requirement',
  'env',
  'ai_generation',
  'unknown',
];

function sourceRank(source: FailureSource | 'unknown'): number {
  const i = SOURCE_ORDER.indexOf(source);
  return i === -1 ? SOURCE_ORDER.length - 1 : i;
}

/**
 * Group unhealthy collected tests by failure source. Input matches the
 * CollectedTestData shape from types.ts (raw objects ok). Source falls back
 * to the heuristic suggestion when the annotation is absent.
 */
export function groupUnhealthyTests(rawTests: Array<Record<string, unknown>>): TriageGroup[] {
  const groups = new Map<FailureSource | 'unknown', TriageTest[]>();

  for (const t of rawTests) {
    const status = typeof t.status === 'string' ? t.status : '';
    if (!UNHEALTHY_STATUSES.has(status)) continue;

    const rawSource =
      typeof t.failureSource === 'string' && t.failureSource
        ? (t.failureSource as FailureSource | 'unknown')
        : 'unknown';
    const source = SOURCE_ORDER.includes(rawSource as FailureSource)
      ? rawSource
      : ('unknown' as FailureSource | 'unknown');

    const item: TriageTest = {
      testId:
        (t.testId as string) ||
        (t.scenarioId as string) ||
        `tc-${Math.random().toString(36).slice(2, 8)}`,
      scenarioId: (t.scenarioId as string) || undefined,
      title: (t.title as string) || (t.testId as string) || 'Untitled test',
      status,
      failureSource: source,
      errorMessage: (t.errorMessage as string) || undefined,
      tracePath: (t.tracePath as string) || undefined,
      screenshotPath: (t.screenshotPath as string) || undefined,
      hasAttachment: typeof t.attachmentCount === 'number' ? t.attachmentCount > 0 : undefined,
    };
    const bucket = groups.get(source) ?? [];
    bucket.push(item);
    groups.set(source, bucket);
  }

  return [...groups.entries()]
    .sort((a, b) => sourceRank(a[0]) - sourceRank(b[0]))
    .map(([source, tests]) => ({
      source,
      tests,
      count: tests.length,
      suggestedDecision: decisionForSource(source),
    }));
}

/**
 * Dominant suggested run-level decision from unhealthy tests. Empty input →
 * APPROVE (all green). Otherwise the decision of the largest source group;
 * ties resolved by source order (app first).
 */
export function dominantSuggestedDecision(rawTests: Array<Record<string, unknown>>): QaDecision {
  const groups = groupUnhealthyTests(rawTests);
  if (groups.length === 0) return 'APPROVE';
  const top = groups.reduce((a, b) => (b.count > a.count ? b : a));
  return top.suggestedDecision;
}
