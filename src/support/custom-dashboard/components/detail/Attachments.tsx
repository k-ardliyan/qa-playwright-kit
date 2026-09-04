/** @jsxImportSource @kitajs/html */
import type { CollectedAttachment } from '../../types';
import { EmptyState } from '../shared/EmptyState';

export interface AttachmentsProps {
  attachments: CollectedAttachment[];
  runId?: string;
}

function encodePath(relPath: string): string {
  return relPath
    .replace(/\\/g, '/')
    .split('/')
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

export function resolveAttachmentUrl(
  relPath: string | undefined,
  runId?: string,
): string | undefined {
  if (!relPath) return undefined;
  // Preserve server-normalized archive paths; encoding them again corrupts URLs.
  if (relPath.startsWith('/')) return relPath;
  const clean = encodePath(relPath);
  if (runId && /^run-[\d-]+$/.test(runId)) {
    return `/api/archive/${encodeURIComponent(runId)}/${clean}`;
  }
  return `/${clean}`;
}

function ScreenshotAttachment({
  attachment,
  runId,
}: {
  attachment: CollectedAttachment;
  runId?: string;
}) {
  if (!attachment.relativePath) {
    return (
      <div class="attachment-chip attachment-chip--missing" safe>
        Missing screenshot · {attachment.name || 'Unnamed file'}
      </div>
    );
  }

  const src = resolveAttachmentUrl(attachment.relativePath, runId);

  return (
    <figure
      class="attachment-card attachment-card--screenshot"
      aria-label={`Screenshot evidence: ${attachment.name || 'unnamed file'}`}
    >
      <img
        src={src}
        alt={`Screenshot evidence: ${attachment.name}`}
        loading="lazy"
        onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'attachment-chip attachment-chip--missing',role:'img',ariaLabel:'Missing screenshot',textContent:'Missing screenshot'}))"
      />
      <figcaption safe>{attachment.name || 'Unnamed attachment'}</figcaption>
    </figure>
  );
}

function VideoAttachment({
  attachment,
  runId,
}: {
  attachment: CollectedAttachment;
  runId?: string;
}) {
  if (!attachment.relativePath) {
    return (
      <div class="attachment-chip attachment-chip--missing" safe>
        Missing video · {attachment.name || 'Unnamed file'}
      </div>
    );
  }

  const src = resolveAttachmentUrl(attachment.relativePath, runId);

  return (
    <figure
      class="attachment-card attachment-card--video"
      aria-label={`Video evidence: ${attachment.name || 'unnamed file'}`}
    >
      <video controls aria-label={`Play video evidence: ${attachment.name || 'unnamed file'}`}>
        <source src={src} type={attachment.contentType} />
      </video>
      <figcaption safe>{attachment.name || 'Unnamed attachment'}</figcaption>
    </figure>
  );
}

function TraceAttachment({
  attachment,
  runId,
}: {
  attachment: CollectedAttachment;
  runId?: string;
}) {
  if (!attachment.relativePath) {
    return (
      <span class="attachment-chip attachment-chip--missing" safe>
        Missing trace · {attachment.name || 'Unnamed file'}
      </span>
    );
  }

  const href = resolveAttachmentUrl(attachment.relativePath, runId);

  return (
    <a
      class="attachment-chip attachment-chip--trace"
      href={href}
      target="_blank"
      rel="noopener"
      aria-label={`Open trace evidence: ${attachment.name}`}
      safe
    >
      Trace · {attachment.name}
    </a>
  );
}

function OtherAttachment({
  attachment,
  runId,
}: {
  attachment: CollectedAttachment;
  runId?: string;
}) {
  if (!attachment.relativePath) {
    return (
      <span class="attachment-chip attachment-chip--missing" safe>
        {attachment.name || 'Unnamed attachment'}
      </span>
    );
  }

  const href = resolveAttachmentUrl(attachment.relativePath, runId);

  return (
    <a
      class="attachment-chip"
      href={href}
      target="_blank"
      rel="noopener"
      download=""
      aria-label={`Download attachment: ${attachment.name}`}
      safe
    >
      {attachment.name || 'Download attachment'}
    </a>
  );
}

export function Attachments({ attachments, runId }: AttachmentsProps) {
  const items = attachments ?? [];
  if (items.length === 0) {
    return <EmptyState message="No attachments recorded." />;
  }

  const screenshots = items.filter((a) => a.kind === 'screenshot');
  const videos = items.filter((a) => a.kind === 'video');
  const traces = items.filter((a) => a.kind === 'trace');
  const others = items.filter((a) => a.kind === 'other');

  const mediaList = [...screenshots, ...videos];
  const chipList = [...traces, ...others];

  return (
    <>
      {mediaList.length > 0 && (
        <div class="attachment-grid">
          {mediaList.map((a) =>
            a.kind === 'screenshot' ? (
              <ScreenshotAttachment attachment={a} runId={runId} />
            ) : (
              <VideoAttachment attachment={a} runId={runId} />
            ),
          )}
        </div>
      )}
      {chipList.length > 0 && (
        <div class="attachment-chips">
          {chipList.map((a) =>
            a.kind === 'trace' ? (
              <TraceAttachment attachment={a} runId={runId} />
            ) : (
              <OtherAttachment attachment={a} runId={runId} />
            ),
          )}
        </div>
      )}
    </>
  );
}
