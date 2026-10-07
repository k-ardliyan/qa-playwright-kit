/** @jsxImportSource @kitajs/html */
import { statusIcon } from '../table/TableCells';

const UNHEALTHY_STATUSES = new Set(['failed', 'timedOut', 'interrupted']);

export interface StatusPillProps {
  status: string;
  showIcon?: boolean;
  /** Per-scenario reason (fixme/skip annotation) overriding the static hint. */
  hint?: string;
}

export function StatusPill({ status, showIcon = false, hint }: StatusPillProps) {
  const normalized = status || 'unknown';
  const isUnhealthy = UNHEALTHY_STATUSES.has(normalized);
  const isSkipped = normalized === 'skipped';
  const isNotImplemented = normalized === 'not-implemented';
  const isPassed = normalized === 'passed';

  // Unknown statuses deliberately get no tone class — they must not borrow a
  // passing green. `not-implemented` has its own tone so unbuilt work reads
  // as unfinished rather than as a neutral skip.
  const toneCls = isUnhealthy
    ? 'status-pill--failed'
    : isSkipped
      ? 'status-pill--skipped'
      : isNotImplemented
        ? 'status-pill--not-implemented'
        : isPassed
          ? 'status-pill--passed'
          : '';

  const label = isNotImplemented ? 'Belum dibangun' : normalized;
  const staticHint = isNotImplemented
    ? 'Direncanakan tapi belum dibuat — utang kerja, bukan skip. Bukan kegagalan.'
    : isSkipped
      ? 'Tidak berlaku untuk otomasi (CAPTCHA, OTP fisik, biometric) — memang tidak dijalankan.'
      : undefined;
  const effectiveHint = hint?.trim() ? hint.trim() : staticHint;

  return (
    <span
      class={`status-pill ${toneCls}`}
      role="img"
      aria-label={`Status: ${label}`}
      title={effectiveHint}
    >
      {showIcon && (
        <span class="status-pill__icon" aria-hidden="true">
          {statusIcon(normalized)}
        </span>
      )}
      <span safe>{label}</span>
    </span>
  );
}
