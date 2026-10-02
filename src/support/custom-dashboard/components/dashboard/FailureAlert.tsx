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
}

export function FailureAlert({ unhealthyCount }: FailureAlertProps) {
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
    </div>
  );
}
