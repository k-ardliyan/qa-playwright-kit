/** @jsxImportSource @kitajs/html */
import type { CollectedTestData } from '../../types';
import { EmptyState } from '../shared/EmptyState';
import { TestDetail } from './TestDetail';

export interface AccordionViewProps {
  collectedTests: CollectedTestData[];
  runId?: string;
}

const UNHEALTHY_STATUSES = new Set(['failed', 'timedOut', 'interrupted']);

function isUnhealthyStatus(status: string): boolean {
  return UNHEALTHY_STATUSES.has(status);
}

function buildStatusGroups(collectedTests: CollectedTestData[]): Array<{
  key: 'unhealthy' | 'passed' | 'skipped';
  title: string;
  copy: string;
  tests: CollectedTestData[];
}> {
  const unhealthy = collectedTests.filter((testData) => isUnhealthyStatus(testData.status));
  const passed = collectedTests.filter((testData) => testData.status === 'passed');
  const skipped = collectedTests.filter((testData) => testData.status === 'skipped');

  const groups: Array<{
    key: 'unhealthy' | 'passed' | 'skipped';
    title: string;
    copy: string;
    tests: CollectedTestData[];
  }> = [
    {
      key: 'unhealthy',
      title: 'Unhealthy tests',
      copy: 'Triage these failures, timeouts, and interruptions first.',
      tests: unhealthy,
    },
    {
      key: 'passed',
      title: 'Passed tests',
      copy: 'Healthy executions kept quieter for audit-only review.',
      tests: passed,
    },
    {
      key: 'skipped',
      title: 'Skipped tests',
      copy: 'Coverage gaps or intentionally deferred cases.',
      tests: skipped,
    },
  ];

  return groups.filter((group) => group.tests.length > 0);
}

export function AccordionView({ collectedTests, runId }: AccordionViewProps) {
  if (collectedTests.length === 0) {
    return <EmptyState message="No test records were captured." />;
  }

  const groups = buildStatusGroups(collectedTests);
  let runningIndex = 0;

  return (
    <>
      <div class="accordion-view" id="view-accordion-content">
        <div class="accordion-empty-notice" id="accordion-filter-empty" hidden>
          <div class="empty-state">
            <p class="empty-state__msg">No tests match these filters</p>
          </div>
        </div>
        <div class="test-groups" data-accordion-groups>
          {groups.map((group) => {
            const groupCards = group.tests.map((testData) => {
              const card = <TestDetail testData={testData} index={runningIndex} runId={runId} />;
              runningIndex += 1;
              return card;
            });

            return (
              <section class={`test-group test-group--${group.key}`} data-group-key={group.key}>
                <div class="test-group__header">
                  <div>
                    <h3 class="test-group__title" safe>
                      {group.title}
                    </h3>
                    <div class="test-group__copy" safe>
                      {group.copy}
                    </div>
                  </div>
                  <span class="badge badge--local">
                    {group.tests.length} item{group.tests.length === 1 ? '' : 's'}
                  </span>
                </div>
                <div class="test-accordion" data-accordion-list>
                  {groupCards}
                </div>
              </section>
            );
          })}
        </div>
      </div>
      <script>
        {`
    (function () {
      function initAccordionSort() {
        var sortEl = document.getElementById('accordion-sort-select');
        var root = document.getElementById('view-accordion');
        if (!sortEl || !root) return;

        var groupsRoot = root.querySelector('[data-accordion-groups]');
        if (!groupsRoot) return;

        var originalGroups = Array.prototype.slice.call(groupsRoot.children);
        var originalCardsByGroup = originalGroups.map(function (section) {
          var list = section.querySelector('[data-accordion-list]');
          return list ? Array.prototype.slice.call(list.children) : [];
        });

        function statusRank(s) {
          s = String(s || '').toLowerCase();
          if (s === 'failed' || s === 'timedout' || s === 'interrupted') return 0;
          if (s === 'skipped') return 1;
          if (s === 'passed') return 2;
          return 99;
        }
        function priorityRank(p) {
          p = String(p || '').toLowerCase();
          if (p === 'high') return 0;
          if (p === 'medium') return 1;
          if (p === 'low') return 2;
          return 99;
        }
        function durationMs(card) {
          var d = card.getAttribute('data-duration');
          if (d != null && d !== '') {
            var n = parseFloat(d);
            if (!isNaN(n)) return n;
          }
          var t = card.querySelector('.test-card__duration');
          if (!t) return 0;
          var text = String(t.textContent || '');
          var m = text.match(/([0-9]+(?:\\.[0-9]+)?)/);
          return m ? parseFloat(m[1]) : 0;
        }
        function renumber() {
          var cards = root.querySelectorAll('.test-card');
          for (var i = 0; i < cards.length; i++) {
            var idx = cards[i].querySelector('.test-card__index');
            if (idx) idx.textContent = (i + 1) + '.';
          }
        }

        function applySort(key) {
          if (key === 'default') {
            originalGroups.forEach(function (section, gi) {
              groupsRoot.appendChild(section);
              section.hidden = false;
              var list = section.querySelector('[data-accordion-list]');
              if (!list) return;
              (originalCardsByGroup[gi] || []).forEach(function (c) { list.appendChild(c); });
            });
            renumber();
            return;
          }

          var allCards = [];
          originalGroups.forEach(function (section) {
            var list = section.querySelector('[data-accordion-list]');
            if (!list) return;
            Array.prototype.slice.call(list.children).forEach(function (c) {
              if (c.classList && c.classList.contains('test-card')) allCards.push(c);
            });
          });

          allCards.sort(function (a, b) {
            if (key === 'status-fail-first') {
              var sr = statusRank(a.getAttribute('data-status')) - statusRank(b.getAttribute('data-status'));
              if (sr !== 0) return sr;
              return priorityRank(a.getAttribute('data-priority')) - priorityRank(b.getAttribute('data-priority'));
            }
            if (key === 'priority-high-first') {
              var pr = priorityRank(a.getAttribute('data-priority')) - priorityRank(b.getAttribute('data-priority'));
              if (pr !== 0) return pr;
              return statusRank(a.getAttribute('data-status')) - statusRank(b.getAttribute('data-status'));
            }
            if (key === 'duration-desc') {
              return durationMs(b) - durationMs(a);
            }
            return 0;
          });

          var firstList = null;
          originalGroups.forEach(function (section) {
            var list = section.querySelector('[data-accordion-list]');
            if (!list) return;
            if (!firstList) {
              firstList = list;
              section.hidden = false;
            } else {
              section.hidden = true;
            }
          });
          if (firstList) {
            allCards.forEach(function (c) { firstList.appendChild(c); });
          }
          renumber();
        }

        sortEl.addEventListener('change', function () {
          applySort(sortEl.value);
        });
      }

      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initAccordionSort);
      } else {
        initAccordionSort();
      }
    })();
        `}
      </script>
    </>
  );
}
