/** @jsxImportSource @kitajs/html */
import type { DashboardOverviewData } from '../../domain/dashboard';
import { DashboardDocument } from '../../layouts/DashboardDocument';
import { AppNav } from '../../components/navigation/AppNav';
import { LatestRunCard } from './LatestRunCard';
import { QualityOverview } from './QualityOverview';
import { QualityTrend } from './QualityTrend';
import { RecentRuns } from './RecentRuns';
import { AttentionPanel } from './AttentionPanel';
import { FlakyTestsPanel } from './FlakyTestsPanel';
import { AiInsightsPanel } from './AiInsightsPanel';
import { FailureSourceMixPanel } from './FailureSourceMixPanel';
import { ModuleHealthPanel } from './ModuleHealthPanel';
import { SaveRunModal } from '../history/SaveRunModal';
import { ConfirmDeleteModal } from '../history/ConfirmDeleteModal';
import { buildHistoryJs } from '../../build-history-view';

export interface DashboardPageProps {
  overview: DashboardOverviewData;
  serveMode?: boolean;
}

/**
 * Quality overview — arranged as a workspace, not a card stack.
 *
 * Reading order follows what QA actually does when the page opens:
 *   1. Verdict strip: did the last run pass? (one line, full width)
 *   2. Main column: what needs attention, then the trend that says whether it
 *      is getting better or worse.
 *   3. Rail: the run ledger, module health, failure mix, and AI insights —
 *      context you consult rather than act on.
 *
 * The rail is a single bordered column so the page reads as two regions
 * instead of eight independent boxes.
 */
export function DashboardPage({ overview, serveMode = true }: DashboardPageProps) {
  const safeHistoryJs = buildHistoryJs({ serveMode });

  return (
    <DashboardDocument pageTitle="QA Dashboard · QA Playwright Kit" includeChart={false}>
      {serveMode && <AppNav activeTab="dashboard" />}

      <section class="page-section dashboard-overview-page" id="dashboard-overview-page">
        <div class="section-header">
          <div>
            <h1 class="section-title">Quality health</h1>
            <p class="section-subtitle">
              Latest execution, cross-run trend, and the items that need triage.
            </p>
          </div>
        </div>

        <LatestRunCard latestRun={overview.latestRun} />

        {/* The card badge already carries the verdict; this banner appears only
            when it has something extra to say — that the gate is not satisfied. */}
        {overview.latestRun?.analysisVerdict &&
        overview.latestRun.analysisVerdict !== 'not-applicable' &&
        !overview.latestRun.analysisVerified ? (
          <div class="analysis-status-banner" role="status">
            <span
              class={`analysis-badge analysis-badge--${overview.latestRun.analysisVerdict}`}
              safe
            >
              AI analysis: {overview.latestRun.analysisVerdict}
            </span>
            <span class="muted">Review gate evidence before APPROVE.</span>
          </div>
        ) : null}

        <QualityOverview metrics={overview.metrics} />

        <div class="workspace">
          <div class="workspace__main">
            <AttentionPanel recurringFailures={overview.recurringFailures} />
            <QualityTrend trendPoints={overview.passRateTrend} />
          </div>

          <aside class="workspace__rail" aria-label="Run context">
            <RecentRuns recentRuns={overview.recentRuns} />
            {/* The flaky count is a number; the names are the next question QA
                asks, so the list lives here rather than only in the detail. */}
            <FlakyTestsPanel flakyTests={overview.flakyTests} />
            <ModuleHealthPanel modules={overview.moduleHealth} />
            <FailureSourceMixPanel
              mix={overview.failureSourceMix}
              totalFailures={overview.metrics.recentFailuresCount}
            />
            <AiInsightsPanel insights={overview.aiRunInsights} />
          </aside>
        </div>
      </section>

      <SaveRunModal
        defaultLabel={overview.latestRun?.displayName}
        defaultSeries={overview.latestRun?.testSeriesId}
      />
      <ConfirmDeleteModal />

      {safeHistoryJs}
    </DashboardDocument>
  );
}
