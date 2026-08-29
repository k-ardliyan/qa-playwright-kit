/** @jsxImportSource @kitajs/html */
import type { ReportHistoryEntry } from '../../../../agents/reporter/report-history';

export interface RecentRunsProps {
  recentRuns: ReportHistoryEntry[];
}

export function RecentRuns({ recentRuns }: RecentRunsProps) {
  if (!recentRuns || recentRuns.length === 0) {
    return (
      <div class="panel recent-runs-panel">
        <div class="panel-header">
          <h3 class="panel-title">Recent Archived Runs</h3>
        </div>
        <p class="muted pad-12">No archived runs saved yet.</p>
      </div>
    );
  }

  return (
    <div class="panel recent-runs-panel">
      <div class="panel-header">
        <h3 class="panel-title">Recent Test Runs</h3>
        <a href="/history" class="panel-link">
          View all history →
        </a>
      </div>

      <div class="recent-runs-list">
        {recentRuns.map((run) => {
          const passRateClass =
            run.passRate >= 80 ? 'rate-good' : run.passRate >= 50 ? 'rate-warn' : 'rate-bad';
          const decisionClass = run.qaDecision
            ? `decision-badge decision-${run.qaDecision.toLowerCase().replace(/_/g, '-')}`
            : 'muted';

          return (
            <a class="recent-run-item" href={`/history/${encodeURIComponent(run.runId)}`}>
              <div class="recent-run-item__left">
                <div class="recent-run-item__title">
                  <strong safe>{run.displayName || run.runId}</strong>
                </div>
                <div class="recent-run-item__meta muted">
                  <span class="env-tag" safe>
                    {run.appEnv}
                  </span>
                  <span>
                    {run.savedAt ? new Date(run.savedAt).toLocaleDateString('en-GB') : ''}
                  </span>
                  <span class="font-mono">· {run.totalTests} tests</span>
                </div>
              </div>

              <div class="recent-run-item__right">
                <span class={`recent-run-rate font-mono ${passRateClass}`}>{run.passRate}%</span>
                {run.qaDecision ? <span class={decisionClass}>{run.qaDecision}</span> : null}
              </div>
            </a>
          );
        })}
      </div>
    </div>
  );
}
