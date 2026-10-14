/** @jsxImportSource @kitajs/html */
import { IconShieldAlert, IconMinus } from '../../components/shared/icons';

export interface FlakyTestsPanelProps {
  /** Titles of latest-run tests that passed only after a retry. */
  flakyTests: string[];
}

/**
 * The flaky list behind the "Flaky" count.
 *
 * The count alone answers "is there a problem"; the names answer "which test",
 * which is the next question QA asks. A test that passes only on retry is
 * passing by luck — it is the most actionable signal on the page, so the names
 * belong on the overview rather than buried in the run's detail.
 */
export function FlakyTestsPanel({ flakyTests }: FlakyTestsPanelProps) {
  const names = flakyTests.slice(0, 8);
  const overflow = flakyTests.length - names.length;

  return (
    <div class="panel health-panel">
      <div class="panel-header">
        <h3 class="panel-title">
          <IconShieldAlert size={15} class="icon-neutral" />
          <span>Flaky tests</span>
        </h3>
        <span class="muted font-mono">{flakyTests.length} passed on retry</span>
      </div>

      {names.length === 0 ? (
        <p class="panel-empty">
          <span class="panel-empty__mark" aria-hidden="true">
            <IconMinus size={12} />
          </span>
          <span>No test passed only on a retry in the latest run.</span>
        </p>
      ) : (
        <ul class="flaky-list">
          {names.map((title) => (
            <li class="flaky-row">
              <span class="flaky-row__mark" aria-hidden="true">
                <IconShieldAlert size={12} />
              </span>
              <span class="flaky-row__title" safe>
                {title}
              </span>
            </li>
          ))}
          {overflow > 0 ? <li class="flaky-row flaky-row--more">+{overflow} more</li> : null}
        </ul>
      )}
    </div>
  );
}
