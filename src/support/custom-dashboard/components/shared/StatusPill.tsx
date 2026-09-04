/** @jsxImportSource @kitajs/html */
const UNHEALTHY_STATUSES = new Set(['failed', 'timedOut', 'interrupted']);

export interface StatusPillProps {
  status: string;
  showIcon?: boolean;
}

export function StatusPill({ status, showIcon = false }: StatusPillProps) {
  const normalized = status || 'unknown';
  const isUnhealthy = UNHEALTHY_STATUSES.has(normalized);
  const isSkipped = normalized === 'skipped';
  const isPassed = normalized === 'passed';

  const toneCls = isUnhealthy
    ? 'status-pill--failed'
    : isSkipped
      ? 'status-pill--skipped'
      : isPassed
        ? 'status-pill--passed'
        : '';

  const iconText = isUnhealthy ? '✕' : isSkipped ? '⊘' : '✓';

  return (
    <span class={`status-pill ${toneCls}`} role="img" aria-label={`Status: ${normalized}`}>
      {showIcon && (
        <span class="status-pill__icon" aria-hidden="true">
          {iconText}
        </span>
      )}
      <span safe>{normalized}</span>
    </span>
  );
}
