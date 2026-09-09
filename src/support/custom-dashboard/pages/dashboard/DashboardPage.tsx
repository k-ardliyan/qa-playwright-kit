/** @jsxImportSource @kitajs/html */
import type { DashboardOverviewData } from '../../domain/dashboard';
import { DashboardDocument } from '../../layouts/DashboardDocument';
import { AppNav } from '../../components/navigation/AppNav';
import { LatestRunCard } from './LatestRunCard';
import { QualityOverview } from './QualityOverview';
import { QualityTrend } from './QualityTrend';
import { RecentRuns } from './RecentRuns';
import { AttentionPanel } from './AttentionPanel';
import { AiInsightsPanel } from './AiInsightsPanel';
import { FailureSourceMixPanel } from './FailureSourceMixPanel';
import { ModuleHealthPanel } from './ModuleHealthPanel';
import { SaveRunModal } from '../history/SaveRunModal';
import { ConfirmDeleteModal } from '../history/ConfirmDeleteModal';
import { buildHistoryJs } from '../../build-history-view';

export interface DashboardPageProps {
  overview: DashboardOverviewData;
  hasLatestRun?: boolean;
  latestRunArchived?: boolean;
  serveMode?: boolean;
}

export function DashboardPage({
  overview,
  hasLatestRun = false,
  latestRunArchived = false,
  serveMode = true,
}: DashboardPageProps) {
  const safeHistoryJs = buildHistoryJs({ serveMode });

  return (
    <DashboardDocument pageTitle="QA Dashboard · QA Playwright Kit" includeChart={false}>
      {serveMode && (
        <AppNav
          activeTab="dashboard"
          hasLatestRun={hasLatestRun}
          latestRunArchived={latestRunArchived}
        />
      )}

      <section class="page-section dashboard-overview-page" id="dashboard-overview-page">
        <div class="section-header">
          <div>
            <h1 class="section-title">QA Overview & Quality Health</h1>
            <p class="section-subtitle muted">
              Executive health overview across automated test suites, recent runs, and triage items.
            </p>
          </div>
        </div>

        <LatestRunCard latestRun={overview.latestRun} />
        {overview.latestRun?.analysisVerdict ? (
          <div class="analysis-status-banner" role="status">
            <span
              class={`analysis-badge analysis-badge--${overview.latestRun.analysisVerdict}`}
              safe
            >
              AI ANALYSIS: {overview.latestRun.analysisVerdict.toUpperCase()}
            </span>
            {!overview.latestRun.analysisVerified ? (
              <span class="muted">Review gate evidence before APPROVE.</span>
            ) : null}
          </div>
        ) : null}

        <QualityOverview metrics={overview.metrics} />

        <div class="dashboard-grid-layout">
          <div class="dashboard-grid-main">
            <QualityTrend trendPoints={overview.passRateTrend} />
            <RecentRuns recentRuns={overview.recentRuns} />
          </div>

          <div class="dashboard-grid-sidebar">
            <AttentionPanel recurringFailures={overview.recurringFailures} />
            <AiInsightsPanel insights={overview.aiRunInsights} />
          </div>
        </div>

        <div class="health-grid-layout">
          <FailureSourceMixPanel
            mix={overview.failureSourceMix}
            totalFailures={overview.metrics.recentFailuresCount}
          />
          <ModuleHealthPanel modules={overview.moduleHealth} />
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
