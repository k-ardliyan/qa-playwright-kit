/** @jsxImportSource @kitajs/html */
import type { TrendPoint } from '../../domain/dashboard';

export interface QualityTrendProps {
  trendPoints: TrendPoint[];
  width?: number;
  height?: number;
}

export function QualityTrend({ trendPoints, width = 680, height = 140 }: QualityTrendProps) {
  if (!trendPoints || trendPoints.length < 2) {
    return (
      <div class="panel quality-trend-panel">
        <div class="panel-header">
          <h3 class="panel-title">Quality & Pass Rate Trend</h3>
        </div>
        <div class="trend-placeholder muted">
          <p>Collect at least 2 test runs to generate quality trend visualization.</p>
        </div>
      </div>
    );
  }

  const rates = trendPoints.map((p) => p.passRate);
  const minRate = Math.max(0, Math.min(...rates) - 10);
  const maxRate = Math.min(100, Math.max(...rates) + 10);
  const range = maxRate - minRate || 1;
  const paddingX = 24;
  const paddingY = 20;

  const xStep = trendPoints.length > 1 ? (width - 2 * paddingX) / (trendPoints.length - 1) : 0;

  const points = trendPoints
    .map((p, i) => {
      const x = paddingX + i * xStep;
      const y = height - paddingY - ((p.passRate - minRate) / range) * (height - 2 * paddingY);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  const chartSummary = trendPoints
    .map((point) => `${point.displayName}: ${point.passRate}% pass rate`)
    .join('. ');

  return (
    <div class="panel quality-trend-panel">
      <div class="panel-header">
        <h3 class="panel-title" id="quality-trend-title">
          Pass Rate Trend ({trendPoints.length} runs)
        </h3>
        <span class="muted">
          Min: {Math.min(...rates)}% · Max: {Math.max(...rates)}%
        </span>
      </div>

      <div class="trend-svg-container">
        <p class="trend-summary sr-only" id="quality-trend-summary" safe>
          {chartSummary}
        </p>
        <svg
          class="trend-chart-svg"
          viewBox={`0 0 ${width} ${height}`}
          style="max-width:100%;height:auto;display:block;"
          xmlns="http://www.w3.org/2000/svg"
          role="img"
          aria-labelledby="quality-trend-title quality-trend-summary"
        >
          {/* Baseline guide lines */}
          <line
            x1={paddingX}
            y1={paddingY}
            x2={width - paddingX}
            y2={paddingY}
            stroke="var(--border)"
            stroke-dasharray="3 3"
          />
          <line
            x1={paddingX}
            y1={height - paddingY}
            x2={width - paddingX}
            y2={height - paddingY}
            stroke="var(--border)"
            stroke-dasharray="3 3"
          />

          {/* Sparkline polyline */}
          <polyline
            fill="none"
            stroke="var(--accent, #c4956a)"
            stroke-width="2.5"
            stroke-linejoin="round"
            stroke-linecap="round"
            points={points}
          />

          {/* Data point circles */}
          {trendPoints.map((p, i) => {
            const x = paddingX + i * xStep;
            const y =
              height - paddingY - ((p.passRate - minRate) / range) * (height - 2 * paddingY);
            const isGood = p.passRate >= 80;
            const fill = isGood ? 'var(--accent, #c4956a)' : '#e06c75';
            return (
              <g class="trend-point-group">
                <circle
                  cx={x.toFixed(1)}
                  cy={y.toFixed(1)}
                  r="4"
                  fill={fill}
                  stroke="var(--surface)"
                  stroke-width="1.5"
                />
                <title safe>{`${p.displayName}: ${p.passRate}% pass`}</title>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
