/** @jsxImportSource @kitajs/html */
import type { CollectedAttachment } from '../../types';
import { EmptyState } from '../shared/EmptyState';

export interface AttachmentsProps {
  attachments: CollectedAttachment[];
  runId?: string;
}

function resolveAttachmentUrl(relPath: string | undefined, runId?: string): string | undefined {
  if (!relPath) return undefined;
  const clean = relPath.replace(/^\/+/, '');
  if (runId && /^run-[\d-]+$/.test(runId)) {
    return `/api/archive/${runId}/${clean}`;
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
        Missing screenshot · {attachment.name}
      </div>
    );
  }

  const src = resolveAttachmentUrl(attachment.relativePath, runId);

  return (
    <figure class="attachment-card attachment-card--screenshot">
      <img
        src={src}
        alt={attachment.name}
        loading="lazy"
        onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'attachment-chip attachment-chip--missing',textContent:'Missing file'}))"
      />
      <figcaption safe>{attachment.name}</figcaption>
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
        Missing video · {attachment.name}
      </div>
    );
  }

  const src = resolveAttachmentUrl(attachment.relativePath, runId);

  return (
    <figure class="attachment-card attachment-card--video">
      <video controls>
        <source src={src} type={attachment.contentType} />
      </video>
      <figcaption safe>{attachment.name}</figcaption>
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
        Missing trace · {attachment.name}
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
        {attachment.name}
      </span>
    );
  }

  const href = resolveAttachmentUrl(attachment.relativePath, runId);

  return (
    <a class="attachment-chip" href={href} target="_blank" rel="noopener" download="" safe>
      {attachment.name}
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
