import { loadArchivedMetadata, loadArchivedSummary, type ArchiveMetadata } from './report-archive';
import { listReportHistory } from './report-history';
import { deriveDisplayName, deriveTestSeriesId } from '../../support/custom-dashboard/domain/run';
import type {
  ComparisonCompatibility,
  ComparisonRunIdentity,
  CompatibilityLevel,
  ReportComparison as DomainReportComparison,
  ScenarioDiff as DomainScenarioDiff,
} from '../../support/custom-dashboard/domain/comparison';

// ─── Types ───────────────────────────────────────────────────────────────────

export type ScenarioDiff = DomainScenarioDiff;
export type ReportComparison = DomainReportComparison;
export type { ComparisonCompatibility, ComparisonRunIdentity, CompatibilityLevel };

export interface ComparisonScenarioItem {
  scenarioId: string;
  name: string;
  status: 'passed' | 'failed' | 'healed' | 'skipped' | 'not-generated';
  role?: string;
  module?: string;
  feature?: string;
  duration?: number;
  failureSource?: string;
  errorMessage?: string;
}

export interface ComparisonReportData {
  runId: string;
  timestamp: string;
  requirementPath: string;
  appEnv: string;
  passRate: number;
  totalTests: number;
  scenarios: ComparisonScenarioItem[];
}

function loadComparisonReportData(runId: string): ComparisonReportData | null {
  const summary = loadArchivedSummary(runId);
  if (!summary) return null;
  const metadata = loadArchivedMetadata(runId);

  const tc = Array.isArray(summary.testCases)
    ? (summary.testCases as Array<Record<string, unknown>>)
    : [];

  return {
    runId,
    timestamp: metadata?.ranAt ?? (summary.timestamp as string) ?? '',
    requirementPath: metadata?.requirementPath ?? (summary.requirementPath as string) ?? '',
    appEnv: metadata?.appEnv ?? 'local',
    passRate: (summary.passRate as number) ?? 0,
    totalTests: (summary.total as number) ?? tc.length,
    scenarios: tc.map((t) => ({
      scenarioId: (t.testId as string) || (t.scenarioId as string) || '',
      name: (t.title as string) || '',
      status: (['passed', 'failed', 'skipped'].includes(t.status as string)
        ? t.status
        : 'skipped') as ComparisonScenarioItem['status'],
      role: t.role as string | undefined,
      module: t.module as string | undefined,
      feature: t.feature as string | undefined,
      duration: t.duration as number | undefined,
      failureSource: t.failureSource as string | undefined,
      errorMessage: t.errorMessage as string | undefined,
    })),
  };
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Generate a human-readable comparison summary.
 * Designed for AI agent consumption and CLI output.
 */
export function generateComparisonSummary(comparison: ReportComparison): string {
  const lines: string[] = [];

  lines.push(`Comparison: ${comparison.baselineRunId} → ${comparison.comparisonRunId}`);
  lines.push(
    `Pass rate: ${comparison.baselinePassRate}% → ${comparison.comparisonPassRate}% (${comparison.passRateDelta > 0 ? `+${comparison.passRateDelta.toFixed(1)}%` : `${comparison.passRateDelta.toFixed(1)}%`})`,
  );
  lines.push('');

  if (comparison.summary.regressed > 0) {
    lines.push(`🔴 Regressions: ${comparison.summary.regressed}`);
    for (const r of comparison.regressions) {
      lines.push(`   ${r.scenarioId}: ${r.previousStatus} → ${r.currentStatus}`);
      if (r.currentError) lines.push(`      Error: ${r.currentError}`);
    }
  }

  if (comparison.summary.fixed > 0) {
    lines.push(`🟢 Fixes: ${comparison.summary.fixed}`);
    for (const f of comparison.fixes) {
      lines.push(`   ${f.scenarioId}: ${f.previousStatus} → ${f.currentStatus}`);
    }
  }

  if (comparison.summary.stableFailures > 0) {
    lines.push(`🟡 Stable failures: ${comparison.summary.stableFailures}`);
    for (const s of comparison.stableFailures) {
      lines.push(`   ${s.scenarioId}: ${s.currentStatus} (same error)`);
    }
  }

  if (comparison.summary.flaky > 0) {
    lines.push(`🔄 Flaky: ${comparison.summary.flaky}`);
    for (const fl of comparison.flakyScenarios) {
      lines.push(`   ${fl.scenarioId}: ${fl.previousStatus} → ${fl.currentStatus}`);
    }
  }

  if (comparison.summary.new > 0) {
    lines.push(`✨ New scenarios: ${comparison.summary.new}`);
  }

  if (comparison.summary.removed > 0) {
    lines.push(`🗑️ Removed scenarios: ${comparison.summary.removed}`);
  }

  if (comparison.summary.regressed === 0 && comparison.summary.fixed === 0) {
    lines.push('No changes detected between runs.');
  }

  return lines.join('\n');
}

/**
 * Calculate compatibility between baseline and candidate runs.
 */
export function getComparisonCompatibility(
  baseline: ComparisonReportData,
  candidate: ComparisonReportData,
  baselineMeta?: ArchiveMetadata | null,
  candidateMeta?: ArchiveMetadata | null,
): ComparisonCompatibility {
  const baseScenarios = new Set(baseline.scenarios.map((s) => s.scenarioId || s.name));
  const candScenarios = new Set(candidate.scenarios.map((s) => s.scenarioId || s.name));

  let intersection = 0;
  for (const id of candScenarios) {
    if (baseScenarios.has(id)) intersection++;
  }

  const union = new Set([...baseScenarios, ...candScenarios]).size;
  const overlapRatio = union === 0 ? 1 : intersection / union;

  const baseSeries =
    baselineMeta?.testSeriesId ||
    deriveTestSeriesId({
      requirementPath: baseline.requirementPath,
      requirementId: baselineMeta?.requirementId,
    });
  const candSeries =
    candidateMeta?.testSeriesId ||
    deriveTestSeriesId({
      requirementPath: candidate.requirementPath,
      requirementId: candidateMeta?.requirementId,
    });

  const sameTestSeries = Boolean(baseSeries && candSeries && baseSeries === candSeries);
  const sameEnvironment = (baseline.appEnv || 'local') === (candidate.appEnv || 'local');

  const reasons: string[] = [];
  if (sameTestSeries) {
    reasons.push(`Same test series: ${candSeries}`);
  } else {
    reasons.push(`Different test series: "${baseSeries}" vs "${candSeries}"`);
  }

  if (sameEnvironment) {
    reasons.push(`Same environment: ${candidate.appEnv || 'local'}`);
  } else {
    reasons.push(
      `Different environments: ${baseline.appEnv || 'local'} vs ${candidate.appEnv || 'local'}`,
    );
  }

  const overlapPct = Math.round(overlapRatio * 100);
  reasons.push(`${overlapPct}% scenario overlap (${intersection}/${union})`);

  let level: CompatibilityLevel;
  if (sameTestSeries && sameEnvironment && overlapRatio >= 0.75) {
    level = 'exact';
  } else if (sameTestSeries || overlapRatio >= 0.75) {
    level = 'compatible';
  } else if (
    overlapRatio >= 0.4 ||
    (baseline.requirementPath && baseline.requirementPath === candidate.requirementPath)
  ) {
    level = 'partial';
  } else {
    level = 'mismatch';
  }

  return {
    level,
    reasons,
    overlapRatio,
    sameTestSeries,
    sameEnvironment,
    scenarioIntersectionCount: intersection,
    scenarioUnionCount: union,
  };
}

/**
 * Compare two archived reports by runId.
 */
export function compareReports(
  baselineRunId: string,
  comparisonRunId: string,
): ReportComparison | { error: string } {
  const baseline = loadComparisonReportData(baselineRunId);
  const comparison = loadComparisonReportData(comparisonRunId);

  if (!baseline) return { error: `Baseline report not found: ${baselineRunId}` };
  if (!comparison) return { error: `Comparison report not found: ${comparisonRunId}` };

  const baselineMeta = loadArchivedMetadata(baselineRunId);
  const comparisonMeta = loadArchivedMetadata(comparisonRunId);

  const isReversed =
    new Date(baseline.timestamp).getTime() > new Date(comparison.timestamp).getTime();

  let base = baseline;
  let comp = comparison;
  let bMeta = baselineMeta;
  let cMeta = comparisonMeta;

  if (isReversed) {
    base = comparison;
    comp = baseline;
    bMeta = comparisonMeta;
    cMeta = baselineMeta;
  }

  const compatibility = getComparisonCompatibility(base, comp, bMeta, cMeta);

  const baselineIdentity: ComparisonRunIdentity = {
    runId: base.runId,
    displayName:
      bMeta?.displayName ||
      deriveDisplayName({
        requirementPath: base.requirementPath,
        appEnv: base.appEnv,
        ranAt: base.timestamp,
      }),
    testSeriesId: bMeta?.testSeriesId,
    requirementId: bMeta?.requirementId,
    appEnv: base.appEnv,
    ranAt: base.timestamp,
    passRate: base.passRate,
    totalTests: base.totalTests,
  };

  const candidateIdentity: ComparisonRunIdentity = {
    runId: comp.runId,
    displayName:
      cMeta?.displayName ||
      deriveDisplayName({
        requirementPath: comp.requirementPath,
        appEnv: comp.appEnv,
        ranAt: comp.timestamp,
      }),
    testSeriesId: cMeta?.testSeriesId,
    requirementId: cMeta?.requirementId,
    appEnv: comp.appEnv,
    ranAt: comp.timestamp,
    passRate: comp.passRate,
    totalTests: comp.totalTests,
  };

  const compResult = buildComparison(base, comp);

  return {
    ...compResult,
    baseline: baselineIdentity,
    candidate: candidateIdentity,
    compatibility,
    isCandidateOlder: isReversed,
  };
}

/**
 * Compare latest run vs previous run for a requirement.
 */
export function compareLatestVsPrevious(
  requirementPath?: string,
): ReportComparison | { error: string } {
  const entries = listReportHistory({
    requirementPath,
    sort: 'newest',
    limit: 2,
  });

  if (entries.length < 2) {
    return { error: 'Need at least 2 archived reports to compare' };
  }

  const latest = loadComparisonReportData(entries[0].runId);
  const previous = loadComparisonReportData(entries[1].runId);

  if (!latest || !previous) {
    return { error: 'Failed to load comparison reports' };
  }

  return buildComparison(previous, latest);
}

// ─── Internal ────────────────────────────────────────────────────────────────

/**
 * Classify the change between a baseline and comparison scenario status.
 *
 * Exported for unit testing (pure function, no I/O).
 */
export function classifyChange(
  base: {
    status: string;
    errorMessage?: string;
    scenarioId?: string;
    name?: string;
    role?: string;
    module?: string;
    feature?: string;
  },
  comp: {
    status: string;
    errorMessage?: string;
    scenarioId?: string;
    name?: string;
    role?: string;
    module?: string;
    feature?: string;
  },
): ScenarioDiff {
  const prev = base.status;
  const curr = comp.status;

  let change: string;

  if (prev === curr) {
    if (prev === 'failed') {
      // Same failure — check if same error
      const sameError = base.errorMessage === comp.errorMessage;
      change = sameError ? 'stable' : 'flaky';
    } else {
      change = 'unchanged';
    }
  } else if (prev === 'passed' && curr === 'failed') {
    change = 'regression';
  } else if (prev === 'failed' && curr === 'passed') {
    change = 'fix';
  } else if (prev === 'failed' && curr === 'skipped') {
    change = 'stable';
  } else if (prev === 'skipped' && curr === 'failed') {
    change = 'regression';
  } else if (prev === 'skipped' && curr === 'passed') {
    change = 'fix';
  } else if (prev === 'passed' && curr === 'skipped') {
    change = 'flaky';
  } else if (prev === 'failed' && curr === 'healed') {
    change = 'fix';
  } else if (prev === 'healed' && curr === 'failed') {
    change = 'regression';
  } else if (prev === 'healed' && curr === 'passed') {
    // Healed → passed: healer succeeded, test now green. This is a fix.
    change = 'fix';
  } else if (prev === 'passed' && curr === 'healed') {
    // Passed → healed: functionally unchanged (still green).
    change = 'unchanged';
  } else if (prev === 'skipped' && curr === 'healed') {
    // Skipped → healed: previously not run, now green — treat as fix.
    change = 'fix';
  } else if (prev === 'healed' && curr === 'skipped') {
    // Healed → skipped: lost green status — treat as flaky.
    change = 'flaky';
  } else {
    change = 'flaky';
  }

  return {
    scenarioId: comp.scenarioId || base.scenarioId || '',
    name: comp.name || base.name || '',
    role: comp.role || base.role,
    module: comp.module || base.module,
    feature: comp.feature || base.feature,
    previousStatus: prev,
    currentStatus: curr,
    change,
    previousError: base.errorMessage,
    currentError: comp.errorMessage,
  };
}
function buildComparison(
  baseline: ComparisonReportData,
  comparison: ComparisonReportData,
): ReportComparison {
  const makeKey = (s: ComparisonScenarioItem) =>
    s.role ? `${s.scenarioId}::${s.role}` : s.scenarioId;

  const baselineMap = new Map<string, ComparisonScenarioItem>();
  for (const s of baseline.scenarios) {
    baselineMap.set(makeKey(s), s);
  }

  const comparisonMap = new Map<string, ComparisonScenarioItem>();
  for (const s of comparison.scenarios) {
    comparisonMap.set(makeKey(s), s);
  }

  const regressions: ScenarioDiff[] = [];
  const fixes: ScenarioDiff[] = [];
  const newScenarios: ScenarioDiff[] = [];
  const removedScenarios: ScenarioDiff[] = [];
  const stableFailures: ScenarioDiff[] = [];
  const flakyScenarios: ScenarioDiff[] = [];

  for (const [key, compScenario] of comparisonMap) {
    const baseScenario = baselineMap.get(key);

    if (!baseScenario) {
      newScenarios.push({
        scenarioId: compScenario.scenarioId,
        name: compScenario.name,
        previousStatus: 'not-present',
        currentStatus: compScenario.status,
        change: 'new',
        currentError: compScenario.errorMessage,
        role: compScenario.role,
        module: compScenario.module,
        feature: compScenario.feature,
      });
      continue;
    }

    const prev = baseScenario.status;
    const curr = compScenario.status;

    if (prev === 'passed' && curr === 'failed') {
      regressions.push({
        scenarioId: compScenario.scenarioId,
        name: compScenario.name,
        previousStatus: prev,
        currentStatus: curr,
        change: 'regression',
        previousError: baseScenario.errorMessage,
        currentError: compScenario.errorMessage,
        role: compScenario.role,
        module: compScenario.module,
        feature: compScenario.feature,
      });
    } else if (prev === 'failed' && curr === 'passed') {
      fixes.push({
        scenarioId: compScenario.scenarioId,
        name: compScenario.name,
        previousStatus: prev,
        currentStatus: curr,
        change: 'fix',
        previousError: baseScenario.errorMessage,
        role: compScenario.role,
        module: compScenario.module,
        feature: compScenario.feature,
      });
    } else if (prev === 'failed' && curr === 'failed') {
      const sameError = baseScenario.errorMessage === compScenario.errorMessage;
      if (sameError) {
        stableFailures.push({
          scenarioId: compScenario.scenarioId,
          name: compScenario.name,
          previousStatus: prev,
          currentStatus: curr,
          change: 'stable',
          previousError: baseScenario.errorMessage,
          currentError: compScenario.errorMessage,
          role: compScenario.role,
          module: compScenario.module,
          feature: compScenario.feature,
        });
      } else {
        flakyScenarios.push({
          scenarioId: compScenario.scenarioId,
          name: compScenario.name,
          previousStatus: prev,
          currentStatus: curr,
          change: 'flaky',
          previousError: baseScenario.errorMessage,
          currentError: compScenario.errorMessage,
          role: compScenario.role,
          module: compScenario.module,
          feature: compScenario.feature,
        });
      }
    }
  }

  for (const [key, baseScenario] of baselineMap) {
    if (!comparisonMap.has(key)) {
      removedScenarios.push({
        scenarioId: baseScenario.scenarioId,
        name: baseScenario.name,
        previousStatus: baseScenario.status,
        currentStatus: 'removed',
        change: 'removed',
        previousError: baseScenario.errorMessage,
        role: baseScenario.role,
        module: baseScenario.module,
        feature: baseScenario.feature,
      });
    }
  }

  const passRateDelta = comparison.passRate - baseline.passRate;

  return {
    baselineRunId: baseline.runId,
    comparisonRunId: comparison.runId,
    baselineTimestamp: baseline.timestamp,
    comparisonTimestamp: comparison.timestamp,
    baselinePassRate: baseline.passRate,
    comparisonPassRate: comparison.passRate,
    passRateDelta,
    regressions,
    fixes,
    newScenarios,
    removedScenarios,
    stableFailures,
    flakyScenarios,
    summary: {
      totalScenarios: comparison.scenarios.length,
      regressed: regressions.length,
      fixed: fixes.length,
      new: newScenarios.length,
      removed: removedScenarios.length,
      stableFailures: stableFailures.length,
      flaky: flakyScenarios.length,
    },
  };
}
