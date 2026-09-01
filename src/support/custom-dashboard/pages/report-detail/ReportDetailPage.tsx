/** @jsxImportSource @kitajs/html */
import type { CollectedTestData, TestSummary } from '../../types';
import { AccordionToolbar } from '../../components/detail/AccordionToolbar';
import { jsonForScript } from '../../shared';
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
import { ConfirmDeleteModal } from '../history/ConfirmDeleteModal';
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
}: ReportDetailPageProps) {
  const tests = Array.isArray(collectedTests) ? collectedTests : [];
  const unhealthyCount = tests.filter((t) => UNHEALTHY_STATUSES.has(t.status)).length;
  const { title, copy } = MODE_COPY[mode];

  const testDataMapJson = jsonForScript(
    tests.reduce(
      (acc, t, idx) => {
        const key = t.testId || `test-${idx}`;
        acc[key] = t;
        return acc;
      },
      {} as Record<string, CollectedTestData>,
    ),
  );

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
      />
      <ConfirmDeleteModal />

      <script>
        {`
      window.__TEST_DATA_MAP__ = ${testDataMapJson};
      window.__SERVE_MODE__ = ${serveMode};
        `}
      </script>

      <div id="primary-view">
        <Hero mode={mode} summary={summary} collectedTests={tests} />
        <RoleHealthStrip summary={summary} collectedTests={tests} />
        <FailureAlert unhealthyCount={unhealthyCount} />

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
                class="view-panel view-panel--hidden"
                role="tabpanel"
                aria-labelledby="tab-accordion"
                aria-hidden="true"
              >
                <AccordionView collectedTests={tests} runId={runId} />
              </div>
              <div
                id="view-table"
                class="view-panel view-panel--active"
                role="tabpanel"
                aria-labelledby="tab-table"
              >
                <TableView summary={summary} collectedTests={tests} />
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
