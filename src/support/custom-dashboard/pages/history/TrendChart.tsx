/** @jsxImportSource @kitajs/html */
import type { ReportHistoryEntry } from '../../../../agents/reporter/report-history';

export interface TrendChartProps {
  history: ReportHistoryEntry[];
  width?: number;
  height?: number;
}

export function TrendChart({ history, width = 360, height = 48 }: TrendChartProps) {
  if (!history || history.length < 2) return null;

  const data = [...history].reverse().slice(-20); // chronological order
  const rates = data.map((d) => d.passRate);
  const chartSummary = data
    .map((entry) => `${entry.displayName || entry.runId}: ${entry.passRate}% pass rate`)
    .join('. ');
  const minRate = Math.max(0, Math.min(...rates) - 5);
  const maxRate = Math.min(100, Math.max(...rates) + 5);
  const range = maxRate - minRate || 1;
  const padding = 6;
  const xStep = data.length > 1 ? (width - 2 * padding) / (data.length - 1) : 0;

  const points = data
    .map((entry, i) => {
      const x = padding + i * xStep;
      const y = height - padding - ((entry.passRate - minRate) / range) * (height - 2 * padding);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  return (
    <div class="history-trend" id="history-trend">
      <span class="trend-label" id="history-trend-label">
        Pass Rate Trend
      </span>
      <p class="trend-summary" id="history-trend-summary" safe>
        {chartSummary}
      </p>
      <svg
        class="trend-sparkline"
        viewBox={`0 0 ${width} ${height}`}
        style="max-width:100%;height:auto;display:block;"
        xmlns="http://www.w3.org/2000/svg"
        role="img"
        aria-labelledby="history-trend-label history-trend-summary"
      >
        <polyline
          fill="none"
          stroke="var(--accent, #c4956a)"
          stroke-width="1.5"
          stroke-linejoin="round"
          points={points}
        />
        {data.map((entry, i) => {
          const x = padding + i * xStep;
          const y =
            height - padding - ((entry.passRate - minRate) / range) * (height - 2 * padding);
          const title = `${entry.passRate}% — ${entry.displayName || entry.runId}`;
          return (
            <circle
              cx={x.toFixed(1)}
              cy={y.toFixed(1)}
              r="2.5"
              fill="var(--accent, #c4956a)"
              title={title}
            />
          );
        })}
      </svg>
    </div>
  );
}
