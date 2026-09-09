/** @jsxImportSource @kitajs/html */
import type { FailureSourceMixEntry } from '../../domain/dashboard';
import { IconAlert } from '../../components/shared/icons';

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
 * Failure-source mix — a stacked bar whose segments are the semantic
 * failure-source colors already used across the dashboard, so QA can read at
 * a glance whether the run is dominated by app bugs, test issues, or
 * environment failures.
 */
export function FailureSourceMixPanel({ mix, totalFailures }: FailureSourceMixPanelProps) {
  const hasFailures = mix.length > 0 && totalFailures > 0;

  return (
    <div class="panel health-panel">
      <div class="panel-header">
        <div class="attention-header-title">
          <IconAlert size={16} class="icon-warning" />
          <h3 class="panel-title">Failure Source Mix</h3>
        </div>
        <span class="muted font-mono">
          {totalFailures} failure{totalFailures === 1 ? '' : 's'}
        </span>
      </div>

      {!hasFailures ? (
        <div class="attention-healthy">
          <p>
            <strong>No failures — source mix is clean.</strong>
          </p>
          <span class="muted">All scenarios in the latest run are passing.</span>
        </div>
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
                <span class="mix-legend__count font-mono">{entry.count}</span>
                <span class="mix-legend__share font-mono muted">
                  {Math.round(entry.share * 100)}%
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
