/** @jsxImportSource @kitajs/html */
import type { ReportComparison, ScenarioDiff } from '../../domain/comparison';
import {
  DataTable,
  DataTableContainer,
  DataTableHead,
  DataTableRow,
  DataTableCell,
  DataTableEmpty,
} from '../../components/data-table';
import {
  IconCheck,
  IconCross,
  IconSkip,
  IconHealed,
  IconAlert,
  IconSwap,
  IconFlame,
  IconTrash,
} from '../../components/shared/icons';

export interface CompareDiffTableProps {
  comparison: ReportComparison;
}

function renderStatusIcon(status: string) {
  switch (status) {
    case 'passed':
      return <IconCheck size={12} />;
    case 'failed':
      return <IconCross size={12} />;
    case 'skipped':
      return <IconSkip size={12} />;
    case 'healed':
      return <IconHealed size={12} />;
    case 'removed':
      return <IconTrash size={12} />;
    default:
      return <span>—</span>;
  }
}

function getStatusClass(status: string) {
  switch (status) {
    case 'passed':
      return 'status-passed';
    case 'failed':
      return 'status-failed';
    case 'skipped':
      return 'status-skipped';
    case 'healed':
      return 'status-healed';
    case 'removed':
      return 'status-removed';
    default:
      return 'status-absent';
  }
}

export function CompareDiffTable({ comparison }: CompareDiffTableProps) {
  const allScenarios: ScenarioDiff[] = [
    ...comparison.regressions,
    ...comparison.fixes,
    ...comparison.newScenarios,
    ...comparison.removedScenarios,
    ...comparison.stableFailures,
    ...comparison.flakyScenarios,
  ];

  if (allScenarios.length === 0) {
    return (
      <DataTableEmpty
        message="No changes detected between runs."
        submessage="All scenarios maintained the exact same status and error state."
      />
    );
  }

  const changeLabels: Record<string, string> = {
    regression: 'Regression',
    fix: 'Fix',
    stable: 'Stable Failure',
    flaky: 'Flaky',
    new: 'New Scenario',
    removed: 'Removed',
  };

  return (
    <DataTableContainer>
      <DataTable variant="compare" id="compare-diff-table">
        <DataTableHead>
          <tr>
            <DataTableCell isHeader class="col-diff-change">
              Change
            </DataTableCell>
            <DataTableCell isHeader class="col-diff-id">
              Scenario ID
            </DataTableCell>
            <DataTableCell isHeader class="col-diff-name">
              Scenario Name
            </DataTableCell>
            <DataTableCell isHeader class="col-diff-role">
              Role
            </DataTableCell>
            <DataTableCell isHeader class="col-diff-mod">
              Module / Feature
            </DataTableCell>
            <DataTableCell isHeader class="col-diff-before">
              Baseline Status
            </DataTableCell>
            <DataTableCell isHeader class="col-diff-after">
              Candidate Status
            </DataTableCell>
            <DataTableCell isHeader class="col-diff-error">
              Error / Root Cause
            </DataTableCell>
          </tr>
        </DataTableHead>
        <tbody>
          {allScenarios.map((s) => {
            const label = changeLabels[s.change] || s.change;
            const diffClass = `diff-row diff-${s.change}`;

            const modFeat = [s.module, s.feature].filter(Boolean).join(' / ') || '—';

            const errorSnippet = s.currentError || '';
            const prevErrorSnippet = s.previousError ? `Fixed: ${s.previousError}` : '';

            return (
              <DataTableRow class={diffClass}>
                <DataTableCell class="diff-change-cell">
                  <span class="diff-badge">
                    {s.change === 'regression' ? (
                      <IconCross size={12} />
                    ) : s.change === 'fix' ? (
                      <IconCheck size={12} />
                    ) : s.change === 'stable' ? (
                      <IconAlert size={12} />
                    ) : s.change === 'flaky' ? (
                      <IconSwap size={12} />
                    ) : s.change === 'new' ? (
                      <IconFlame size={12} />
                    ) : (
                      <IconTrash size={12} />
                    )}
                    <span safe>{label}</span>
                  </span>
                </DataTableCell>
                <DataTableCell class="diff-id-cell font-mono">
                  <span safe>{s.scenarioId || '—'}</span>
                </DataTableCell>
                <DataTableCell class="diff-name-cell">
                  <strong safe>{s.name}</strong>
                </DataTableCell>
                <DataTableCell class="diff-role-cell">
                  {s.role ? (
                    <span class="role-tag" safe>
                      {s.role}
                    </span>
                  ) : (
                    '—'
                  )}
                </DataTableCell>
                <DataTableCell class="diff-mod-cell muted">
                  <span safe>{modFeat}</span>
                </DataTableCell>
                <DataTableCell class="diff-before-cell">
                  <span class={`status-pill ${getStatusClass(s.previousStatus)}`}>
                    {renderStatusIcon(s.previousStatus)} <span safe>{s.previousStatus}</span>
                  </span>
                </DataTableCell>
                <DataTableCell class="diff-after-cell">
                  <span class={`status-pill ${getStatusClass(s.currentStatus)}`}>
                    {renderStatusIcon(s.currentStatus)} <span safe>{s.currentStatus}</span>
                  </span>
                </DataTableCell>
                <DataTableCell class="diff-error-cell">
                  {errorSnippet ? (
                    <div class="error-snippet" safe>
                      {errorSnippet}
                    </div>
                  ) : prevErrorSnippet ? (
                    <div class="error-snippet error-fixed muted" safe>
                      {prevErrorSnippet}
                    </div>
                  ) : (
                    <span class="muted">—</span>
                  )}
                </DataTableCell>
              </DataTableRow>
            );
          })}
        </tbody>
      </DataTable>
    </DataTableContainer>
  );
}
