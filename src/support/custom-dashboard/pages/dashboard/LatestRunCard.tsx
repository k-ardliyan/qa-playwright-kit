/** @jsxImportSource @kitajs/html */
import type { LatestRunSummary } from '../../domain/dashboard';
import {
  IconCircleCheck,
  IconCircleX,
  IconCircleSlash2,
  IconSave,
  IconArrowRight,
  IconLayoutDashboard,
  IconList,
} from '../../components/shared/icons';

export interface LatestRunCardProps {
  latestRun: LatestRunSummary | null;
}

/**
 * Latest execution masthead — the first thing QA reads.
 *
 * Structure follows the shadcn Card anatomy (header / content / footer) but
 * spans full width: identity and verdict on the top row, a four-cell metric
 * strip beneath it, then the actions. Numbers use tabular mono so the columns
 * of digits align between runs.
 */
export function LatestRunCard({ latestRun }: LatestRunCardProps) {
  if (!latestRun) {
    return (
      <div class="latest-run-card latest-run-card--empty">
        <div class="empty-icon">
          <IconLayoutDashboard size={22} />
        </div>
        <h3>No test executions found</h3>
        <p class="muted">
          Run your Playwright tests with <code>npm run test</code> to view results here.
        </p>
      </div>
    );
  }

  const passRateClass =
    latestRun.passRate >= 80 ? 'rate-good' : latestRun.passRate >= 50 ? 'rate-warn' : 'rate-bad';

  const durationSec = latestRun.durationMs ? `${(latestRun.durationMs / 1000).toFixed(1)}s` : '—';

  return (
    <div class="latest-run-card">
      <div class="latest-run-card__header">
        <div>
          <div class="card-badge-row">
            <span class="badge-accent">Latest execution</span>
            <span class="env-tag" safe>
              {latestRun.appEnv}
            </span>
            {latestRun.isArchived ? (
              <span class="status-badge status-badge--archived">ARCHIVED</span>
            ) : (
              <span class="status-badge status-badge--unarchived">UNARCHIVED</span>
            )}
          </div>
          <h2 class="latest-run-card__title" title={latestRun.displayName} safe>
            {latestRun.displayName}
          </h2>
          <div class="latest-run-card__meta">
            <span safe>Ran {new Date(latestRun.ranAt).toLocaleString('en-GB')}</span>
            <span safe>{durationSec}</span>
            {latestRun.testSeriesId ? <span safe>{latestRun.testSeriesId}</span> : null}
          </div>
          {latestRun.analysisVerdict && latestRun.analysisVerdict !== 'not-applicable' ? (
            <div class="latest-run-card__analysis">
              <span
                class={`analysis-badge analysis-badge--${latestRun.analysisVerdict}`}
                title={
                  latestRun.analysisVerified
                    ? 'Analysis evidence verified'
                    : 'Analysis incomplete or not verified'
                }
                safe
              >
                AI analysis: {latestRun.analysisVerdict}
              </span>
            </div>
          ) : null}
        </div>

        <div class={`latest-run-card__gauge ${passRateClass}`}>
          <span class="gauge-value">{latestRun.passRate}%</span>
          <span class="gauge-label">Pass rate</span>
        </div>
      </div>

      <div class="latest-run-card__metrics">
        <div class="metric-box">
          <span class="metric-box__num">
            <IconList size={16} class="metric-icon" />
            <span>{latestRun.totalTests}</span>
          </span>
          <span class="metric-box__label">Total tests</span>
        </div>
        <div class="metric-box metric-box--passed">
          <span class="metric-box__num">
            <IconCircleCheck size={16} class="metric-icon metric-icon--passed" />
            <span>{latestRun.passed}</span>
          </span>
          <span class="metric-box__label">Passed</span>
        </div>
        <div class="metric-box metric-box--failed">
          <span class="metric-box__num">
            <IconCircleX size={16} class="metric-icon metric-icon--failed" />
            <span>{latestRun.failed}</span>
          </span>
          <span class="metric-box__label">Failed</span>
        </div>
        <div class="metric-box metric-box--skipped">
          <span class="metric-box__num">
            <IconCircleSlash2 size={16} class="metric-icon metric-icon--skipped" />
            <span>{latestRun.skipped}</span>
          </span>
          <span class="metric-box__label">Skipped</span>
        </div>
      </div>

      <div class="latest-run-card__actions">
        <a href="/latest" class="btn-primary" title="Open the full report with step-level triage">
          <span>Open report</span>
          <IconArrowRight size={15} />
        </a>
        {!latestRun.isArchived && (
          <button
            class="btn-save-secondary"
            type="button"
            onclick="openSaveModal && openSaveModal()"
            title="Save this run to history"
          >
            <IconSave size={15} />
            <span>Save to history</span>
          </button>
        )}
      </div>
    </div>
  );
}
