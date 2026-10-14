/** @jsxImportSource @kitajs/html */
import type { AiRunInsight } from '../../domain/dashboard';

const SOURCE_LABELS: Record<string, string> = {
  analyzer: 'auto',
  healer: 'healer',
  generator: 'generator',
  reporter: 'reporter',
};

/**
 * AI Run Insights — cross-scenario panel on the overview page: deterministic
 * trends (baked by the reporter) plus agent-authored run insights from the
 * notes sidecar. Empty state stays silent when the run is clean and small.
 */
export function AiInsightsPanel({ insights }: { insights: AiRunInsight[] }) {
  if (!insights || insights.length === 0) {
    return null;
  }

  return (
    <div class="panel ai-insights-panel" aria-labelledby="ai-insights-title">
      <div class="panel-header">
        <h3 class="panel-title" id="ai-insights-title">
          AI Run Insights
        </h3>
      </div>
      <ul class="ai-insights-list">
        {insights.map((insight, i) => (
          <AiInsightItem insight={insight} index={i} />
        ))}
      </ul>
    </div>
  );
}

function AiInsightItem({ insight, index }: { insight: AiRunInsight; index: number }) {
  const lines = (insight.text || '')
    .split(/\r\n|\n|\r/)
    .map((l) => l.trim())
    .filter(Boolean);
  const isAgent = insight.source !== 'analyzer';
  const sourceLabel = SOURCE_LABELS[insight.source] ?? insight.source;

  return (
    <li class="ai-insight-item" data-insight-index={index}>
      <div class="ai-insight-meta">
        <span class={`ai-note-src ai-note-src--${insight.source}`} safe>
          {sourceLabel}
        </span>
        {insight.kind ? (
          <span class="insight-kind" safe>
            {insight.kind}
          </span>
        ) : null}
        {isAgent && insight.priority ? (
          <span class={`insight-priority insight-priority--${insight.priority}`} safe>
            {insight.priority}
          </span>
        ) : null}
        {isAgent && insight.status ? (
          <span class="insight-status" safe>
            {insight.status}
          </span>
        ) : null}
      </div>
      <div class="ai-insight-text">
        {lines.map((line) => {
          const match = line.match(/^([A-Za-z ]+):\s*(.*)$/);
          if (match && INSIGHT_LABELS.has(match[1]!.toLowerCase())) {
            return (
              <div class="ai-note">
                <span class="ai-note-label" safe>
                  {match[1]}
                </span>
                <span safe>{match[2]}</span>
              </div>
            );
          }
          return (
            <div class="ai-note" safe>
              {line}
            </div>
          );
        })}
      </div>
      <AffectedChips insight={insight} />
    </li>
  );
}

/** Traceability chips — what this insight affects (tests/modules/roles). */
function AffectedChips({ insight }: { insight: AiRunInsight }) {
  const affected = insight.affected;
  if (!affected) return null;
  const tests = affected.tests ?? [];
  const modules = affected.modules ?? [];
  const roles = affected.roles ?? [];
  if (tests.length === 0 && modules.length === 0 && roles.length === 0) return null;

  // Single precomposed string child — keeps the `safe` escape meaningful
  // for the kitajs ts-html-plugin (K604 flags `safe` on multi-child nodes).
  const testsLabel =
    tests.length > 0
      ? `${tests.length} test${tests.length === 1 ? '' : 's'}: ${tests.slice(0, 3).join(', ')}${
          tests.length > 3 ? ` +${tests.length - 3}` : ''
        }`
      : null;

  return (
    <div class="ai-insight-affected">
      {testsLabel ? (
        <span class="affected-chip affected-chip--tests" title="Test terdampak" safe>
          {testsLabel}
        </span>
      ) : null}
      {modules.map((m) => (
        <span class="affected-chip affected-chip--module" safe>
          {m}
        </span>
      ))}
      {roles.map((r) => (
        <span class="affected-chip affected-chip--role" safe>
          {r}
        </span>
      ))}
    </div>
  );
}

const INSIGHT_LABELS = new Set([
  'jenis',
  'observasi',
  'bukti',
  'dampak',
  'rekomendasi',
  'next action',
  'status',
  'prioritas',
  'confidence',
]);
