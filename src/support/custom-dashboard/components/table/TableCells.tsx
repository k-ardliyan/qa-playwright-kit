/** @jsxImportSource @kitajs/html */
import type { CollectedTestData, FailureSource } from '../../types';
import { generateErrorFingerprint } from '../../../classifier/fingerprint';
import {
  decisionHintFor,
  decisionHintTooltipFor,
  decisionHintBlurbFor,
} from '../../failure-source';
import { escapeHtml } from '../../shared';

export function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { cls: string; icon: string; label: string }> = {
    passed: { cls: 'status-pill--passed', icon: '✓', label: 'Passed' },
    failed: { cls: 'status-pill--failed', icon: '✗', label: 'Failed' },
    timedOut: { cls: 'status-pill--failed', icon: '⏱', label: 'Timed out' },
    interrupted: { cls: 'status-pill--failed', icon: '✗', label: 'Interrupted' },
    skipped: { cls: 'status-pill--skipped', icon: '⊘', label: 'Skipped' },
  };
  const entry = map[status] ?? {
    cls: 'status-pill--skipped',
    icon: '?',
    label: status || 'Unknown',
  };

  return (
    <span class={`status-pill status-pill--full ${entry.cls}`}>
      <span class="status-pill__icon" safe>
        {entry.icon}
      </span>{' '}
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
  return (
    <span class={`priority-badge ${cls}`} safe>
      {(priority || 'MEDIUM').toUpperCase()}
    </span>
  );
}

export function FailureSourceCell({
  test,
}: {
  test: { failureSource?: FailureSource; errorMessage?: string };
}) {
  if (!test.failureSource) {
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

export function StepsCell({ steps }: { steps?: Array<{ title: string }> }) {
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
        </div>
      ))}
    </div>
  );
}

export function ActualResultCell({ test }: { test: CollectedTestData }) {
  const isUnhealthy = ['failed', 'timedOut', 'interrupted'].includes(test.status);
  const cls = isUnhealthy ? 'actual-result--failed' : 'actual-result--passed';
  const full = test.actualResult || '-';
  const safeHtml = escapeHtml(full).replace(/\r\n|\n|\r/g, '<br>');

  return <div class={cls}>{safeHtml}</div>;
}

export function MultilineTextCell({ text, class: className }: { text?: string; class: string }) {
  const full = text || '-';
  const safeHtml = escapeHtml(full).replace(/\r\n|\n|\r/g, '<br>');
  return <div class={className}>{safeHtml}</div>;
}

function formatDuration(ms: number): string {
  const safeMs = Number.isFinite(ms) ? ms : 0;
  return `${(safeMs / 1000).toFixed(2)}s`;
}

export function NotesCell({ test }: { test: CollectedTestData }) {
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
      <div class="notes-row notes-row--time">
        <span class="duration" title="Duration" safe>
          {formatDuration(test.duration)}
        </span>
      </div>
      {screenshots.length > 0 ? (
        <div class="notes-row notes-row--screenshot">
          <a
            href={screenshots[0].relativePath}
            target="_blank"
            rel="noopener noreferrer"
            class="evidence-thumb"
            title="Screenshot"
          >
            <img
              src={screenshots[0].relativePath}
              alt="screenshot"
              loading="lazy"
              onerror="this.closest('a')?.classList.add('evidence-missing')"
            />
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
          <a
            class="evidence-link"
            href={videos[0].relativePath}
            target="_blank"
            rel="noopener noreferrer"
            title="Video"
          >
            video
          </a>
        </div>
      ) : null}
      {trace ? (
        <div class="notes-row notes-row--trace">
          <a
            class="evidence-link"
            href={trace.relativePath}
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
