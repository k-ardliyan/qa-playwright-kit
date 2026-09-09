/** @jsxImportSource @kitajs/html */
import type { TriageGroup } from '../../domain/triage';
import { IconAlert } from '../shared/icons';

/**
 * Decision labels shown on triage action buttons. Keep in sync with the six
 * QA exit decisions (report-archive QA_DECISIONS) but human-readable.
 */
const DECISION_LABELS: Record<string, string> = {
  FILE_BUG: 'Set decision: FILE BUG',
  FIX_TEST: 'Set decision: FIX TEST',
  FIX_ENV: 'Set decision: FIX ENVIRONMENT',
  REVISE_REQUIREMENT: 'Set decision: REVISE REQUIREMENT',
  MARK_BLOCKED: 'Set decision: MARK BLOCKED',
  APPROVE: 'Set decision: APPROVE',
};

export interface TriageStripProps {
  groups: TriageGroup[];
  /** When true, the run is archived and editing targets the archive PATCH. */
  isArchived?: boolean;
}

/**
 * Failure triage strip — lists unhealthy tests grouped by failure source with
 * the suggested QA exit decision per group, so the reviewer can act in place
 * instead of cross-referencing hint text against a generic dropdown.
 */
export function TriageStrip({ groups, isArchived = false }: TriageStripProps) {
  if (!groups || groups.length === 0) return null;

  const total = groups.reduce((n, g) => n + g.count, 0);

  return (
    <section class="triage-strip" aria-label="Failure triage">
      <div class="triage-strip__head">
        <span class="triage-strip__title">
          <IconAlert size={15} class="icon-warning" />
          <h3 class="panel-title">Triage ({total})</h3>
        </span>
        <span class="muted">Suggested decisions come from the failure source of each group.</span>
      </div>

      <div class="triage-groups">
        {groups.map((group) => (
          <div class={`triage-group triage-group--${group.source}`}>
            <div class="triage-group__head">
              <span class={`source-tag failure-source--${group.source}`} safe>
                {group.source}
              </span>
              <span class="triage-group__count font-mono muted">
                {group.count} test{group.count === 1 ? '' : 's'}
              </span>
            </div>

            <ul class="triage-group__tests">
              {group.tests.slice(0, 5).map((t) => {
                const err = t.errorMessage
                  ? t.errorMessage.length > 140
                    ? `${t.errorMessage.slice(0, 140)}…`
                    : t.errorMessage
                  : '';
                return (
                  <li class="triage-test">
                    <span class="triage-test__title" safe>
                      {t.title}
                    </span>
                    {err ? (
                      <code class="triage-test__err font-mono" safe>
                        {err}
                      </code>
                    ) : null}
                    {(t.tracePath || t.screenshotPath || t.hasAttachment) && (
                      <span class="triage-test__evidence muted">
                        {t.hasAttachment || t.screenshotPath ? 'evidence' : ''}
                        {t.hasAttachment && t.tracePath ? ' · ' : ''}
                        {t.tracePath ? 'trace' : ''}
                      </span>
                    )}
                  </li>
                );
              })}
              {group.tests.length > 5 ? (
                <li class="triage-test triage-test--more muted">+{group.tests.length - 5} more</li>
              ) : null}
            </ul>

            <button
              type="button"
              class="btn-save-sm triage-set-decision"
              data-triage-decision={group.suggestedDecision}
              onclick={`applyTriageDecision && applyTriageDecision('${group.suggestedDecision}', ${String(isArchived)})`}
            >
              {DECISION_LABELS[group.suggestedDecision] ?? group.suggestedDecision}
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}
