/** @jsxImportSource @kitajs/html */
import type { LatestRunSummary } from '../../domain/dashboard';
import {
  IconCheck,
  IconCross,
  IconSkip,
  IconSave,
  IconSearch,
  IconDashboard,
} from '../../components/shared/icons';

export interface LatestRunCardProps {
  latestRun: LatestRunSummary | null;
}

export function LatestRunCard({ latestRun }: LatestRunCardProps) {
  if (!latestRun) {
    return (
      <div class="latest-run-card latest-run-card--empty">
        <div class="empty-icon">
          <IconDashboard size={36} />
        </div>
        <h3>No Test Executions Found</h3>
        <p class="muted">
          Run your Playwright tests with <code>npm run test</code> to view real-time results.
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
            <span class="badge-accent">LATEST EXECUTION</span>
            <span class="env-tag" safe>
              {latestRun.appEnv}
            </span>
            {latestRun.isArchived ? (
              <span class="archived-badge">ARCHIVED</span>
            ) : (
              <span class="unarchived-badge">UNARCHIVED</span>
            )}
          </div>
          <h2 class="latest-run-card__title" title={latestRun.displayName} safe>
            {latestRun.displayName}
          </h2>
          <div class="latest-run-card__meta muted">
            <span safe>Ran at {new Date(latestRun.ranAt).toLocaleString('en-GB')}</span>
            <span safe>· Duration: {durationSec}</span>
            {latestRun.testSeriesId ? <span safe>· Series: {latestRun.testSeriesId}</span> : null}
          </div>
          {latestRun.analysisVerdict ? (
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
                AI ANALYSIS: {latestRun.analysisVerdict.toUpperCase()}
              </span>
            </div>
          ) : null}
        </div>

        <div class={`latest-run-card__gauge ${passRateClass}`}>
          <span class="gauge-value font-mono">{latestRun.passRate}%</span>
          <span class="gauge-label">PASS RATE</span>
        </div>
      </div>

      <div class="latest-run-card__metrics">
        <div class="metric-box">
          <span class="metric-box__num font-mono">{latestRun.totalTests}</span>
          <span class="metric-box__label">Total Tests</span>
        </div>
        <div class="metric-box metric-box--passed">
          <span class="metric-box__num font-mono">
            <IconCheck size={14} class="metric-icon metric-icon--passed" />
            <span>{latestRun.passed}</span>
          </span>
          <span class="metric-box__label">Passed</span>
        </div>
        <div class="metric-box metric-box--failed">
          <span class="metric-box__num font-mono">
            {latestRun.failed > 0 && (
              <IconCross size={14} class="metric-icon metric-icon--failed" />
            )}
            <span>{latestRun.failed}</span>
          </span>
          <span class="metric-box__label">Failed</span>
        </div>
        <div class="metric-box metric-box--skipped">
          <span class="metric-box__num font-mono">
            {latestRun.skipped > 0 && (
              <IconSkip size={14} class="metric-icon metric-icon--skipped" />
            )}
            <span>{latestRun.skipped}</span>
          </span>
          <span class="metric-box__label">Skipped</span>
        </div>
      </div>

      <div class="latest-run-card__actions">
        <a
          href="/latest"
          class="btn-primary"
          title="Open full test report with step-by-step triage"
        >
          <IconSearch size={15} />
          <span>Open Detailed Report</span>
        </a>
        {!latestRun.isArchived && (
          <button
            class="btn-save-secondary"
            type="button"
            onclick="openSaveModal && openSaveModal()"
            title="Save this run to history"
          >
            <IconSave size={15} />
            <span>Save to History</span>
          </button>
        )}
      </div>
    </div>
  );
}
