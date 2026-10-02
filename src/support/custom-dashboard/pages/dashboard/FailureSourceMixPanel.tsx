/** @jsxImportSource @kitajs/html */
import type { FailureSourceMixEntry } from '../../domain/dashboard';
import { IconChartPie, IconCircleCheck } from '../../components/shared/icons';

/** Short display label per failure source. */
export function failureSourceLabel(source: string): string {
  switch (source) {
    case 'app':
      return 'App bug';
    case 'test':
      return 'Test issue';
    case 'requirement':
      return 'Requirement';
    case 'env':
      return 'Environment';
    case 'ai_generation':
      return 'AI generation';
    case 'unknown':
    default:
      return 'Unknown';
  }
}

export interface FailureSourceMixPanelProps {
  mix: FailureSourceMixEntry[];
  totalFailures: number;
}

/**
 * Failure-source mix — one stacked bar plus a legend.
 *
 * The bar gives the proportion (length is the preattentive attribute people
 * read most accurately); the legend carries the exact counts, so the colour is
 * never the only channel conveying the number.
 */
export function FailureSourceMixPanel({ mix, totalFailures }: FailureSourceMixPanelProps) {
  const hasFailures = mix.length > 0 && totalFailures > 0;

  return (
    <div class="panel health-panel">
      <div class="panel-header">
        <h3 class="panel-title">
          <IconChartPie size={15} class="icon-neutral" />
          <span>Failure source</span>
        </h3>
        <span class="muted font-mono">
          {totalFailures} failure{totalFailures === 1 ? '' : 's'}
        </span>
      </div>

      {!hasFailures ? (
        <p class="panel-empty">
          <span class="panel-empty__mark panel-empty__mark--ok" aria-hidden="true">
            <IconCircleCheck size={12} />
          </span>
          <span>No failures in the latest run.</span>
        </p>
      ) : (
        <div class="mix-panel">
          <div class="mix-bar" role="img" aria-label="Failure source distribution">
            {mix.map((entry) => (
              <div
                class={`mix-seg failure-source--${entry.source}`}
                style={`width:${Math.max(entry.share * 100, entry.count > 0 ? 2 : 0)}%`}
                title={`${failureSourceLabel(entry.source)} — ${entry.count} (${Math.round(entry.share * 100)}%)`}
              />
            ))}
          </div>

          <ul class="mix-legend">
            {mix.map((entry) => (
              <li class="mix-legend__item">
                <span class={`mix-dot failure-source--${entry.source}`} aria-hidden="true" />
                <span class="mix-legend__label" safe>
                  {failureSourceLabel(entry.source)}
                </span>
                <span class="mix-legend__count">{entry.count}</span>
                <span class="mix-legend__share">{Math.round(entry.share * 100)}%</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
