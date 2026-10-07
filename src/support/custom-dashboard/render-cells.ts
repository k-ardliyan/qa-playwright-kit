import type { FailureSource } from './types';
import { escapeHtml } from './shared';
import { statusIcon } from './components/table/TableCells';
import { decisionHintFor, decisionHintTooltipFor, decisionHintBlurbFor } from './failure-source';

// ---------------------------------------------------------------------------
// HTML rendering helpers used by build-table-view.ts and build-fragments.ts
// ---------------------------------------------------------------------------

export function renderStatusBadge(status: string, reason?: string): string {
  // Twin of the TSX StatusBadge — same labels and tooltips, never drift.
  const map: Record<string, { cls: string; label: string; hint?: string }> = {
    passed: { cls: 'status-pill--passed', label: 'Passed' },
    failed: { cls: 'status-pill--failed', label: 'Failed' },
    timedOut: { cls: 'status-pill--failed', label: 'Timed out' },
    interrupted: { cls: 'status-pill--failed', label: 'Interrupted' },
    skipped: {
      cls: 'status-pill--skipped',
      label: 'Skipped',
      hint: 'Tidak berlaku untuk otomasi (CAPTCHA, OTP fisik, biometric) — memang tidak dijalankan.',
    },
    'not-implemented': {
      cls: 'status-pill--not-implemented',
      label: 'Belum dibangun',
      hint: 'Direncanakan tapi belum dibuat — utang kerja, bukan skip. Bukan kegagalan.',
    },
  };
  const entry = map[status] ?? {
    // Twin of the TSX StatusBadge: unknown statuses render toneless and labeled
    // honestly, never borrowing the skipped chrome.
    cls: '',
    label: status && status !== 'unknown' ? `Tidak diketahui (${status})` : 'Tidak diketahui',
  };
  // A per-scenario annotation reason overrides the static hint, so the tooltip
  // answers "kenapa belum jalan" instead of repeating the generic definition.
  const effectiveHint = reason?.trim() ? reason.trim() : entry.hint;
  // Same icon source as the TSX StatusBadge — no drift between the two paths.
  const icon = String(statusIcon(status));
  const titleAttr = effectiveHint ? ` title="${escapeHtml(effectiveHint)}"` : '';
  return `<span class="status-pill status-pill--full ${entry.cls}" role="img" aria-label="Status: ${escapeHtml(entry.label)}"${titleAttr}><span class="status-pill__icon" aria-hidden="true">${icon}</span> <span>${escapeHtml(entry.label)}</span></span>`;
}

export function renderPriorityBadge(priority: string): string {
  const map: Record<string, string> = {
    high: 'priority-badge--high',
    medium: 'priority-badge--medium',
    low: 'priority-badge--low',
  };
  const safe = (priority || '').toLowerCase();
  const cls = map[safe] ?? 'priority-badge--medium';
  const label = (priority || 'MEDIUM').toUpperCase();
  return `<span class="priority-badge ${cls}" role="img" aria-label="Priority: ${escapeHtml(label)}">${escapeHtml(label)}</span>`;
}

export function renderFailureSourceCell(test: {
  status?: string;
  failureSource?: FailureSource;
  errorMessage?: string;
}): string {
  if (!['failed', 'timedOut', 'interrupted'].includes(test.status || '') || !test.failureSource) {
    return '<span class="muted">-</span>';
  }
  const src = test.failureSource;
  const hint = decisionHintFor(src);
  const tip = decisionHintTooltipFor(src, test.errorMessage ?? '');
  const blurb = decisionHintBlurbFor(src, test.errorMessage ?? '');
  return `<div class="src-cell" title="${escapeHtml(tip)}">
      <div class="src-cell__row">
        <span class="src-cell__k">Cause</span>
        <span class="failure-source failure-source--${escapeHtml(src)}">${escapeHtml(src.toUpperCase())}</span>
      </div>
      <div class="src-cell__row">
        <span class="src-cell__k">Do</span>
        <span class="decision-hint">${escapeHtml(hint)}</span>
      </div>
      <p class="src-cell__blurb">${escapeHtml(blurb)}</p>
    </div>`;
}

export function renderLayerBadges(layers: string[]): string {
  if (layers.length === 0) return '';
  return layers
    .map((l) => `<span class="layer-badge layer-badge--${l.toLowerCase()}">${escapeHtml(l)}</span>`)
    .join('');
}

export function renderInputDataCell(inputData: Record<string, string>): string {
  if (!inputData || typeof inputData !== 'object') return '<span class="muted">-</span>';
  const entries = Object.entries(inputData);
  if (entries.length === 0) return '<span class="muted">-</span>';
  // Multi-line key/value rows — no inline " · " join, no truncation
  return `<div class="input-flat">${entries
    .map(
      ([k, v]) =>
        `<div class="input-flat__pair"><span class="key">${escapeHtml(k)}:</span> <span class="val">${escapeHtml(v)}</span></div>`,
    )
    .join('')}</div>`;
}
