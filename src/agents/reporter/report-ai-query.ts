/**
 * AI Query Interface — query historical reports for AI agent consumption.
 *
 * Provides structured answers to natural-language questions about
 * past test runs, pass rates, regressions, and trends.
 *
 * @module src/agents/reporter/report-ai-query
 */

import { listReportHistory, type ReportHistoryEntry } from './report-history';
import {
  compareLatestVsPrevious,
  generateComparisonSummary,
  type ReportComparison,
} from './report-compare';
import { loadArchivedSummary } from './report-archive';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface AIReportQuery {
  /** Natural language or structured query */
  question: string;
  /** Optional: limit to specific requirement */
  requirementPath?: string;
  /** Optional: time window */
  from?: string;
  to?: string;
}

export interface AIReportAnswer {
  /** Direct answer text */
  answer: string;
  /** Supporting data */
  data: {
    runsAnalyzed: number;
    timeRange: string;
    relevantReports: string[];
  };
  /** Suggested follow-up queries */
  suggestions: string[];
}

// ─── Query patterns ──────────────────────────────────────────────────────────

type QueryHandler = (query: AIReportQuery) => AIReportAnswer | null;

const QUERY_PATTERNS: Array<{ pattern: RegExp; handler: QueryHandler }> = [
  { pattern: /pass\s*rate|berapa.*pass|success.*rate/i, handler: handlePassRateQuery },
  { pattern: /regression|ada.*regress|failed.*before.*pass/i, handler: handleRegressionQuery },
  { pattern: /scenario.*pass.*terakhir|last.*pass|pernah.*pass/i, handler: handleLastPassQuery },
  { pattern: /trend|tren.*pass.*rate/i, handler: handleTrendQuery },
  {
    pattern: /module.*paling.*fail|module.*most.*fail|which.*module/i,
    handler: handleModuleFailureQuery,
  },
  { pattern: /compare|perbandingan|vs.*previous|latest.*vs/i, handler: handleCompareQuery },
  { pattern: /history|riwayat|run.*list|daftar.*run/i, handler: handleHistoryQuery },
];

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Query historical reports — designed for AI agent consumption.
 * Returns structured answer that AI can reason about.
 *
 * Supported query patterns:
 * - "Berapa pass rate requirement X minggu lalu?"
 * - "Ada regression di run terakhir?"
 * - "Scenario Y pernah pass kapan terakhir?"
 * - "Trend pass rate requirement Z 30 hari terakhir?"
 * - "Module mana yang paling banyak failure?"
 * - "Compare latest vs previous run"
 * - "History of requirement X"
 */
export function queryReportHistory(query: AIReportQuery): AIReportAnswer {
  // Try pattern matching
  for (const { pattern, handler } of QUERY_PATTERNS) {
    if (pattern.test(query.question)) {
      const result = handler(query);
      if (result) return result;
    }
  }

  // Fallback: general history query
  return handleHistoryQuery(query);
}

// ─── Handlers ────────────────────────────────────────────────────────────────

function handlePassRateQuery(query: AIReportQuery): AIReportAnswer {
  const entries = listReportHistory({
    requirementPath: query.requirementPath,

    sort: 'newest',
    limit: 5,
  });

  if (entries.length === 0) {
    return {
      answer: 'No archived reports found matching the query.',
      data: { runsAnalyzed: 0, timeRange: 'N/A', relevantReports: [] },
      suggestions: ['Run a pipeline first to generate reports', 'Check if APP_ENV is correct'],
    };
  }

  const lines: string[] = [];

  if (query.requirementPath) {
    lines.push(`Pass rate for ${query.requirementPath}:`);
  } else {
    lines.push('Latest pass rates:');
  }

  for (const entry of entries) {
    lines.push(`  ${entry.ranAt}: ${entry.passRate}% (${entry.totalTests} tests, ${entry.status})`);
  }

  const avgPassRate = entries.reduce((s, e) => s + e.passRate, 0) / entries.length;

  return {
    answer: lines.join('\n'),
    data: {
      runsAnalyzed: entries.length,
      timeRange: `${entries[entries.length - 1].ranAt} → ${entries[0].ranAt}`,
      relevantReports: entries.map((e) => e.runId),
    },
    suggestions: [
      `Average pass rate: ${avgPassRate.toFixed(1)}%`,
      'Ask about regressions or trends for more detail',
    ],
  };
}

function handleRegressionQuery(query: AIReportQuery): AIReportAnswer {
  const compResult = compareLatestVsPrevious(query.requirementPath);

  if ('error' in compResult) {
    return {
      answer: `Cannot compare: ${compResult.error}`,
      data: { runsAnalyzed: 0, timeRange: 'N/A', relevantReports: [] },
      suggestions: ['Run at least 2 pipelines to enable comparison'],
    };
  }

  const comp = compResult as ReportComparison;
  const hasRegressions = comp.summary.regressed > 0;

  const lines: string[] = [];
  if (hasRegressions) {
    lines.push(`🔴 ${comp.summary.regressed} regression(s) detected:`);
    for (const r of comp.regressions) {
      lines.push(`  ${r.scenarioId} (${r.name}): ${r.previousStatus} → ${r.currentStatus}`);
      if (r.currentError) lines.push(`    Error: ${r.currentError}`);
    }
  } else {
    lines.push('✅ No regressions detected in the latest run.');
  }

  if (comp.summary.fixed > 0) {
    lines.push(`🟢 ${comp.summary.fixed} fix(es):`);
    for (const f of comp.fixes) {
      lines.push(`  ${f.scenarioId} (${f.name}): ${f.previousStatus} → ${f.currentStatus}`);
    }
  }

  return {
    answer: lines.join('\n'),
    data: {
      runsAnalyzed: 2,
      timeRange: `${comp.baselineTimestamp} → ${comp.comparisonTimestamp}`,
      relevantReports: [comp.baselineRunId, comp.comparisonRunId],
    },
    suggestions: hasRegressions
      ? ['Check failure source for each regression', 'Ask about specific scenario details']
      : ['Ask about trend or module failures'],
  };
}

function handleLastPassQuery(query: AIReportQuery): AIReportAnswer {
  // Extract scenario name from query
  const scenarioMatch = query.question.match(/["']([^"']+)["']/);
  const scenarioName = scenarioMatch?.[1] ?? '';

  const entries = listReportHistory({
    requirementPath: query.requirementPath,
    sort: 'oldest',
    limit: 100,
  });

  let lastPass: ReportHistoryEntry | null = null;
  const relevantReports: string[] = [];

  for (const entry of entries) {
    const summary = loadArchivedSummary(entry.runId);
    if (!summary) continue;

    const testCases = Array.isArray(summary.testCases)
      ? (summary.testCases as Array<Record<string, unknown>>)
      : [];

    const scenario = testCases.find(
      (s) =>
        s.status === 'passed' &&
        (scenarioName
          ? String(s.title || s.testId || '')
              .toLowerCase()
              .includes(scenarioName.toLowerCase())
          : true),
    );

    if (scenario) {
      lastPass = entry;
      relevantReports.push(entry.runId);
    }
  }

  if (lastPass) {
    return {
      answer: scenarioName
        ? `Scenario "${scenarioName}" last passed on ${lastPass.ranAt} (run ${lastPass.runId}).`
        : `Last passing run: ${lastPass.ranAt} (run ${lastPass.runId}, pass rate ${lastPass.passRate}%).`,
      data: {
        runsAnalyzed: entries.length,
        timeRange:
          entries.length > 0 ? `${entries[0].ranAt} → ${entries[entries.length - 1].ranAt}` : 'N/A',
        relevantReports,
      },
      suggestions: ['Compare with the latest run to see what changed'],
    };
  }

  return {
    answer: scenarioName
      ? `Scenario "${scenarioName}" has not passed in any archived run.`
      : 'No passing runs found.',
    data: { runsAnalyzed: entries.length, timeRange: 'N/A', relevantReports: [] },
    suggestions: ['Check if the scenario has been flaky or consistently failing'],
  };
}

function handleTrendQuery(query: AIReportQuery): AIReportAnswer {
  const entries = listReportHistory({
    requirementPath: query.requirementPath,

    sort: 'oldest',
    limit: 30,
  });

  if (entries.length === 0) {
    return {
      answer: 'No archived reports found for trend analysis.',
      data: { runsAnalyzed: 0, timeRange: 'N/A', relevantReports: [] },
      suggestions: ['Run more pipelines to build trend data'],
    };
  }

  const lines: string[] = ['Pass rate trend:'];
  for (const entry of entries) {
    const bar = '█'.repeat(Math.round(entry.passRate / 5));
    lines.push(`  ${entry.ranAt.slice(0, 10)} ${bar} ${entry.passRate}%`);
  }

  const passRates = entries.map((e) => e.passRate);
  const avg = passRates.reduce((s, v) => s + v, 0) / passRates.length;
  const trend = passRates[passRates.length - 1] - passRates[0];
  const direction = trend > 0 ? 'improving ↑' : trend < 0 ? 'declining ↓' : 'stable →';

  lines.push(
    `Average: ${avg.toFixed(1)}% | Trend: ${direction} (${trend > 0 ? '+' : ''}${trend.toFixed(1)}%)`,
  );

  return {
    answer: lines.join('\n'),
    data: {
      runsAnalyzed: entries.length,
      timeRange: `${entries[0].ranAt} → ${entries[entries.length - 1].ranAt}`,
      relevantReports: entries.map((e) => e.runId),
    },
    suggestions: [
      'Ask about specific regressions for more detail',
      'Ask about module-level failures',
    ],
  };
}

function handleModuleFailureQuery(query: AIReportQuery): AIReportAnswer {
  const entries = listReportHistory({
    requirementPath: query.requirementPath,
    sort: 'newest',
    limit: 5,
  });

  if (entries.length === 0) {
    return {
      answer: 'No archived reports found.',
      data: { runsAnalyzed: 0, timeRange: 'N/A', relevantReports: [] },
      suggestions: [],
    };
  }

  // Aggregate failures by module from latest summary
  const latestSummary = loadArchivedSummary(entries[0].runId);
  if (!latestSummary) {
    return {
      answer: 'Failed to load latest report.',
      data: { runsAnalyzed: 0, timeRange: 'N/A', relevantReports: [] },
      suggestions: [],
    };
  }

  const testCases = Array.isArray(latestSummary.testCases)
    ? (latestSummary.testCases as Array<Record<string, unknown>>)
    : [];

  const moduleFailures = new Map<string, number>();
  for (const scenario of testCases) {
    if (scenario.status === 'failed') {
      const mod = (scenario.module as string) || 'unknown';
      moduleFailures.set(mod, (moduleFailures.get(mod) ?? 0) + 1);
    }
  }

  const sorted = [...moduleFailures.entries()].sort((a, b) => b[1] - a[1]);

  const lines: string[] = ['Failures by module:'];
  for (const [mod, count] of sorted) {
    lines.push(`  ${mod}: ${count} failure(s)`);
  }

  if (sorted.length === 0) {
    lines.push('  No failures in the latest run! 🎉');
  }

  return {
    answer: lines.join('\n'),
    data: {
      runsAnalyzed: 1,
      timeRange: (latestSummary.timestamp as string) || entries[0].ranAt,
      relevantReports: [entries[0].runId],
    },
    suggestions:
      sorted.length > 0
        ? [
            `Focus on module "${sorted[0][0]}" — most failures`,
            'Ask about specific scenario failures',
          ]
        : ['No action needed — all tests passing'],
  };
}

function handleCompareQuery(query: AIReportQuery): AIReportAnswer {
  const compResult = compareLatestVsPrevious(query.requirementPath);

  if ('error' in compResult) {
    return {
      answer: `Cannot compare: ${compResult.error}`,
      data: { runsAnalyzed: 0, timeRange: 'N/A', relevantReports: [] },
      suggestions: ['Run at least 2 pipelines to enable comparison'],
    };
  }

  const summary = generateComparisonSummary(compResult as ReportComparison);

  return {
    answer: summary,
    data: {
      runsAnalyzed: 2,
      timeRange: `${(compResult as ReportComparison).baselineTimestamp} → ${(compResult as ReportComparison).comparisonTimestamp}`,
      relevantReports: [
        (compResult as ReportComparison).baselineRunId,
        (compResult as ReportComparison).comparisonRunId,
      ],
    },
    suggestions: ['Ask about specific regressions', 'Ask about module-level failures'],
  };
}

function handleHistoryQuery(query: AIReportQuery): AIReportAnswer {
  const entries = listReportHistory({
    requirementPath: query.requirementPath,

    sort: 'newest',
    limit: 10,
  });

  if (entries.length === 0) {
    return {
      answer: 'No archived reports found.',
      data: { runsAnalyzed: 0, timeRange: 'N/A', relevantReports: [] },
      suggestions: ['Run a pipeline first to generate reports'],
    };
  }

  const lines: string[] = [`Report history (${entries.length} runs):`];
  for (const entry of entries) {
    const statusIcon = entry.status === 'success' ? '✅' : entry.status === 'partial' ? '🟡' : '❌';
    lines.push(
      `  ${statusIcon} ${entry.runId} | ${entry.ranAt.slice(0, 10)} | ${entry.passRate}% | ${entry.requirementPath || 'N/A'}`,
    );
  }

  return {
    answer: lines.join('\n'),
    data: {
      runsAnalyzed: entries.length,
      timeRange: `${entries[entries.length - 1].ranAt} → ${entries[0].ranAt}`,
      relevantReports: entries.map((e) => e.runId),
    },
    suggestions: [
      'Ask about pass rate trends',
      'Compare latest vs previous run',
      'Ask about specific module failures',
    ],
  };
}
