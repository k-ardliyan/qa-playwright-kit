/** @jsxImportSource @kitajs/html */
import type { RecurringFailure } from '../../domain/dashboard';
import { IconAlert, IconCheck, IconCross } from '../../components/shared/icons';

export interface AttentionPanelProps {
  recurringFailures: RecurringFailure[];
}

export function AttentionPanel({ recurringFailures }: AttentionPanelProps) {
  if (!recurringFailures || recurringFailures.length === 0) {
    return (
      <div class="panel attention-panel">
        <div class="panel-header">
          <h3 class="panel-title">Quality Attention Items</h3>
        </div>
        <div class="attention-healthy">
          <span class="healthy-icon">
            <IconCheck size={28} />
          </span>
          <p>
            <strong>Zero recurring test failures detected!</strong>
          </p>
          <span class="muted">All test scenarios are healthy and passing.</span>
        </div>
      </div>
    );
  }

  return (
    <div class="panel attention-panel">
      <div class="panel-header">
        <div class="attention-header-title">
          <IconAlert size={16} class="icon-warning" />
          <h3 class="panel-title">Needs Attention ({recurringFailures.length})</h3>
        </div>
        <span class="muted font-mono">{recurringFailures.length} active</span>
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
                  <IconCross size={11} />
                  <span>FAILED</span>
                </span>
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
                <div class="attention-error font-mono muted" safe>
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
