/** @jsxImportSource @kitajs/html */
import type { ReportHistoryEntry } from '../../../../agents/reporter/report-history';
import type { ReportComparison } from '../../domain/comparison';
import { DashboardDocument } from '../../layouts/DashboardDocument';
import { AppNav } from '../../components/navigation/AppNav';
import { Breadcrumb } from '../../components/navigation/Breadcrumb';
import { ComparePicker } from './ComparePicker';
import { CompatibilityNotice } from './CompatibilityNotice';
import { ComparisonHeader } from './ComparisonHeader';
import { ComparisonStats } from './ComparisonStats';
import { CompareDiffTable } from './CompareDiffTable';
import { IconCompare } from '../../components/shared/icons';

export interface ComparePageProps {
  history: ReportHistoryEntry[];
  comparison?: ReportComparison | null;
  selectedBaseline?: string;
  selectedCandidate?: string;
  selectedSeries?: string;
  serveMode?: boolean;
  hasLatestRun?: boolean;
  latestRunArchived?: boolean;
}

export function ComparePage({
  history = [],
  comparison,
  selectedBaseline,
  selectedCandidate,
  selectedSeries,
  serveMode = true,
  hasLatestRun = false,
  latestRunArchived = false,
}: ComparePageProps) {
  const breadcrumbs = [{ label: 'Dashboard', href: '/dashboard' }, { label: 'Compare' }];

  if (comparison?.baseline?.displayName && comparison?.candidate?.displayName) {
    breadcrumbs.push({
      label: `${comparison.baseline.displayName} vs ${comparison.candidate.displayName}`,
    });
  }

  return (
    <DashboardDocument pageTitle="Compare Runs · QA Playwright Kit" includeChart={false}>
      {serveMode && (
        <AppNav
          activeTab="compare"
          hasLatestRun={hasLatestRun}
          latestRunArchived={latestRunArchived}
        />
      )}

      {serveMode && <Breadcrumb items={breadcrumbs} />}

      <section class="page-section compare-page" id="compare-page">
        <div class="section-header">
          <div>
            <h1 class="section-title">Compare Test Runs</h1>
            <p class="section-subtitle muted">
              Evaluate regressions, fixes, and pass rate delta between two test runs.
            </p>
          </div>
        </div>

        <div class="compare-picker-panel panel">
          <ComparePicker
            history={history}
            selectedBaseline={selectedBaseline}
            selectedCandidate={selectedCandidate}
            selectedSeries={selectedSeries}
          />
        </div>

        {comparison ? (
          <div class="compare-results-container" id="compare-results">
            <CompatibilityNotice
              compatibility={comparison.compatibility}
              isCandidateOlder={comparison.isCandidateOlder}
              baselineRunId={selectedBaseline || comparison.baselineRunId}
              candidateRunId={selectedCandidate || comparison.comparisonRunId}
            />

            <ComparisonHeader
              baseline={comparison.baseline}
              candidate={comparison.candidate}
              passRateDelta={comparison.passRateDelta}
            />

            <ComparisonStats summary={comparison.summary} />

            <div class="compare-diff-panel panel">
              <div class="panel-header">
                <h3 class="panel-title">Detailed Scenario Differences</h3>
                <span class="muted font-mono">
                  {comparison.summary.totalScenarios} scenario(s) compared
                </span>
              </div>
              <CompareDiffTable comparison={comparison} />
            </div>
          </div>
        ) : (
          <div class="compare-placeholder panel">
            <div class="compare-placeholder__inner">
              <div class="compare-placeholder__icon">
                <IconCompare size={32} />
              </div>
              <h3 class="compare-placeholder__title">Select test runs to compare</h3>
              <p class="compare-placeholder__desc muted">
                Pick a baseline run and a candidate run, then click <strong>Compare Runs</strong>.
              </p>
            </div>
          </div>
        )}
      </section>
    </DashboardDocument>
  );
}
