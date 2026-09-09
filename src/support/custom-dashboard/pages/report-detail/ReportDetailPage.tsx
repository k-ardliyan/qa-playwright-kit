/** @jsxImportSource @kitajs/html */
import type { CollectedTestData, TestSummary } from '../../types';
import { AccordionToolbar } from '../../components/detail/AccordionToolbar';
import { DashboardDocument } from '../../layouts/DashboardDocument';
import { AccordionView } from '../../components/detail/AccordionView';
import { TableToolbar } from '../../components/table/TableToolbar';
import { TableView } from '../../components/table/TableView';
import { ArtifactsStrip } from '../../components/dashboard/ArtifactsStrip';
import { FailureAlert } from '../../components/dashboard/FailureAlert';
import { Hero } from '../../components/dashboard/Hero';
import { RoleHealthStrip } from '../../components/dashboard/RoleHealthStrip';
import { ViewToggle } from '../../components/dashboard/ViewToggle';
import { AppNav } from '../../components/navigation/AppNav';
import { Breadcrumb } from '../../components/navigation/Breadcrumb';
import { SaveRunModal } from '../history/SaveRunModal';
import { EditRunModal } from '../history/EditRunModal';
import { ConfirmDeleteModal } from '../history/ConfirmDeleteModal';
import { TriageStrip } from '../../components/detail/TriageStrip';
import { groupUnhealthyTests, dominantSuggestedDecision } from '../../domain/triage';
import { IconSave } from '../../components/shared/icons';
import { buildHistoryJs } from '../../build-history-view';

const UNHEALTHY_STATUSES = new Set(['failed', 'timedOut', 'interrupted']);

const MODE_COPY: Record<'ci' | 'local', { title: string; copy: string }> = {
  ci: {
    title: 'Playwright Custom Dashboard (CI Detailed)',
    copy: 'CI incident board. Unhealthy cases surface first so engineers can isolate regression paths fast.',
  },
  local: {
    title: 'Playwright Custom Dashboard (Local)',
    copy: 'Failure-first triage view for local debugging, reruns, and evidence review.',
  },
};

export interface ReportDetailPageProps {
  mode?: 'ci' | 'local';
  summary: TestSummary;
  collectedTests: CollectedTestData[];
  runId?: string;
  displayName?: string;
  isArchived?: boolean;
  hasLatestRun?: boolean;
  serveMode?: boolean;
  breadcrumb?: Array<{ label: string; href?: string }>;
  /** Deep-link: initial view mode (?view=table|accordion). Default table. */
  view?: string;
  /** Deep-link: pre-expand + scroll to this test id (?test=<testId>). */
  testAnchor?: string;
}

export function ReportDetailPage({
  mode = 'local',
  summary,
  collectedTests = [],
  runId,
  displayName,
  isArchived = false,
  hasLatestRun = false,
  serveMode = false,
  breadcrumb,
  view = 'table',
  testAnchor,
}: ReportDetailPageProps) {
  const tests = Array.isArray(collectedTests) ? collectedTests : [];
  const unhealthyCount = tests.filter((t) => UNHEALTHY_STATUSES.has(t.status)).length;
  const triageGroups = groupUnhealthyTests(tests as unknown as Array<Record<string, unknown>>);
  const suggestedDecision = dominantSuggestedDecision(
    tests as unknown as Array<Record<string, unknown>>,
  );
  const accordionActive = view === 'accordion';
  const { title, copy } = MODE_COPY[mode];

  const defaultBreadcrumbs = breadcrumb || [
    { label: 'Dashboard', href: '/dashboard' },
    { label: displayName || runId || 'Report Detail' },
  ];

  const safeAccordionToolbar = <AccordionToolbar />;
  const safeHistoryJs = buildHistoryJs({ serveMode });

  return (
    <DashboardDocument
      pageTitle={`${displayName ? `${displayName} · ` : ''}${title}`}
      summary={summary}
      includeChart={false}
    >
      {serveMode && (
        <AppNav activeTab="report" hasLatestRun={hasLatestRun} latestRunArchived={isArchived} />
      )}

      {serveMode && <Breadcrumb items={defaultBreadcrumbs} />}

      {summary.analysisVerdict ? (
        <div class="analysis-status-banner" role="status">
          <span
            class={`analysis-badge analysis-badge--${summary.analysisVerdict}`}
            title={
              summary.analysisVerified
                ? 'Analysis evidence verified'
                : 'Analysis incomplete or not verified'
            }
            safe
          >
            AI ANALYSIS: {summary.analysisVerdict.toUpperCase()}
          </span>
          {!summary.analysisVerified ? (
            <span class="muted">Review gate evidence before APPROVE.</span>
          ) : null}
        </div>
      ) : null}

      {hasLatestRun && !isArchived && (
        <div class="save-banner-top" id="save-banner">
          <div class="save-banner-top__content">
            <span class="save-banner-top__icon">
              <IconSave size={16} />
            </span>
            <span class="save-banner-top__text">
              {displayName ? <span safe>{displayName} — </span> : ''}Execution completed — not yet
              saved to history
            </span>
          </div>
          <div class="save-banner-top__actions">
            <button
              class="btn-save-primary"
              onclick="openSaveModal && openSaveModal()"
              type="button"
            >
              <IconSave size={14} />
              <span>Save to History</span>
            </button>
            <button
              class="btn-dismiss-sm"
              onclick="dismissSaveBanner && dismissSaveBanner()"
              type="button"
              aria-label="Dismiss"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      <SaveRunModal
        defaultLabel={displayName}
        defaultSeries={summary.testCases?.[0]?.module || summary.testCases?.[0]?.feature || ''}
        defaultDecision={suggestedDecision}
      />
      {isArchived ? <EditRunModal /> : null}
      <ConfirmDeleteModal />

      <script>{`window.__SERVE_MODE__ = ${serveMode};`}</script>
      {testAnchor ? (
        <script>
          {`document.addEventListener('DOMContentLoaded', function () {
  var target = document.getElementById('test-' + ${JSON.stringify(testAnchor)});
  if (target) target.scrollIntoView({ block: 'start' });
});`}
        </script>
      ) : null}

      <div id="primary-view">
        <Hero mode={mode} summary={summary} collectedTests={tests} />
        <RoleHealthStrip summary={summary} collectedTests={tests} />
        <FailureAlert unhealthyCount={unhealthyCount} />

        {triageGroups.length > 0 ? (
          <TriageStrip groups={triageGroups} isArchived={isArchived} />
        ) : null}

        {isArchived && runId ? (
          <script>{`window.__TRIAGE_RUN_ID__ = ${JSON.stringify(runId)};`}</script>
        ) : null}

        <section class="command-zone" aria-label="View controls">
          <div class="section-head section-head--toolbar">
            <div>
              <h2 class="section-title">Detailed test records</h2>
              <div class="section-copy" safe>
                {copy}
              </div>
            </div>
            <ViewToggle />
          </div>
        </section>

        <TableToolbar collectedTests={tests} />
        {safeAccordionToolbar}

        <div class="report-layout">
          <section class="main-column">
            <section class="panel panel--bleed">
              <div
                id="view-accordion"
                class={`view-panel ${accordionActive ? 'view-panel--active' : 'view-panel--hidden'}`}
                role="tabpanel"
                aria-labelledby="tab-accordion"
                aria-hidden={accordionActive ? 'false' : 'true'}
              >
                <AccordionView collectedTests={tests} runId={runId} openTest={testAnchor} />
              </div>
              <div
                id="view-table"
                class={`view-panel ${accordionActive ? 'view-panel--hidden' : 'view-panel--active'}`}
                role="tabpanel"
                aria-labelledby="tab-table"
                aria-hidden={accordionActive ? 'true' : 'false'}
              >
                <TableView summary={summary} collectedTests={tests} runId={runId} />
              </div>
            </section>
          </section>
        </div>

        <p class="results-footer" id="results-footer">
          Total {tests.length} results
        </p>

        <ArtifactsStrip collectedTests={tests} runId={runId} />
      </div>

      {safeHistoryJs}
    </DashboardDocument>
  );
}
