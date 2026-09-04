/** @jsxImportSource @kitajs/html */
import type { CollectedError, CollectedTestData } from '../../types';
import { decisionHintFor, decisionHintTooltipFor, explainFailure } from '../../failure-source';
import { generateErrorFingerprint } from '../../../classifier/fingerprint';
import { PriorityBadge } from '../shared/PriorityBadge';
import { StatusPill } from '../shared/StatusPill';
import { Attachments } from './Attachments';
import { StepsTimeline } from './StepsTimeline';

export interface TestDetailProps {
  testData: CollectedTestData;
  index: number;
  runId?: string;
}

const UNHEALTHY_STATUSES = new Set(['failed', 'timedOut', 'interrupted']);

function isUnhealthyStatus(status: string): boolean {
  return UNHEALTHY_STATUSES.has(status);
}

function StatusGlyph({ status }: { status: string }) {
  if (isUnhealthyStatus(status)) {
    return (
      <span
        class="test-file-test-status-icon test-file-test-status-icon--failed"
        aria-hidden="true"
      >
        ✕
      </span>
    );
  }
  if (status === 'skipped') {
    return (
      <span
        class="test-file-test-status-icon test-file-test-status-icon--skipped"
        aria-hidden="true"
      >
        ⊘
      </span>
    );
  }
  return (
    <span class="test-file-test-status-icon test-file-test-status-icon--passed" aria-hidden="true">
      ✓
    </span>
  );
}

function buildFailurePacket(testData: CollectedTestData): string {
  const errorLines = (testData.errorMessage || '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 3);
  const errorBlock = errorLines.length > 0 ? errorLines.join('\n  ') : '-';

  const source = testData.failureSource || 'unknown';
  const sourceExplain = explainFailure(testData.errorMessage);
  const sourceLine = sourceExplain
    ? `- Source: ${source} (${decisionHintFor(testData.failureSource)}) — ${sourceExplain}`
    : `- Source: ${source} (${decisionHintFor(testData.failureSource)})`;

  return [
    `### ${testData.testId || '-'} — ${testData.title}`,
    ``,
    `- Status: ${testData.status}`,
    `- Scenario: ${testData.scenarioId || '-'}`,
    sourceLine,
    `- Retry: ${testData.retry ?? 0}`,
    `- Duration: ${testData.duration}ms`,
    ``,
    `**Expected:** ${testData.expectedResult || '-'}`,
    ``,
    `**Actual:** ${testData.actualResult || '-'}`,
    ``,
    `**Error:**`,
    '```',
    `  ${errorBlock}`,
    '```',
    ``,
    `- File: ${testData.filePath}`,
    `- Trace: ${
      (testData.attachments ?? []).find((a) => a.kind === 'trace')?.relativePath ||
      (testData.hasTrace ? '(available in test results)' : 'none')
    }`,
  ].join('\n');
}

function ErrorsSection({ errors }: { errors: CollectedError[] }) {
  if (errors.length === 0) return null;

  return (
    <>
      {errors.map((error, idx) => {
        const full = [error.message, error.stack]
          .filter((part) => part && part.trim().length > 0)
          .filter((part, i, parts) => i === 0 || !parts[0]?.includes(part ?? ''))
          .join('\n\n');

        return (
          <div class="test-error-container test-error-text" data-error-index={idx}>
            <pre class="test-error-view error-block" safe>
              {full}
            </pre>
          </div>
        );
      })}
    </>
  );
}

function encodeAttachmentPath(relPath: string): string {
  return relPath
    .replace(/\\/g, '/')
    .split('/')
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

function resolveTraceUrl(relPath: string | undefined, runId?: string): string | undefined {
  if (!relPath) return undefined;
  if (relPath.startsWith('/')) return relPath;
  const encoded = encodeAttachmentPath(relPath);
  return runId && /^run-[\d-]+$/.test(runId)
    ? `/api/archive/${encodeURIComponent(runId)}/${encoded}`
    : `/${encoded}`;
}

function TraceLink({ testData, runId }: { testData: CollectedTestData; runId?: string }) {
  const trace = (testData.attachments ?? []).find((a) => a.kind === 'trace');
  if (!trace) {
    return <span class="muted">No trace</span>;
  }
  return (
    <a
      class="btn btn--ghost"
      href={resolveTraceUrl(trace.relativePath, runId)}
      target="_blank"
      rel="noopener"
    >
      View trace
    </a>
  );
}

export function TestDetail({ testData, index, runId }: TestDetailProps) {
  const status = String(testData.status);
  const unhealthy = isUnhealthyStatus(status);
  const packet = buildFailurePacket(testData);
  const attachments = testData.attachments ?? [];
  const attachmentCount = attachments.length;
  const errorCount = (testData.errors ?? []).length;
  const stepCount = (testData.steps ?? []).length;
  const rowKey = `${testData.testId || 'row'}-${index}`;

  const hasTrace = (testData.hasTrace ?? attachments.some((a) => a.kind === 'trace')) ? '1' : '0';
  const hasScreenshot = attachments.some((a) => a.kind === 'screenshot') ? '1' : '0';
  const hasVideo = attachments.some((a) => a.kind === 'video') ? '1' : '0';
  const scope = (() => {
    const path = (testData.filePath || '').toLowerCase().replace(/\\/g, '/');
    if (/(^|\/)demo(\/|$)/.test(path)) return 'DEMO';
    if (/(^|\/)(fixture|fixtures|test-fixture)(\/|$)/.test(path)) return 'FIXTURE';
    return 'GENERAL';
  })();
  const layers = (testData.affectedLayer || []).join(',');
  const fingerprint = testData.errorMessage
    ? generateErrorFingerprint(testData.errorMessage)
    : undefined;
  const search = [
    testData.testId,
    testData.title,
    testData.fullTitle,
    testData.role,
    testData.module,
    testData.feature,
    testData.expectedResult,
    testData.actualResult,
    testData.errorMessage,
    testData.failureSource || '',
  ]
    .join(' ')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

  const actualLower = (testData.actualResult || '').toLowerCase();
  const looksFailed =
    actualLower.includes('error') ||
    actualLower.includes('timeout') ||
    actualLower.includes('failed') ||
    actualLower.includes('not found');
  const actualBoxClass = looksFailed
    ? 'result-box result-box--failed'
    : 'result-box result-box--passed';

  const inputEntries = Object.entries(testData.inputData || {});

  return (
    <details
      class={`test-card test-file-test test-file-test-outcome-${status}`}
      data-row-key={rowKey}
      data-test-id={testData.testId || ''}
      data-status={status}
      data-priority={(testData.priority || 'medium').toLowerCase()}
      data-role={(testData.role || '').trim() || 'GENERAL / UNSCOPED'}
      data-scope={scope}
      data-module={testData.module || ''}
      data-feature={testData.feature || ''}
      data-layers={layers}
      data-has-trace={hasTrace}
      data-has-screenshot={hasScreenshot}
      data-has-video={hasVideo}
      data-unhealthy={unhealthy ? '1' : '0'}
      data-failure-source={testData.failureSource || ''}
      data-search={search}
      data-duration={testData.duration}
    >
      <summary class="test-card__summary">
        <div class="test-card__summary-row">
          <span class="test-card__index">{index + 1}.</span>
          <StatusGlyph status={status} />
          <span class="test-card__title test-file-title" safe>
            {testData.fullTitle}
          </span>
          <span class="test-card__badges">
            {testData.testId ? (
              <span class="badge badge--meta" safe>
                {testData.testId}
              </span>
            ) : null}
            <span class="badge badge--meta" safe>
              {(testData.role || 'GENERAL / UNSCOPED').toUpperCase()}
            </span>
            <span class="scope-tag">{scope}</span>
            <PriorityBadge priority={testData.priority} />
            {unhealthy && testData.failureSource ? (
              <span
                class={`failure-source failure-source--${testData.failureSource}`}
                title={decisionHintTooltipFor(testData.failureSource, testData.errorMessage)}
                safe
              >
                {testData.failureSource.toUpperCase()}
              </span>
            ) : null}
            {fingerprint ? (
              <span class="badge badge--local" title={fingerprint.normalizedMessage} safe>
                {fingerprint.fingerprintId}
              </span>
            ) : null}
            <StatusPill status={status} />
          </span>
          <span class="test-card__duration" data-testid="test-duration">
            {testData.duration}ms
          </span>
        </div>
        <div class="test-card__meta-row test-file-details-row">
          {testData.filePath ? (
            <span class="test-file-path" safe>
              {testData.filePath}
            </span>
          ) : null}
          <TraceLink testData={testData} runId={runId} />
        </div>
      </summary>

      <div class="test-card__body test-result">
        <div class="meta-grid">
          <div class="meta-grid__item">
            <span class="meta-grid__label">Test ID</span>
            <code safe>{testData.testId || '-'}</code>
          </div>
          <div class="meta-grid__item">
            <span class="meta-grid__label">Scenario ID</span>
            <code safe>{testData.scenarioId || '-'}</code>
          </div>
          <div class="meta-grid__item">
            <span class="meta-grid__label">File</span>
            <code safe>{testData.filePath}</code>
          </div>
          <div class="meta-grid__item">
            <span class="meta-grid__label">Retry</span>
            <span class="meta-grid__value">{testData.retry}</span>
          </div>
          <div class="meta-grid__item">
            <span class="meta-grid__label">Evidence</span>
            <span class="meta-grid__value">
              {attachmentCount} attachment{attachmentCount === 1 ? '' : 's'}
            </span>
          </div>
          <div class="meta-grid__item">
            <span class="meta-grid__label">Errors</span>
            <span class="meta-grid__value">{errorCount}</span>
          </div>
          <div class="meta-grid__item">
            <span class="meta-grid__label">Trace</span>
            <span class="meta-grid__value">
              <TraceLink testData={testData} runId={runId} />
            </span>
          </div>
          <div class="meta-grid__item">
            <span class="meta-grid__label">Affected Layer</span>
            <span class="meta-grid__value">
              {(testData.affectedLayer || []).map((l) => (
                <span class={`layer-badge layer-badge--${l.toLowerCase()}`}>{l}</span>
              ))}
            </span>
          </div>
          {unhealthy && testData.failureSource ? (
            <div class="meta-grid__item">
              <span class="meta-grid__label">Failure source</span>
              <span class="meta-grid__value">
                <span
                  class={`failure-source failure-source--${testData.failureSource}`}
                  title={decisionHintTooltipFor(testData.failureSource, testData.errorMessage)}
                  safe
                >
                  {testData.failureSource.toUpperCase()}
                </span>{' '}
                <span
                  class="decision-hint"
                  title={decisionHintTooltipFor(testData.failureSource, testData.errorMessage)}
                  safe
                >
                  → {decisionHintFor(testData.failureSource)}
                </span>
              </span>
            </div>
          ) : null}
        </div>

        {inputEntries.length > 0 ? (
          <section class="detail-section">
            <h3 class="subheading">Input Data</h3>
            <div class="input-kv">
              {inputEntries.map(([k, v]) => (
                <div>
                  <span class="key" safe>
                    {k}:
                  </span>{' '}
                  <span safe>{v}</span>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {testData.expectedResult || testData.actualResult ? (
          <section class="detail-section">
            <h3 class="subheading">Expected vs Actual Result</h3>
            <div class="results-comparison">
              <div class="result-box">
                <span class="result-label">Expected</span>
                <div class="result-content" safe>
                  {testData.expectedResult || '-'}
                </div>
              </div>
              <div class={actualBoxClass}>
                <span class="result-label">Actual</span>
                <div class="result-content" safe>
                  {testData.actualResult || '-'}
                </div>
              </div>
            </div>
          </section>
        ) : null}

        {errorCount > 0 ? (
          <details class="chip detail-chip" open>
            <summary class="chip-header">
              Errors <span class="chip-count">{errorCount}</span>
            </summary>
            <div class="chip-body">
              <ErrorsSection errors={testData.errors} />
            </div>
          </details>
        ) : null}

        <details class="chip detail-chip" open={unhealthy || stepCount > 0}>
          <summary class="chip-header">
            Test Steps <span class="chip-count">{stepCount}</span>
          </summary>
          <div class="chip-body chip-body--steps">
            <StepsTimeline steps={testData.steps} />
          </div>
        </details>

        <details class="chip detail-chip" open={attachmentCount > 0}>
          <summary class="chip-header">
            Attachments <span class="chip-count">{attachmentCount}</span>
          </summary>
          <div class="chip-body">
            <Attachments attachments={testData.attachments} runId={runId} />
          </div>
        </details>

        {unhealthy ? (
          <div class="test-card__actions">
            <button type="button" class="btn btn--ghost" data-copy-packet={packet}>
              Copy failure packet
            </button>
          </div>
        ) : null}
      </div>
    </details>
  );
}
