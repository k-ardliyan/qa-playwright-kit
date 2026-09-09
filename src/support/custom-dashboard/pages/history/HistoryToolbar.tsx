/** @jsxImportSource @kitajs/html */
import { IconSearch } from '../../components/shared/icons';

export interface HistoryToolbarProps {
  totalCount: number;
  environments?: string[];
  decisions?: string[];
  /** Deep-link: initial search text (?q=). */
  initialQuery?: string;
  /** Deep-link: preselected env filter (?env=). */
  initialEnv?: string;
  /** Deep-link: preselected decision filter (?decision=). */
  initialDecision?: string;
}

export function HistoryToolbar({
  totalCount,
  environments = [],
  decisions = [],
  initialQuery = '',
  initialEnv = '',
  initialDecision = '',
}: HistoryToolbarProps) {
  return (
    <div class="table-toolbar history-toolbar">
      <div class="toolbar-search">
        <span class="search-icon-wrapper">
          <IconSearch size={14} />
        </span>
        <input
          type="search"
          class="cmd-input search-input"
          id="history-search"
          value={initialQuery}
          placeholder="Filter by label, requirement, or run ID… (Press '/' to focus)"
          oninput="filterHistory && filterHistory()"
          aria-label="Filter runs"
        />
      </div>

      {environments.length > 0 && (
        <label class="filter-group">
          <span class="filter-label">Env:</span>
          <select
            class="cmd-select"
            id="filter-history-env"
            onchange="filterHistory && filterHistory()"
          >
            <option value="">All Environments</option>
            {environments.map((env) => (
              <option value={env} selected={env === initialEnv} safe>
                {env}
              </option>
            ))}
          </select>
        </label>
      )}

      {decisions.length > 0 && (
        <label class="filter-group">
          <span class="filter-label">Decision:</span>
          <select
            class="cmd-select"
            id="filter-history-decision"
            onchange="filterHistory && filterHistory()"
          >
            <option value="">All Decisions</option>
            {decisions.map((dec) => (
              <option value={dec} selected={dec === initialDecision} safe>
                {dec}
              </option>
            ))}
          </select>
        </label>
      )}

      <span class="muted history-count font-mono" id="history-count">
        {totalCount} archived run{totalCount === 1 ? '' : 's'}
      </span>
    </div>
  );
}
