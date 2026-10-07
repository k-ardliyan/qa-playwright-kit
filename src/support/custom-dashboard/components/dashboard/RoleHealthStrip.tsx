/** @jsxImportSource @kitajs/html */
import type { CollectedTestData, TestSummary } from '../../types';

export interface RoleHealthStripProps {
  summary: TestSummary;
  collectedTests: CollectedTestData[];
}

export function RoleHealthStrip({ summary, collectedTests }: RoleHealthStripProps) {
  if (summary?.reportMode !== 'role-aware' || !summary?.rolesInScope?.length) {
    return null;
  }

  const testsList = Array.isArray(collectedTests) ? collectedTests : [];

  return (
    <section class="role-health" aria-label="Pass rate by role">
      <p class="sr-only">
        Roles without captured tests are reported as No results, not as a failed pass rate.
      </p>
      {summary.rolesInScope.map((role) => {
        const tests = testsList.filter((t) => (t.role || '') === role);
        const passed = tests.filter((t) => t.status === 'passed').length;
        // Only tests that actually ran are scored — a role whose scenarios are
        // all skipped/unbuilt has no pass rate, not a 0% one.
        const ran = tests.filter(
          (t) => t.status !== 'skipped' && t.status !== 'not-implemented',
        ).length;
        const hasResults = ran > 0;
        const rate = hasResults ? Math.round((passed / ran) * 100) : null;
        const tone = !hasResults ? 'neutral' : rate! >= 90 ? 'good' : rate! >= 70 ? 'warn' : 'bad';
        const label = hasResults ? `${passed}/${ran} tests, ${rate}% passed` : 'No results';

        return (
          <div class={`role-health__chip role-health__chip--${tone}`} title={role}>
            <strong safe>{role}</strong>
            <span safe>{label}</span>
          </div>
        );
      })}
    </section>
  );
}
