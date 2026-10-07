/** @jsxImportSource @kitajs/html */
import type { Children } from '@kitajs/html';
import type { CollectedTestData, FailureSource } from '../../types';
import { generateErrorFingerprint } from '../../../classifier/fingerprint';
import { escapeHtml, formatDuration } from '../../shared';
import {
  IconCircleCheck,
  IconCircleX,
  IconCircleSlash2,
  IconHammer,
  IconTimer,
  IconCircleHelp,
  IconPlay,
  IconSquarePen,
} from '../shared/icons';
import {
  decisionHintFor,
  decisionHintTooltipFor,
  decisionHintBlurbFor,
} from '../../failure-source';

/** Status → Lucide icon. One map so the table, the pill and the server-side
 *  twin (render-cells.ts) can never drift apart visually. */
export const STATUS_ICON_SIZE = 12;

export function statusIcon(status: string, size = STATUS_ICON_SIZE): Children {
  switch (status) {
    case 'passed':
      return <IconCircleCheck size={size} />;
    case 'timedOut':
      return <IconTimer size={size} />;
    case 'skipped':
      return <IconCircleSlash2 size={size} />;
    case 'not-implemented':
      // Hammer, not a pencil: the mark says "under construction" (unfinished
      // work). A pencil reads as "editable", which this status is not.
      return <IconHammer size={size} />;
    case 'failed':
    case 'interrupted':
      return <IconCircleX size={size} />;
    default:
      return <IconCircleHelp size={size} />;
  }
}

export function StatusBadge({ status, reason }: { status: string; reason?: string }) {
  // Labels are Indonesian to match the QA-facing AI notes that explain them —
  // `not-implemented` and `skipped` are the two statuses a non-coder most easily
  // confuses, so each carries a tooltip stating the difference outright.
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
    // Unknown statuses must not borrow the skipped chrome (that claims "not
    // applicable") — they render toneless and labeled honestly.
    cls: '',
    label: status && status !== 'unknown' ? `Tidak diketahui (${status})` : 'Tidak diketahui',
  };
  // Per-scenario annotation reason ("Butuh payroll berjalan sampai status
  // Dibayar") overrides the static hint so the tooltip answers "kenapa".
  const effectiveHint = reason?.trim() ? reason.trim() : entry.hint;

  return (
    <span
      class={`status-pill status-pill--full ${entry.cls}`}
      role="img"
      aria-label={`Status: ${entry.label}`}
      title={effectiveHint}
    >
      <span class="status-pill__icon" aria-hidden="true">
        {statusIcon(status)}
      </span>
      <span safe>{entry.label}</span>
    </span>
  );
}

export function PriorityBadgeCell({ priority }: { priority?: string }) {
  const map: Record<string, string> = {
    high: 'priority-badge--high',
    medium: 'priority-badge--medium',
    low: 'priority-badge--low',
  };
  const safePriority = (priority || '').toLowerCase();
  const cls = map[safePriority] ?? 'priority-badge--medium';
  const label = (priority || 'MEDIUM').toUpperCase();
  return (
    <span class={`priority-badge ${cls}`} role="img" aria-label={`Priority: ${label}`} safe>
      {label}
    </span>
  );
}

export function FailureSourceCell({
  test,
}: {
  test: { status: string; failureSource?: FailureSource; errorMessage?: string };
}) {
  if (!['failed', 'timedOut', 'interrupted'].includes(test.status) || !test.failureSource) {
    return <span class="muted">-</span>;
  }
  const src = test.failureSource;
  const hint = decisionHintFor(src);
  const tip = decisionHintTooltipFor(src, test.errorMessage ?? '');
  const blurb = decisionHintBlurbFor(src, test.errorMessage ?? '');
  const fp = test.errorMessage ? generateErrorFingerprint(test.errorMessage) : undefined;

  return (
    <div class="src-cell" title={tip}>
      <div class="src-cell__row">
        <span class="src-cell__k">Cause</span>
        <span class={`failure-source failure-source--${src}`} safe>
          {src.toUpperCase()}
        </span>
      </div>
      {fp ? (
        <div class="src-cell__row">
          <span class="src-cell__k">Hash</span>
          <span class="badge badge--local" title={fp.normalizedMessage} safe>
            {fp.fingerprintId}
          </span>
        </div>
      ) : null}
      <div class="src-cell__row">
        <span class="src-cell__k">Do</span>
        <span class="decision-hint" safe>
          {hint}
        </span>
      </div>
      <p class="src-cell__blurb" safe>
        {blurb}
      </p>
    </div>
  );
}

export function LayerBadges({ layers }: { layers?: string[] }) {
  if (!layers || layers.length === 0) return null;
  return (
    <>
      {layers.map((l) => (
        <span class={`layer-badge layer-badge--${l.toLowerCase()}`} safe>
          {l}
        </span>
      ))}
    </>
  );
}

export function InputDataCell({ inputData }: { inputData?: Record<string, string> }) {
  if (!inputData || typeof inputData !== 'object') return <span class="muted">-</span>;
  const entries = Object.entries(inputData);
  if (entries.length === 0) return <span class="muted">-</span>;

  return (
    <div class="input-flat">
      {entries.map(([k, v]) => (
        <div class="input-flat__pair">
          <span class="key" safe>
            {k}:
          </span>{' '}
          <span class="val" safe>
            {v}
          </span>
        </div>
      ))}
    </div>
  );
}

export function StepsCell({ steps }: { steps?: Array<{ title: string; subtitle?: string }> }) {
  if (!steps || steps.length === 0) return <span class="muted">-</span>;
  const visible = steps.filter(
    (s) => !s.title.startsWith('Before') && !s.title.startsWith('After'),
  );
  if (visible.length === 0) return <span class="muted">-</span>;

  return (
    <div class="steps-flat">
      {visible.map((s, i) => (
        <div class="steps-flat__item">
          <span class="steps-flat__n">{i + 1}.</span> <span safe>{s.title}</span>
          {s.subtitle ? (
            <span class="step-subtitle-badge" safe>
              {s.subtitle}
            </span>
          ) : null}
        </div>
      ))}
    </div>
  );
}

export function ActualResultCell({ test }: { test: CollectedTestData }) {
  const isUnhealthy = ['failed', 'timedOut', 'interrupted'].includes(test.status);
  const cls = isUnhealthy ? 'actual-result--failed' : 'actual-result--passed';
  const full = test.actualResult || '-';
  const lines = full.split(/\r\n|\n|\r/);

  return (
    <div class={cls}>
      {lines.map((line, index) => (
        <>
          {index > 0 ? <br /> : null}
          <span>{escapeHtml(line)}</span>
        </>
      ))}
    </div>
  );
}

export function MultilineTextCell({ text, class: className }: { text?: string; class: string }) {
  const full = text || '-';
  const lines = full.split(/\r\n|\n|\r/);
  return (
    <div class={className}>
      {lines.map((line, index) => (
        <>
          {index > 0 ? <br /> : null}
          <span>{escapeHtml(line)}</span>
        </>
      ))}
    </div>
  );
}

function encodeEvidencePath(relPath: string): string {
  if (relPath.startsWith('/')) return relPath.replace(/^\/+/, '');
  return relPath
    .replace(/\\/g, '/')
    .split('/')
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

export function NotesCell({ test, runId }: { test: CollectedTestData; runId?: string }) {
  const evidenceUrl = (relPath: string) => {
    if (relPath.startsWith('/')) return relPath;
    const encoded = encodeEvidencePath(relPath);
    return runId && /^run-[\d-]+$/.test(runId)
      ? `/api/archive/${encodeURIComponent(runId)}/${encoded}`
      : `/${encoded}`;
  };
  const screenshots = test.attachments.filter((a) => a.kind === 'screenshot' && a.relativePath);
  const videos = test.attachments.filter((a) => a.kind === 'video' && a.relativePath);
  const trace = test.attachments.find((a) => a.kind === 'trace' && a.relativePath);

  return (
    <div class="notes-cell">
      {test.scenarioId ? (
        <div class="notes-row notes-row--scenario">
          <code class="notes-scenario" title="Scenario ID" safe>
            {test.scenarioId}
          </code>
        </div>
      ) : null}
      {test.qaNotes ? (
        <div class="notes-row notes-row--qa">
          <span class="qa-note" title="Catatan QA" safe>
            {test.qaNotes}
          </span>
        </div>
      ) : null}
      <div class="notes-row notes-row--time">
        <span class="duration" title="Duration" safe>
          {formatDuration(test.duration)}
        </span>
        <button
          type="button"
          class="qa-note-edit"
          data-action="edit-qa-note"
          data-scenario-id={test.scenarioId || ''}
          data-test-id={test.testId || ''}
          data-role={test.role || ''}
          data-note={test.qaNotes || ''}
          data-run-id={runId || ''}
          data-test-label={test.testId || test.title}
          title="Tulis / edit catatan QA"
          aria-label={`Edit QA note for ${test.testId || test.title}`}
        >
          <IconSquarePen size={12} />
        </button>
      </div>
      {screenshots.length > 0 ? (
        <div class="notes-row notes-row--screenshot">
          <a
            href={evidenceUrl(screenshots[0].relativePath)}
            target="_blank"
            rel="noopener noreferrer"
            class="evidence-thumb"
            title="Screenshot"
            data-media-preview="image"
            data-media-name={screenshots[0].name}
            aria-label={`Open screenshot evidence: ${screenshots[0].name}`}
          >
            <img
              src={evidenceUrl(screenshots[0].relativePath)}
              alt={`Evidence preview: ${screenshots[0].name}`}
              loading="lazy"
              onerror="this.closest('a')?.classList.add('evidence-missing')"
            />
            <span class="evidence-missing-label" aria-hidden="true">
              Missing image
            </span>
          </a>
          {screenshots.length > 1 ? (
            <span class="evidence-more" title={`${screenshots.length - 1} more screenshots`}>
              +{screenshots.length - 1}
            </span>
          ) : null}
        </div>
      ) : null}
      {videos.length > 0 ? (
        <div class="notes-row notes-row--video">
          {/* A real <video> frame, not a text chip: the two evidence kinds used
              to look unlike each other, and a thumbnail shows WHAT was recorded.
              The href stays real so middle-click and no-JS still reach the file. */}
          <a
            class="evidence-thumb evidence-thumb--video"
            href={evidenceUrl(videos[0].relativePath)}
            target="_blank"
            rel="noopener noreferrer"
            title="Video"
            data-media-preview="video"
            data-media-name={videos[0].name}
            aria-label={`Preview video evidence: ${videos[0].name}`}
          >
            {/* KitaJS's HtmlVideoTag type carries neither `preload` nor
                `playsinline`; both are set from the client bundle instead.
                A failed src fires `error` on the video itself, so the thumb
                degrades to the same missing tile the screenshot uses. */}
            <video
              src={evidenceUrl(videos[0].relativePath)}
              muted
              aria-hidden="true"
              tabindex="-1"
              onerror="this.closest('a')?.classList.add('evidence-missing')"
            />
            <span class="evidence-missing-label" aria-hidden="true">
              Missing video
            </span>
            <span class="evidence-play" aria-hidden="true">
              <IconPlay size={14} />
            </span>
          </a>
        </div>
      ) : null}
      {trace ? (
        <div class="notes-row notes-row--trace">
          <a
            class="evidence-link"
            href={evidenceUrl(trace.relativePath)}
            target="_blank"
            rel="noopener noreferrer"
            title="Trace"
          >
            trace
          </a>
        </div>
      ) : null}
      {test.affectedLayer && test.affectedLayer.length > 0 ? (
        <div class="notes-row notes-row--badges">
          <LayerBadges layers={test.affectedLayer} />
        </div>
      ) : null}
    </div>
  );
}

const AI_NOTE_LINE = /^\[(healer|generator|reporter|analyzer)\]\s*(.*)$/;
const AI_NOTE_LABEL = /^(Observasi|Bukti|Dampak|Rekomendasi|Next Action|Jenis)\s*:\s*(.*)$/;

/**
 * AI NOTES cell — agent-authored narrative lines (prefixed with their source)
 * plus deterministic auto analysis lines, one per row. Structured insight
 * lines (Observasi/Bukti/…:) get a styled label prefix.
 */
export function AiNotesCell({ test }: { test: CollectedTestData }) {
  const text = (test.aiNotes || '').trim();
  if (!text) return <span class="muted">-</span>;
  const lines = text
    .split(/\r\n|\n|\r/)
    .map((l) => l.trim())
    .filter(Boolean);

  return (
    <div class="ai-notes-cell">
      {lines.map((line, i) => {
        const agent = line.match(AI_NOTE_LINE);
        const body = agent ? agent[2]! : line;
        const labeled = body.match(AI_NOTE_LABEL);
        if (labeled) {
          return (
            <div class={`ai-note ai-note--${agent ? 'agent' : 'auto'}`}>
              {agent ? (
                <span class={`ai-note-src ai-note-src--${agent[1]}`} safe>
                  {agent[1]}
                </span>
              ) : null}
              <span class="ai-note-label" safe>
                {labeled[1]}
              </span>
              <span safe>{labeled[2]}</span>
            </div>
          );
        }
        if (agent) {
          return (
            <div class="ai-note ai-note--agent">
              <span class={`ai-note-src ai-note-src--${agent[1]}`} safe>
                {agent[1]}
              </span>
              <span safe>{agent[2]}</span>
            </div>
          );
        }
        return (
          <div class={`ai-note ai-note--auto${i === 0 ? ' ai-note--first' : ''}`} safe>
            {line}
          </div>
        );
      })}
    </div>
  );
}
