/** @jsxImportSource @kitajs/html */
import { Icon } from '../shared/Icon';

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
          <Icon name={isHealthy ? 'check' : 'warn'} />
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
            <Icon name="doc" />
          </span>
          Copy for Confluence
        </button>
        <button class="btn btn--ghost btn--sm" id="btn-copy-tsv" type="button">
          <span class="btn__icon" aria-hidden="true">
            <Icon name="table" />
          </span>
          Copy Data (TSV)
        </button>
        <button class="btn btn--primary btn--sm" id="btn-download-csv" type="button">
          <span class="btn__icon" aria-hidden="true">
            <Icon name="download" />
          </span>
          Download CSV
        </button>
      </div>
    </div>
  );
}
