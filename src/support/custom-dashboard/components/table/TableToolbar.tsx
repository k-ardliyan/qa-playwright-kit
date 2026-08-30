/** @jsxImportSource @kitajs/html */
import type { CollectedTestData } from '../../types';
import { IconReset } from '../shared/icons';

export interface TableToolbarProps {
  collectedTests?: CollectedTestData[];
}

export function TableColumnPicker() {
  return (
    <div class="column-picker" id="column-picker">
      <button
        type="button"
        class="column-picker__btn"
        id="column-picker-btn"
        aria-haspopup="true"
        aria-expanded="false"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.8"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <rect x="3" y="4" width="5" height="16" rx="1" />
          <rect x="10" y="4" width="5" height="16" rx="1" />
          <rect x="17" y="4" width="5" height="16" rx="1" />
        </svg>
        Filter columns
      </button>
      <div class="column-picker__menu" id="column-picker-menu" role="menu" hidden>
        <div class="column-picker__body">
          <div class="column-picker__title">Visible columns</div>
          <label class="column-picker__item column-picker__item--locked">
            <input type="checkbox" data-col-toggle="testId" checked disabled /> Test ID
          </label>
          <label class="column-picker__item">
            <input type="checkbox" data-col-toggle="module" /> Module
          </label>
          <label class="column-picker__item">
            <input type="checkbox" data-col-toggle="feature" /> Feature
          </label>
          <label class="column-picker__item">
            <input type="checkbox" data-col-toggle="description" checked /> Description
          </label>
          <label class="column-picker__item">
            <input type="checkbox" data-col-toggle="steps" checked /> Test Step
          </label>
          <label class="column-picker__item">
            <input type="checkbox" data-col-toggle="input" checked /> Input Data
          </label>
          <label class="column-picker__item">
            <input type="checkbox" data-col-toggle="expected" checked /> Expected Result
          </label>
          <label class="column-picker__item">
            <input type="checkbox" data-col-toggle="actual" checked /> Actual Result
          </label>
          <label class="column-picker__item column-picker__item--locked">
            <input type="checkbox" data-col-toggle="status" checked disabled /> Status
          </label>
          <label class="column-picker__item">
            <input type="checkbox" data-col-toggle="priority" checked /> Priority
          </label>
          <label class="column-picker__item">
            <input type="checkbox" data-col-toggle="source" /> Source
          </label>
          <label class="column-picker__item">
            <input type="checkbox" data-col-toggle="notes" checked /> Notes
          </label>

          <div class="column-picker__title column-picker__title--section">Pin / sticky</div>
          <label
            class="column-picker__item"
            title="Keep header row visible while scrolling the table"
          >
            <input type="checkbox" id="pin-sticky-header" data-pin-sticky="header" checked />
            <span>
              Pin header <span class="column-picker__hint">sticky top</span>
            </span>
          </label>
          <label
            class="column-picker__item"
            title="Keep Test ID column visible while scrolling horizontally"
          >
            <input type="checkbox" id="pin-sticky-left" data-pin-sticky="left" checked />
            <span>
              Pin Test ID <span class="column-picker__hint">sticky left</span>
            </span>
          </label>
        </div>

        <div class="column-picker__actions">
          <button type="button" id="column-picker-show-all">
            Show all
          </button>
          <button type="button" id="column-picker-reset">
            Reset
          </button>
        </div>
      </div>
    </div>
  );
}

export function SortDropdown({ id = 'table-sort-select' }: { id?: string }) {
  return (
    <select class="sort-select cmd-select" id={id} aria-label="Sort test cases">
      <option value="default">Default order</option>
      <option value="status-fail-first">Status (fail first)</option>
      <option value="priority-high-first">Priority (high first)</option>
      <option value="duration-desc">Duration (longest first)</option>
    </select>
  );
}

export function TableToolbar({ collectedTests = [] }: TableToolbarProps = {}) {
  const tests = Array.isArray(collectedTests) ? collectedTests : [];

  const rawModules = tests
    .map((t) => (t.module || '').trim())
    .filter((m) => m && m !== '-' && m.toLowerCase() !== 'general');
  const distinctModules = Array.from(new Set(rawModules)).sort();

  const rawFeatures = tests
    .map((t) => (t.feature || '').trim())
    .filter((f) => f && f !== '-' && f.toLowerCase() !== 'general');
  const distinctFeatures = Array.from(new Set(rawFeatures)).sort();

  const rawPriorities = tests
    .map((t) => (t.priority || '').trim().toLowerCase())
    .filter((p) => p && p !== '-');
  const distinctPriorities = Array.from(new Set(rawPriorities));

  const showModuleFilter = distinctModules.length > 1;
  const showFeatureFilter = distinctFeatures.length > 1;
  const showPriorityFilter = distinctPriorities.length > 1;

  return (
    <div
      class="unified-toolbar"
      id="table-toolbar"
      data-toolbar-for="table"
      role="toolbar"
      aria-label="Unified Controls"
    >
      <div class="unified-toolbar__row">
        <label class="cmd-search-wrap" for="dash-search">
          <span class="cmd-search__icon" aria-hidden="true">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.8"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" />
            </svg>
          </span>
          <span class="sr-only">Search tests</span>
          <input
            id="dash-search"
            class="cmd-search"
            type="search"
            placeholder="Search test id, title, error, file..."
            autocomplete="off"
          />
        </label>

        <select id="filter-status" class="cmd-select" aria-label="Filter by status">
          <option value="">All statuses</option>
          <option value="failed">Failed / unhealthy</option>
          <option value="passed">Passed</option>
          <option value="skipped">Skipped</option>
        </select>

        {showPriorityFilter ? (
          <select id="filter-priority" class="cmd-select" aria-label="Filter by priority">
            <option value="">All priorities</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
        ) : null}

        {showModuleFilter ? (
          <select
            id="module-filter-select"
            class="sort-select cmd-select"
            aria-label="Filter by module"
          >
            <option value="">All modules</option>
            {distinctModules.map((m) => (
              <option value={m} safe>
                {m}
              </option>
            ))}
          </select>
        ) : null}

        {showFeatureFilter ? (
          <select
            id="feature-filter-select"
            class="sort-select cmd-select"
            aria-label="Filter by feature"
          >
            <option value="">All features</option>
            {distinctFeatures.map((f) => (
              <option value={f} safe>
                {f}
              </option>
            ))}
          </select>
        ) : null}

        <button
          type="button"
          class="btn-reset-filters"
          id="btn-reset-filters"
          data-action="reset-filters"
          title="Reset all active filters"
          aria-label="Reset all active filters"
          hidden
        >
          <IconReset size={13} class="icon-reset" />
          <span>Reset</span>
        </button>

        <div class="unified-toolbar__end">
          <SortDropdown id="table-sort-select" />
          <TableColumnPicker />
          <span class="filter-count" id="filter-count" aria-live="polite">
            Showing 0 of 0
          </span>
        </div>
      </div>
    </div>
  );
}
