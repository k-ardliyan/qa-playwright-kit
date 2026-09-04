/** @jsxImportSource @kitajs/html */
import type { ReportHistoryEntry } from '../../../../agents/reporter/report-history';
import { IconCompare, IconSwap } from '../../components/shared/icons';

export interface ComparePickerProps {
  history: ReportHistoryEntry[];
  selectedBaseline?: string;
  selectedCandidate?: string;
  selectedSeries?: string;
}

export function ComparePicker({
  history,
  selectedBaseline,
  selectedCandidate,
  selectedSeries,
}: ComparePickerProps) {
  if (!history || history.length < 2) {
    return (
      <div class="compare-picker-empty">
        <p class="muted">
          Need at least 2 archived runs to perform a comparison. Save more runs via the History tab.
        </p>
      </div>
    );
  }

  const seriesList = [...new Set(history.map((h) => h.testSeriesId).filter(Boolean))] as string[];

  const defaultCandidate = selectedCandidate || '';
  const defaultBaseline = selectedBaseline || '';

  const candidateEntry = defaultCandidate
    ? history.find((h) => h.runId === defaultCandidate)
    : undefined;
  const baselineEntry = defaultBaseline
    ? history.find((h) => h.runId === defaultBaseline)
    : undefined;

  const candidateDisplay = candidateEntry
    ? `${candidateEntry.displayName || candidateEntry.runId} (${candidateEntry.appEnv} · ${candidateEntry.passRate}%)`
    : '';
  const baselineDisplay = baselineEntry
    ? `${baselineEntry.displayName || baselineEntry.runId} (${baselineEntry.appEnv} · ${baselineEntry.passRate}%)`
    : '';

  return (
    <>
      <form class="compare-picker-form" id="compare-picker-form" method="GET" action="/compare">
        {seriesList.length > 0 && (
          <div class="form-group picker-group picker-group--series">
            <label for="picker-series" class="form-label">
              Test Series
            </label>
            <select
              id="picker-series"
              name="series"
              class="cmd-select form-select"
              onchange="filterCompareRunsBySeries && filterCompareRunsBySeries()"
            >
              <option value="">All Series ({history.length} runs)</option>
              {seriesList.map((series) => (
                <option value={series} selected={selectedSeries === series} safe>
                  {series}
                </option>
              ))}
            </select>
          </div>
        )}

        <div class="form-group picker-group">
          <label for="input-baseline" class="form-label">
            Baseline (Earlier / Reference)
          </label>
          <div class="combobox" id="combobox-baseline" data-combobox-id="baseline">
            <div class="combobox__control">
              <input
                type="text"
                class="combobox__input cmd-input"
                id="input-baseline"
                placeholder="Search or select baseline run…"
                value={baselineDisplay}
                autocomplete="off"
                aria-expanded="false"
                aria-autocomplete="list"
                aria-controls="dropdown-baseline"
                aria-activedescendant=""
                role="combobox"
              />
              <button
                type="button"
                class="combobox__clear"
                id="clear-baseline"
                aria-label="Clear baseline selection"
                title="Clear"
                tabindex={-1}
              >
                ✕
              </button>
              <span class="combobox__chevron" aria-hidden="true">
                ▾
              </span>
            </div>
            <input
              type="hidden"
              name="baseline"
              id="picker-baseline"
              value={defaultBaseline}
              required
            />
            <div class="combobox__dropdown" id="dropdown-baseline" role="listbox" hidden>
              <div class="combobox__list">
                {history.map((entry) => {
                  const isSelected = entry.runId === defaultBaseline;
                  const itemLabel = `${entry.displayName || entry.runId} (${entry.appEnv} · ${entry.passRate}%)`;
                  const optionId = `option-baseline-${entry.runId}`;
                  const passClass =
                    entry.passRate >= 80
                      ? 'rate-good'
                      : entry.passRate >= 50
                        ? 'rate-warn'
                        : 'rate-bad';

                  return (
                    <div
                      class={`combobox__item ${isSelected ? 'is-selected' : ''}`}
                      data-run-id={entry.runId}
                      data-label={itemLabel}
                      data-series={entry.testSeriesId || ''}
                      data-env={entry.appEnv || ''}
                      data-search={`${entry.displayName || ''} ${entry.runId} ${entry.appEnv} ${entry.testSeriesId || ''} ${entry.passRate}%`.toLowerCase()}
                      id={optionId}
                      role="option"
                      aria-selected={isSelected ? 'true' : 'false'}
                      tabindex={-1}
                    >
                      <div class="combobox__item-main">
                        <div class="combobox__item-title" safe>
                          {entry.displayName || entry.runId}
                        </div>
                        <div class="combobox__item-meta muted">
                          <span class="env-tag" safe>
                            {entry.appEnv}
                          </span>
                          {entry.testSeriesId ? (
                            <span class="series-tag" safe>
                              {entry.testSeriesId}
                            </span>
                          ) : null}
                          {entry.savedAt ? (
                            <span safe>{new Date(entry.savedAt).toLocaleDateString('en-GB')}</span>
                          ) : null}
                        </div>
                      </div>
                      <div class="combobox__item-badge">
                        <span class={`font-mono ${passClass}`}>{entry.passRate}%</span>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div class="combobox__empty muted pad-12" hidden>
                No test runs match your search.
              </div>
            </div>
          </div>
        </div>

        <div class="picker-swap-wrap">
          <button
            type="button"
            class="btn-swap-runs btn-icon"
            id="btn-swap-picker"
            onclick="swapPickerRuns && swapPickerRuns()"
            title="Swap Baseline and Candidate"
            aria-label="Swap Baseline and Candidate"
          >
            <IconSwap size={16} />
          </button>
        </div>

        <div class="form-group picker-group">
          <label for="input-candidate" class="form-label">
            Candidate (Newer / Target)
          </label>
          <div class="combobox" id="combobox-candidate" data-combobox-id="candidate">
            <div class="combobox__control">
              <input
                type="text"
                class="combobox__input cmd-input"
                id="input-candidate"
                placeholder="Search or select candidate run…"
                value={candidateDisplay}
                autocomplete="off"
                aria-expanded="false"
                aria-autocomplete="list"
                aria-controls="dropdown-candidate"
                aria-activedescendant=""
                role="combobox"
              />
              <button
                type="button"
                class="combobox__clear"
                id="clear-candidate"
                aria-label="Clear candidate selection"
                title="Clear"
                tabindex={-1}
              >
                ✕
              </button>
              <span class="combobox__chevron" aria-hidden="true">
                ▾
              </span>
            </div>
            <input
              type="hidden"
              name="candidate"
              id="picker-candidate"
              value={defaultCandidate}
              required
            />
            <div class="combobox__dropdown" id="dropdown-candidate" role="listbox" hidden>
              <div class="combobox__list">
                {history.map((entry) => {
                  const isSelected = entry.runId === defaultCandidate;
                  const itemLabel = `${entry.displayName || entry.runId} (${entry.appEnv} · ${entry.passRate}%)`;
                  const optionId = `option-candidate-${entry.runId}`;
                  const passClass =
                    entry.passRate >= 80
                      ? 'rate-good'
                      : entry.passRate >= 50
                        ? 'rate-warn'
                        : 'rate-bad';

                  return (
                    <div
                      class={`combobox__item ${isSelected ? 'is-selected' : ''}`}
                      data-run-id={entry.runId}
                      data-label={itemLabel}
                      data-series={entry.testSeriesId || ''}
                      data-env={entry.appEnv || ''}
                      data-search={`${entry.displayName || ''} ${entry.runId} ${entry.appEnv} ${entry.testSeriesId || ''} ${entry.passRate}%`.toLowerCase()}
                      id={optionId}
                      role="option"
                      aria-selected={isSelected ? 'true' : 'false'}
                      tabindex={-1}
                    >
                      <div class="combobox__item-main">
                        <div class="combobox__item-title" safe>
                          {entry.displayName || entry.runId}
                        </div>
                        <div class="combobox__item-meta muted">
                          <span class="env-tag" safe>
                            {entry.appEnv}
                          </span>
                          {entry.testSeriesId ? (
                            <span class="series-tag" safe>
                              {entry.testSeriesId}
                            </span>
                          ) : null}
                          {entry.savedAt ? (
                            <span safe>{new Date(entry.savedAt).toLocaleDateString('en-GB')}</span>
                          ) : null}
                        </div>
                      </div>
                      <div class="combobox__item-badge">
                        <span class={`font-mono ${passClass}`}>{entry.passRate}%</span>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div class="combobox__empty muted pad-12" hidden>
                No test runs match your search.
              </div>
            </div>
          </div>
        </div>

        <div class="picker-actions">
          <button class="btn-save-primary" type="submit">
            <IconCompare size={15} />
            <span>Compare Runs</span>
          </button>
        </div>
      </form>

      <script>
        {`
(function () {
  function initCombobox(id) {
    var root = document.getElementById('combobox-' + id);
    if (!root) return;
    var input = document.getElementById('input-' + id);
    var hidden = document.getElementById('picker-' + id);
    var dropdown = document.getElementById('dropdown-' + id);
    var clearBtn = document.getElementById('clear-' + id);
    var chevron = root.querySelector('.combobox__chevron');
    var list = dropdown ? dropdown.querySelector('.combobox__list') : null;
    var empty = dropdown ? dropdown.querySelector('.combobox__empty') : null;
    var items = list ? Array.from(list.querySelectorAll('.combobox__item')) : [];
    var highlightedIndex = -1;

    function getSelectedLabel() {
      var sel = items.find(function (item) {
        return item.getAttribute('data-run-id') === (hidden ? hidden.value : '');
      });
      return sel ? sel.getAttribute('data-label') : '';
    }

    function openDropdown(showAll) {
      closeAllDropdowns(id);
      if (dropdown) {
        dropdown.hidden = false;
        input.setAttribute('aria-expanded', 'true');
        filterItems(Boolean(showAll));
      }
    }

    function closeDropdown() {
      if (dropdown) {
        dropdown.hidden = true;
        input.setAttribute('aria-expanded', 'false');
        clearHighlight();
        // Restore label if left partially typed without selecting
        var currentLabel = getSelectedLabel();
        if (currentLabel && input.value !== currentLabel) {
          input.value = currentLabel;
        }
      }
    }

    function toggleDropdown() {
      if (dropdown && !dropdown.hidden) {
        closeDropdown();
      } else {
        openDropdown(true);
        input.focus();
        input.select();
      }
    }

    function getSeriesFilter() {
      var seriesSelect = document.getElementById('picker-series');
      return seriesSelect ? seriesSelect.value : '';
    }

    function filterItems(showAll) {
      var query = (input.value || '').trim().toLowerCase();
      var series = getSeriesFilter();
      var selectedLabel = (getSelectedLabel() || '').toLowerCase();
      var isExactSelected = query === selectedLabel;
      var visibleCount = 0;

      items.forEach(function (item) {
        var matchesSeries = !series || item.getAttribute('data-series') === series;
        var searchStr = item.getAttribute('data-search') || '';
        var itemLabel = (item.getAttribute('data-label') || '').toLowerCase();
        var matchesQuery = showAll || isExactSelected || !query || searchStr.indexOf(query) !== -1 || itemLabel.indexOf(query) !== -1;
        var isVisible = matchesSeries && matchesQuery;
        item.style.display = isVisible ? '' : 'none';
        if (isVisible) visibleCount++;
      });

      if (empty) empty.hidden = visibleCount > 0;
      clearHighlight();
    }

    function selectItem(item) {
      if (!item) return;
      var runId = item.getAttribute('data-run-id');
      var label = item.getAttribute('data-label');
      if (hidden) hidden.value = runId;
      if (input) input.value = label;

      items.forEach(function (el) {
        var isTarget = el === item;
        el.classList.toggle('is-selected', isTarget);
        el.setAttribute('aria-selected', isTarget ? 'true' : 'false');
      });

      if (dropdown) {
        dropdown.hidden = true;
        input.setAttribute('aria-expanded', 'false');
        clearHighlight();
      }
    }

    function getVisibleItems() {
      return items.filter(function (item) {
        return item.style.display !== 'none';
      });
    }

    function clearHighlight() {
      highlightedIndex = -1;
      input.setAttribute('aria-activedescendant', '');
      items.forEach(function (item) {
        item.classList.remove('is-highlighted');
      });
    }

    function highlightItem(index) {
      var visible = getVisibleItems();
      if (visible.length === 0) return;
      items.forEach(function (item) { item.classList.remove('is-highlighted'); });
      if (index < 0) index = 0;
      if (index >= visible.length) index = visible.length - 1;
      highlightedIndex = index;
      var target = visible[index];
      target.classList.add('is-highlighted');
      input.setAttribute('aria-activedescendant', target.id || '');
      target.scrollIntoView({ block: 'nearest' });
    }

    input.addEventListener('focus', function () {
      openDropdown(true);
      setTimeout(function () { input.select(); }, 50);
    });

    input.addEventListener('click', function () {
      if (dropdown && dropdown.hidden) {
        openDropdown(true);
      }
    });

    input.addEventListener('input', function () {
      openDropdown(false);
      filterItems(false);
    });

    input.addEventListener('keydown', function (e) {
      var visible = getVisibleItems();
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (dropdown.hidden) {
          openDropdown(true);
        } else {
          highlightItem(highlightedIndex + 1);
        }
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (!dropdown.hidden) {
          highlightItem(highlightedIndex - 1);
        }
      } else if (e.key === 'Enter') {
        if (!dropdown.hidden && highlightedIndex >= 0 && visible[highlightedIndex]) {
          e.preventDefault();
          selectItem(visible[highlightedIndex]);
        }
      } else if (e.key === 'Escape') {
        closeDropdown();
      } else if (e.key === 'Tab') {
        if (!dropdown.hidden && highlightedIndex >= 0 && visible[highlightedIndex]) {
          selectItem(visible[highlightedIndex]);
        } else {
          closeDropdown();
        }
      }
    });

    if (chevron) {
      chevron.style.cursor = 'pointer';
      chevron.addEventListener('click', function (e) {
        e.stopPropagation();
        toggleDropdown();
      });
    }

    if (clearBtn) {
      clearBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        input.value = '';
        if (hidden) hidden.value = '';
        input.focus();
        openDropdown(true);
      });
    }

    items.forEach(function (item) {
      item.addEventListener('click', function (e) {
        e.stopPropagation();
        selectItem(item);
      });
    });
  }

  function closeAllDropdowns(exceptId) {
    ['baseline', 'candidate'].forEach(function (id) {
      if (id !== exceptId) {
        var dropdown = document.getElementById('dropdown-' + id);
        var input = document.getElementById('input-' + id);
        if (dropdown) dropdown.hidden = true;
        if (input) input.setAttribute('aria-expanded', 'false');
      }
    });
  }

  window.swapPickerRuns = function () {
    var baseHidden = document.getElementById('picker-baseline');
    var candHidden = document.getElementById('picker-candidate');
    var baseInput = document.getElementById('input-baseline');
    var candInput = document.getElementById('input-candidate');

    if (!baseHidden || !candHidden || !baseInput || !candInput) return;

    var tempVal = baseHidden.value;
    var tempText = baseInput.value;

    baseHidden.value = candHidden.value;
    baseInput.value = candInput.value;

    candHidden.value = tempVal;
    candInput.value = tempText;

    // Update selected states
    ['baseline', 'candidate'].forEach(function (id) {
      var hidden = document.getElementById('picker-' + id);
      var dropdown = document.getElementById('dropdown-' + id);
      if (hidden && dropdown) {
        var val = hidden.value;
        dropdown.querySelectorAll('.combobox__item').forEach(function (item) {
          var isMatch = item.getAttribute('data-run-id') === val;
          item.classList.toggle('is-selected', isMatch);
          item.setAttribute('aria-selected', isMatch ? 'true' : 'false');
        });
      }
    });
  };

  window.filterCompareRunsBySeries = function () {
    ['baseline', 'candidate'].forEach(function (id) {
      var dropdown = document.getElementById('dropdown-' + id);
      var hidden = document.getElementById('picker-' + id);
      var input = document.getElementById('input-' + id);
      var seriesSelect = document.getElementById('picker-series');
      var series = seriesSelect ? seriesSelect.value : '';

      if (!dropdown || !hidden || !input) return;

      var items = Array.from(dropdown.querySelectorAll('.combobox__item'));
      var firstMatching = null;
      var currentMatches = false;

      items.forEach(function (item) {
        var matches = !series || item.getAttribute('data-series') === series;
        item.style.display = matches ? '' : 'none';
        if (matches && !firstMatching) firstMatching = item;
        if (item.getAttribute('data-run-id') === hidden.value && matches) {
          currentMatches = true;
        }
      });

      if (!currentMatches && firstMatching) {
        hidden.value = firstMatching.getAttribute('data-run-id');
        input.value = firstMatching.getAttribute('data-label');
        items.forEach(function (item) {
          var isTarget = item === firstMatching;
          item.classList.toggle('is-selected', isTarget);
          item.setAttribute('aria-selected', isTarget ? 'true' : 'false');
        });
      }
    });
  };

  document.addEventListener('click', function (e) {
    if (!e.target.closest('.combobox')) {
      closeAllDropdowns();
    }
  });

  function setup() {
    initCombobox('baseline');
    initCombobox('candidate');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setup);
  } else {
    setup();
  }
})();
        `}
      </script>
    </>
  );
}
