/** @jsxImportSource @kitajs/html */
import type { ReportHistoryEntry } from '../../../../agents/reporter/report-history';

export interface TrendChartProps {
  history: ReportHistoryEntry[];
  width?: number;
  height?: number;
}

export function TrendChart({ history, width = 200, height = 32 }: TrendChartProps) {
  if (!history || history.length < 2) return null;

  const data = [...history].reverse().slice(-20); // chronological order
  const rates = data.map((d) => d.passRate);
  const latestRate = rates[rates.length - 1] ?? 0;
  const delta = latestRate - (rates[0] ?? latestRate);
  const deltaText = `${delta > 0 ? '+' : ''}${delta} pp`;
  const chartSummary = data
    .map((entry) => `${entry.displayName || entry.runId}: ${entry.passRate}% pass rate`)
    .join('. ');
  const minRate = Math.max(0, Math.min(...rates) - 5);
  const maxRate = Math.min(100, Math.max(...rates) + 5);
  const range = maxRate - minRate || 1;
  const padding = 4;
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
      <div class="trend-meta">
        <span class="trend-title">Pass Rate</span>
        <span class="trend-metric">{latestRate}%</span>
        <span class={`trend-delta ${delta >= 0 ? 'positive' : 'negative'}`}>{deltaText}</span>
      </div>
      <span class="trend-label sr-only" id="history-trend-label">
        Pass Rate Trend · {data.length} runs · Latest {latestRate}% · {deltaText}
      </span>
      <p class="trend-summary sr-only" id="history-trend-summary" safe>
        {chartSummary}
      </p>
      <svg
        class="trend-sparkline"
        viewBox={`0 0 ${width} ${height}`}
        style="width:140px;height:28px;display:block;"
        xmlns="http://www.w3.org/2000/svg"
        role="img"
        aria-labelledby="history-trend-label history-trend-summary"
      >
        <polyline
          fill="none"
          stroke="var(--accent, #c4956a)"
          stroke-width="1.75"
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
