/** @jsxImportSource @kitajs/html */
import type { CollectedTestData } from '../../types';

export interface ArtifactsStripProps {
  collectedTests: CollectedTestData[];
  runId?: string;
}

const ARTIFACTS_LIST_LIMIT = 5;

interface ArtifactItem {
  testId: string;
  title: string;
  name?: string;
  href?: string;
  retry?: number;
}

function isArchivedRunId(runId?: string): runId is string {
  return Boolean(runId && /^run-[\d-]+$/.test(runId));
}

function encodeEvidencePath(relPath: string): string {
  return relPath
    .replace(/\\/g, '/')
    .split('/')
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

function resolveEvidenceUrl(relPath: string, runId?: string): string {
  if (relPath.startsWith('/')) return relPath;
  const encoded = encodeEvidencePath(relPath);
  return isArchivedRunId(runId)
    ? `/api/archive/${encodeURIComponent(runId)}/${encoded}`
    : `/${encoded}`;
}

function collectAttachmentsByKind(
  tests: CollectedTestData[],
  kind: 'screenshot' | 'video' | 'trace',
  runId?: string,
): ArtifactItem[] {
  const result: ArtifactItem[] = [];
  for (const t of tests) {
    for (const a of t.attachments) {
      if (a.kind === kind && a.relativePath) {
        result.push({
          testId: t.testId || '-',
          title: t.title || t.fullTitle || 'test',
          name: a.name,
          href: resolveEvidenceUrl(a.relativePath, runId),
        });
      }
    }
  }
  return result;
}

function collectRetriedTests(tests: CollectedTestData[]): ArtifactItem[] {
  return tests
    .filter((t) => t.retry > 0)
    .map((t) => ({
      testId: t.testId || '-',
      title: t.title || t.fullTitle || 'test',
      retry: t.retry,
    }));
}

function ArtifactFileList({
  items,
  emptyLabel,
  limit = ARTIFACTS_LIST_LIMIT,
}: {
  items: ArtifactItem[];
  emptyLabel: string;
  limit?: number;
}) {
  if (items.length === 0) {
    return (
      <p class="artifacts-card__empty" safe>
        {emptyLabel}
      </p>
    );
  }

  const visible = items.slice(0, limit);
  const remaining = items.length - visible.length;

  return (
    <>
      <ul class="artifacts-card__files">
        {visible.map((item) => {
          const label = item.name
            ? `${item.testId} · ${item.name}`
            : `${item.testId}${item.retry != null ? ` · retry ×${item.retry}` : ''}`;
          const sub = item.title;

          if (item.href) {
            return (
              <li>
                <a
                  class="artifacts-card__file"
                  href={item.href}
                  target="_blank"
                  rel="noopener"
                  title={sub}
                >
                  <span class="artifacts-card__file-name" safe>
                    {label}
                  </span>
                  <span class="artifacts-card__file-sub" safe>
                    {sub}
                  </span>
                </a>
              </li>
            );
          }

          return (
            <li>
              <div class="artifacts-card__file artifacts-card__file--static" title={sub}>
                <span class="artifacts-card__file-name" safe>
                  {label}
                </span>
                <span class="artifacts-card__file-sub" safe>
                  {sub}
                </span>
              </div>
            </li>
          );
        })}
      </ul>
      {remaining > 0 && (
        <p class="artifacts-card__more">+{remaining} more — open Attachments folder</p>
      )}
    </>
  );
}

export function ArtifactsStrip({ collectedTests, runId }: ArtifactsStripProps) {
  const retried = collectRetriedTests(collectedTests);
  const traces = collectAttachmentsByKind(collectedTests, 'trace', runId);
  const screenshots = collectAttachmentsByKind(collectedTests, 'screenshot', runId);
  const videos = collectAttachmentsByKind(collectedTests, 'video', runId);

  const totalEvidence = traces.length + screenshots.length + videos.length;
  const readiness =
    totalEvidence === 0 && retried.length === 0
      ? 'No retries or attachments in this run'
      : `${retried.length} retried · ${traces.length} trace · ${screenshots.length} ss · ${videos.length} video`;

  const isArchivedRun = Boolean(runId && /^run-[\d-]+$/.test(runId));

  const summaryHref = isArchivedRun
    ? `/api/archive/${encodeURIComponent(runId!)}/summary.json`
    : '/test-summary.json';
  const summaryPath = isArchivedRun
    ? `artifacts/reports/archive/${runId}/summary.json`
    : 'artifacts/reports/test-summary.json';

  const metadataHref = isArchivedRun
    ? `/api/archive/${encodeURIComponent(runId!)}/metadata.json`
    : null;
  const metadataPath = isArchivedRun ? `artifacts/reports/archive/${runId}/metadata.json` : null;

  const pipelineHref = !isArchivedRun ? '/pipeline-state.json' : null;

  const attachmentsHref = isArchivedRun
    ? `/api/archive/${encodeURIComponent(runId!)}/attachments/`
    : '/attachments/';
  const attachmentsPath = isArchivedRun
    ? `artifacts/reports/archive/${runId}/attachments/`
    : 'artifacts/reports/attachments/';

  const buckets = [
    {
      key: 'retries',
      label: 'Retries',
      count: retried.length,
      items: retried,
      emptyLabel: 'No retried tests',
    },
    {
      key: 'traces',
      label: 'Traces',
      count: traces.length,
      items: traces,
      emptyLabel: 'No trace files',
    },
    {
      key: 'screenshots',
      label: 'Screenshots',
      count: screenshots.length,
      items: screenshots,
      emptyLabel: 'No screenshots',
    },
    {
      key: 'videos',
      label: 'Videos',
      count: videos.length,
      items: videos,
      emptyLabel: 'No videos',
    },
  ];

  return (
    <>
      <details class="artifacts-card" aria-label="Evidence and related reports">
        <summary class="artifacts-card__summary">
          <div class="artifacts-card__titles">
            <span class="artifacts-card__eyebrow">Evidence &amp; reports</span>
            <span class="artifacts-card__title">Drill-down inventory</span>
            <span class="artifacts-card__readiness" safe>
              {readiness}
            </span>
          </div>
          <span class="artifacts-card__chevron" aria-hidden="true" />
        </summary>

        <div class="artifacts-card__body">
          <p class="artifacts-card__hint">
            Open a file or related report. Preview paths resolve one level up to{' '}
            <code>artifacts/reports/</code>.
          </p>

          <div class="artifacts-card__grid">
            {buckets.map((b) => (
              <article
                class={`artifacts-bucket artifacts-bucket--${b.key}${b.count === 0 ? ' artifacts-bucket--empty' : ''}`}
              >
                <header class="artifacts-bucket__head">
                  <span class="artifacts-bucket__label" safe>
                    {b.label}
                  </span>
                  <strong class="artifacts-bucket__count">{b.count}</strong>
                </header>
                <ArtifactFileList items={b.items} emptyLabel={b.emptyLabel} />
              </article>
            ))}
          </div>

          <div class="artifacts-card__links" id="deep-links">
            <span class="artifacts-card__links-label">Related</span>
            <div class="artifacts-card__links-grid">
              {!isArchivedRun && (
                <a
                  class="artifacts-link"
                  href="/html/index.html"
                  data-deep-link="html"
                  target="_blank"
                  rel="noopener"
                >
                  <span class="artifacts-link__title">Playwright HTML</span>
                  <span class="artifacts-link__path">artifacts/reports/html/index.html</span>
                </a>
              )}
              <a
                class="artifacts-link"
                href={summaryHref}
                data-deep-link="summary"
                target="_blank"
                rel="noopener"
              >
                <span class="artifacts-link__title">Summary JSON</span>
                <span class="artifacts-link__path" safe>
                  {summaryPath}
                </span>
              </a>
              {metadataHref ? (
                <a
                  class="artifacts-link"
                  href={metadataHref}
                  data-deep-link="metadata"
                  target="_blank"
                  rel="noopener"
                >
                  <span class="artifacts-link__title">Metadata JSON</span>
                  <span class="artifacts-link__path" safe>
                    {metadataPath || ''}
                  </span>
                </a>
              ) : null}
              {pipelineHref ? (
                <a
                  class="artifacts-link"
                  href={pipelineHref}
                  data-deep-link="pipeline"
                  target="_blank"
                  rel="noopener"
                >
                  <span class="artifacts-link__title">Pipeline State</span>
                  <span class="artifacts-link__path">artifacts/reports/pipeline-state.json</span>
                </a>
              ) : null}
              <a
                class="artifacts-link"
                href={attachmentsHref}
                data-deep-link="attachments"
                target="_blank"
                rel="noopener"
              >
                <span class="artifacts-link__title">Attachments folder</span>
                <span class="artifacts-link__path" safe>
                  {attachmentsPath}
                </span>
              </a>
            </div>
          </div>
        </div>
      </details>
    </>
  );
}
