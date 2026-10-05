/** @jsxImportSource @kitajs/html */
import {
  IconCircleCheck,
  IconTriangleAlert,
  IconFileText,
  IconTable,
  IconDownload,
} from '../shared/icons';

export interface FailureAlertProps {
  unhealthyCount: number;
  /**
   * Render the copy/download action row. The served latest page moves those
   * actions into the hero's Export/Copy menus and passes `false` so the alert
   * stays a pure message; the static report and archived detail keep them
   * here, where they are the only export path (they work fully client-side).
   */
  actions?: boolean;
}

export function FailureAlert({ unhealthyCount, actions }: FailureAlertProps) {
  const isHealthy = unhealthyCount === 0;

  return (
    <div
      class={`alert ${isHealthy ? 'alert--success' : 'alert--warning'}`}
      role={isHealthy ? 'status' : 'alert'}
      aria-live="polite"
      aria-atomic="true"
    >
      <div class="alert__body">
        <span class="alert__icon" aria-hidden="true">
          {isHealthy ? <IconCircleCheck size={16} /> : <IconTriangleAlert size={16} />}
        </span>
        <div class="alert__copy">
          {isHealthy ? (
            <>
              <strong>Queue clear.</strong>
              <span>No unhealthy tests were captured in this run.</span>
            </>
          ) : (
            <>
              <strong>Incident queue active.</strong>
              <span>
                {unhealthyCount} unhealthy test{unhealthyCount === 1 ? '' : 's'} surfaced in this
                run.
              </span>
              <span class="alert__context">
                Start with Status, Role, and Has evidence filters to triage.
              </span>
            </>
          )}
        </div>
      </div>
      {actions === false ? null : (
        <div class="alert__actions export-buttons" role="group" aria-label="Export options">
          <button class="btn btn--ghost btn--sm" id="btn-copy-confluence" type="button">
            <span class="btn__icon" aria-hidden="true">
              <IconFileText size={14} />
            </span>
            Copy for Confluence
          </button>
          <button class="btn btn--ghost btn--sm" id="btn-copy-tsv" type="button">
            <span class="btn__icon" aria-hidden="true">
              <IconTable size={14} />
            </span>
            Copy Data (TSV)
          </button>
          <button class="btn btn--primary btn--sm" id="btn-download-csv" type="button">
            <span class="btn__icon" aria-hidden="true">
              <IconDownload size={14} />
            </span>
            Download CSV
          </button>
        </div>
      )}
    </div>
  );
}
