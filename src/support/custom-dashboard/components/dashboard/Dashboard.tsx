/** @jsxImportSource @kitajs/html */
import type { ReportHistoryEntry } from '../../../../agents/reporter/report-history';
import type { CollectedTestData, TestSummary } from '../../types';
import { buildHistoryJs, buildHistorySection, buildSaveModal } from '../../build-history-view';
import { buildHashRouterJs, renderHashNav } from '../../build-hash-router';
import { AccordionToolbar } from '../detail/AccordionToolbar';
import { jsonForScript } from '../../shared';
import { DashboardDocument } from '../../layouts/DashboardDocument';
import { AccordionView } from '../detail/AccordionView';
import { TableToolbar } from '../table/TableToolbar';
import { TableView } from '../table/TableView';
import { ArtifactsStrip } from './ArtifactsStrip';
import { FailureAlert } from './FailureAlert';
import { Hero } from './Hero';
import { InspectionDrawer, InspectionDrawerScript } from './InspectionDrawer';
import { RoleHealthStrip } from './RoleHealthStrip';
import { ViewToggle } from './ViewToggle';
import { IconSave } from '../shared/icons';
import { FilterEmpty } from '../shared/FilterEmpty';

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

export interface DashboardOptions {
  hasLatestRun?: boolean;
  latestRunArchived?: boolean;
  serveMode?: boolean;
}

export interface DashboardProps {
  mode: 'ci' | 'local';
  summary: TestSummary;
  collectedTests: CollectedTestData[];
  history?: ReportHistoryEntry[];
  options?: DashboardOptions;
}

export function Dashboard({
  mode,
  summary,
  collectedTests = [],
  history,
  options,
}: DashboardProps) {
  const tests = Array.isArray(collectedTests) ? collectedTests : [];
  const unhealthyCount = tests.filter((t) => UNHEALTHY_STATUSES.has(t.status)).length;
  const { title, copy } = MODE_COPY[mode];

  const hasLatestRun = options?.hasLatestRun ?? false;
  const latestRunArchived = options?.latestRunArchived ?? false;
  const serveMode = options?.serveMode ?? false;

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

  const safeHashNav = serveMode ? renderHashNav() : null;
  const safeSaveModal = buildSaveModal();
  const safeAccordionToolbar = <AccordionToolbar />;
  const safeHistorySection = !serveMode
    ? buildHistorySection(history ?? [], { hasLatestRun, latestRunArchived, serveMode })
    : null;
  const safeHistoryJs = buildHistoryJs({ serveMode });
  const safeHashRouterJs = serveMode ? buildHashRouterJs() : null;

  return (
    <DashboardDocument pageTitle={title} summary={summary} includeChart={false}>
      {safeHashNav}

      {hasLatestRun && !latestRunArchived && (
        <div class="save-banner-top" id="save-banner">
          <div class="save-banner-top__content">
            <span class="save-banner-top__icon">
              <IconSave size={16} />
            </span>
            <span class="save-banner-top__text">
              Execution completed — not yet saved to history
            </span>
          </div>
          <div class="save-banner-top__actions">
            <button class="btn-save-primary" onclick="openSaveModal()" type="button">
              <IconSave size={14} />
              <span>Save to History</span>
            </button>
            <button
              class="btn-dismiss-sm"
              onclick="dismissSaveBanner()"
              type="button"
              aria-label="Dismiss"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {safeSaveModal}
      <InspectionDrawer />

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

        <TableToolbar />
        {safeAccordionToolbar}

        <div class="report-layout">
          <section class="main-column">
            <section class="panel panel--bleed">
              <FilterEmpty />
              <div
                id="view-accordion"
                class="view-panel view-panel--hidden"
                role="tabpanel"
                aria-labelledby="tab-accordion"
                aria-hidden="true"
              >
                <AccordionView collectedTests={tests} />
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

        <ArtifactsStrip collectedTests={tests} />
      </div>

      <div id="frag-host" hidden aria-live="polite" />

      {safeHistorySection ? (
        <section
          class="view-panel static-history"
          id="view-history-static"
          aria-label="Report History"
        >
          {safeHistorySection}
        </section>
      ) : null}

      {safeHistoryJs}
      {safeHashRouterJs}
      <InspectionDrawerScript />
    </DashboardDocument>
  );
}
