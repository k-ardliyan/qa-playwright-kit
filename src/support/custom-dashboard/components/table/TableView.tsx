/** @jsxImportSource @kitajs/html */
import type { CollectedTestData, ReportMode, RoleGroup, TestSummary } from '../../types';
import {
  buildExportScript,
  toConfluenceHtml,
  toConfluenceMarkup,
  toCsv,
  toTsv,
} from '../../export-helpers';
import { toExportPayload } from '../../filter-attrs';
import { EmptyState } from '../shared/EmptyState';
import { TestRow } from './TestRow';

export interface TableViewProps {
  summary: TestSummary;
  collectedTests: CollectedTestData[];
}

function buildRoleGroups(tests: CollectedTestData[]): RoleGroup[] {
  const roleMap = new Map<string, CollectedTestData[]>();
  for (const test of tests) {
    const role = test.role || 'general';
    if (!roleMap.has(role)) roleMap.set(role, []);
    roleMap.get(role)!.push(test);
  }
  return [...roleMap.entries()].map(([role, roleTests]) => ({ role, tests: roleTests }));
}

function HeaderRow() {
  return (
    <tr>
      <th class="col-sticky-0" data-col="testId">
        TEST ID
      </th>
      <th data-col="module">MODULE</th>
      <th data-col="feature">FEATURE</th>
      <th data-col="description">DESCRIPTION</th>
      <th class="col-tertiary" data-col="steps">
        TEST STEP
      </th>
      <th class="col-secondary" data-col="input">
        INPUT DATA
      </th>
      <th class="col-secondary" data-col="expected">
        EXPECTED RESULT
      </th>
      <th data-col="actual">ACTUAL RESULT</th>
      <th data-col="status">STATUS</th>
      <th data-col="priority">PRIORITY</th>
      <th data-col="source">SOURCE</th>
      <th data-col="notes">NOTES</th>
    </tr>
  );
}

function TableEmptyFilterRow() {
  return (
    <tr class="tbl-empty-row" id="tbl-filter-empty" hidden>
      <td colspan="12" class="tbl-empty-cell">
        <div class="empty-state">
          <p class="empty-state__msg">No tests match these filters</p>
        </div>
      </td>
    </tr>
  );
}

function GeneralTable({ tests }: { tests: CollectedTestData[] }) {
  if (tests.length === 0) {
    return <EmptyState message="No test cases captured." />;
  }

  return (
    <div class="table-wrapper">
      <table class="qa-report-table data-table">
        <thead>
          <HeaderRow />
        </thead>
        <tbody>
          {tests.map((t, i) => (
            <TestRow test={t} rowKey={`${t.testId || 'row'}-${i}`} />
          ))}
          <TableEmptyFilterRow />
        </tbody>
      </table>
    </div>
  );
}

function RoleSection({ group }: { group: RoleGroup }) {
  const roleSlug = (group.role || 'general').toLowerCase().replace(/[^a-z0-9]/g, '_');
  const roleLabel = group.role === 'general' ? 'General' : group.role;

  return (
    <div class="role-section">
      <div class="role-section-header">
        <span safe>ROLE: {roleLabel.toUpperCase()}</span>
        <span class="role-section-count">
          {group.tests.length} test{group.tests.length !== 1 ? 's' : ''}
        </span>
      </div>
      <div class="table-wrapper">
        <table class="qa-report-table data-table">
          <thead>
            <HeaderRow />
          </thead>
          <tbody>
            {group.tests.map((t, i) => (
              <TestRow test={t} rowKey={`${roleSlug}__${t.testId || 'row'}-${i}`} />
            ))}
            <TableEmptyFilterRow />
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RoleAwareTable({ tests }: { tests: CollectedTestData[] }) {
  const groups = buildRoleGroups(tests);
  return (
    <>
      {groups.map((g) => (
        <RoleSection group={g} />
      ))}
    </>
  );
}

export function TableView({ summary, collectedTests }: TableViewProps) {
  const mode: ReportMode = summary?.reportMode ?? 'general';
  const tests = Array.isArray(collectedTests) ? collectedTests : [];
  const featureName = new Date().toISOString().slice(0, 10);
  const tsvData = toTsv(tests, mode);
  const csvData = toCsv(tests, mode);
  const confluenceData = toConfluenceMarkup(tests, mode);
  const confluenceHtml = toConfluenceHtml(tests, mode);
  const exportScript = buildExportScript(
    tsvData,
    csvData,
    confluenceData,
    confluenceHtml,
    featureName,
    toExportPayload(tests),
    mode,
  );

  return (
    <>
      <div class="table-view" id="view-table-content">
        {mode === 'role-aware' ? <RoleAwareTable tests={tests} /> : <GeneralTable tests={tests} />}
      </div>
      <script>
        {`
      (function () {
        var originalOrders = {};
        var panel = document.getElementById('view-table');
        if (panel) {
          var tables = Array.prototype.slice.call(panel.querySelectorAll('table.qa-report-table'));
          tables.forEach(function (tbl, tIdx) {
            var tbody = tbl.tBodies[0];
            if (tbody) {
              originalOrders[tIdx] = Array.prototype.slice.call(tbody.rows).map(function (r) { return r; });
            }
          });
        }

        function getTableValue(row, colIndex, sortKey) {
          var cell = row.cells[colIndex];
          if (!cell) return '';
          var text = (cell.textContent || cell.innerText || '').trim().toLowerCase();
          if (sortKey === 'duration') {
            var m = text.match(/([0-9]+[.]?[0-9]*)s/);
            return m ? parseFloat(m[1]) : 0;
          }
          return text;
        }

        function sortTable(table, sortKey, tableIndex) {
          var thead = table.tHead;
          var tbody = table.tBodies[0];
          if (!thead || !tbody) return;
          var headers = Array.prototype.slice.call(thead.rows[0].cells);
          var colMap = { status: -1, priority: -1, notes: -1 };
          headers.forEach(function (th, i) {
            var t = (th.textContent || '').trim().toUpperCase();
            if (t === 'STATUS') colMap.status = i;
            if (t === 'PRIORITY') colMap.priority = i;
            if (t === 'NOTES') colMap.notes = i;
          });
          if (sortKey === 'default' && originalOrders[tableIndex]) {
            originalOrders[tableIndex].forEach(function (row) { tbody.appendChild(row); });
            return;
          }
          var rows = Array.prototype.slice.call(tbody.rows);
          var statusOrder = { failed: 0, timedout: 0, interrupted: 0, skipped: 1, passed: 2 };
          var priorityOrder = { high: 0, medium: 1, low: 2 };
          rows.sort(function (a, b) {
            if (sortKey === 'status-fail-first') {
              var av = statusOrder[(a.getAttribute('data-status') || '').toLowerCase()] ?? 99;
              var bv = statusOrder[(b.getAttribute('data-status') || '').toLowerCase()] ?? 99;
              return av - bv;
            }
            if (sortKey === 'priority-high-first') {
              var av2 = priorityOrder[(a.getAttribute('data-priority') || '').toLowerCase()] ?? 99;
              var bv2 = priorityOrder[(b.getAttribute('data-priority') || '').toLowerCase()] ?? 99;
              return av2 - bv2;
            }
            if (sortKey === 'duration-desc') {
              return getTableValue(b, colMap.notes, 'duration') - getTableValue(a, colMap.notes, 'duration');
            }
            return 0;
          });
          rows.forEach(function (row) { tbody.appendChild(row); });
        }

        var sortSelect = document.getElementById('table-sort-select');
        if (sortSelect) {
          sortSelect.addEventListener('change', function () {
            var key = sortSelect.value;
            var panel2 = document.getElementById('view-table');
            if (!panel2) return;
            Array.prototype.slice.call(panel2.querySelectorAll('table.qa-report-table')).forEach(function (tbl, idx) {
              sortTable(tbl, key, idx);
            });
          });
        }

        ${exportScript}
      })();
        `}
      </script>
    </>
  );
}
