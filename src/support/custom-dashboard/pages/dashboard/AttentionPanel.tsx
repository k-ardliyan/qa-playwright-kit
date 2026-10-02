/** @jsxImportSource @kitajs/html */
import type { RecurringFailure } from '../../domain/dashboard';
import { IconTriangleAlert, IconCircleX, IconCircleCheck } from '../../components/shared/icons';

export interface AttentionPanelProps {
  recurringFailures: RecurringFailure[];
}

/**
 * Recurring failures across recent runs — the triage queue.
 *
 * Each row is a link into the latest report. The failure source chip carries
 * the classification, so QA can tell an app bug from an environment problem
 * before opening the run.
 */
export function AttentionPanel({ recurringFailures }: AttentionPanelProps) {
  if (!recurringFailures || recurringFailures.length === 0) {
    return (
      <div class="panel attention-panel">
        <div class="panel-header">
          <h3 class="panel-title">Attention</h3>
        </div>
        <p class="panel-empty">
          <span class="panel-empty__mark panel-empty__mark--ok" aria-hidden="true">
            <IconCircleCheck size={12} />
          </span>
          <span>No recurring failures.</span>
        </p>
      </div>
    );
  }

  return (
    <div class="panel attention-panel">
      <div class="panel-header">
        <h3 class="panel-title">
          <IconTriangleAlert size={15} class="icon-warning" />
          <span>Attention</span>
        </h3>
        <span class="muted font-mono">{recurringFailures.length}</span>
      </div>

      <div class="attention-list">
        {recurringFailures.map((item) => {
          const errorSnippet = item.lastErrorMessage
            ? item.lastErrorMessage.length > 140
              ? item.lastErrorMessage.slice(0, 140) + '…'
              : item.lastErrorMessage
            : '';

          return (
            <a class="attention-item" href="/latest">
              <div class="attention-item__header">
                <span class="attention-badge">
                  <IconCircleX size={11} />
                  <span>Failed</span>
                </span>
                {/* The count is what makes "recurring" a fact rather than a
                    label: a scenario seen once is a new break, seen three times
                    it is a pattern. */}
                <span class="attention-count font-mono muted">×{item.occurrences}</span>
                <strong class="attention-title" safe>
                  {item.title || item.scenarioId}
                </strong>
                {item.lastFailureSource ? (
                  <span class="source-tag" safe>
                    {item.lastFailureSource}
                  </span>
                ) : null}
              </div>
              {errorSnippet ? (
                <div class="attention-error" safe>
                  {errorSnippet}
                </div>
              ) : null}
            </a>
          );
        })}
      </div>
    </div>
  );
}
