/** @jsxImportSource @kitajs/html */
import type { QualityMetrics } from '../../domain/dashboard';

export interface QualityOverviewProps {
  metrics: QualityMetrics;
}

/**
 * Portfolio line — the cross-run health readout.
 *
 * Deliberately not four cards: these are five scalars read together, so they
 * live on one ruled strip. The flaky count is promoted here (it was previously
 * computed but never surfaced) because a test that only passes on retry is the
 * single most actionable quality signal in the set.
 */
export function QualityOverview({ metrics }: QualityOverviewProps) {
  // Five permanent cells: a conditional cell made the ribbon's cell count
  // vary between runs, so no responsive rule could know where a row started
  // (and the separator lines drifted). Flaky reads 0 when there is none —
  // the same "0 is a baseline" rule the metric strip follows.
  const cells: Array<{ label: string; value: string; tone?: string }> = [
    { label: 'Overall Pass Rate', value: `${metrics.overallPassRate}%` },
    { label: 'Archived Runs', value: String(metrics.totalArchivedRuns) },
    { label: 'Approved Runs', value: String(metrics.approvedRunsCount) },
    { label: 'Active Test Series', value: String(metrics.activeTestSeriesCount) },
    {
      label: 'Flaky',
      value: String(metrics.flakyCount),
      tone: metrics.flakyCount > 0 ? 'skipped' : undefined,
    },
  ];

  return (
    <div class="stat-ribbon quality-overview-grid" role="group" aria-label="Quality metrics">
      {cells.map((cell) => (
        <div class={`stat-ribbon__cell${cell.tone ? ` stat-ribbon__cell--${cell.tone}` : ''}`}>
          <span class="stat-ribbon__value font-mono" safe>
            {cell.value}
          </span>
          <span class="stat-ribbon__label" safe>
            {cell.label}
          </span>
        </div>
      ))}
    </div>
  );
}
