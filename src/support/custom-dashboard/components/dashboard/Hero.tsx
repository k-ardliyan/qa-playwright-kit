/** @jsxImportSource @kitajs/html */
import type { TestSummary } from '../../types';
import { formatDuration as formatDurationMs } from '../../shared';
import {
  IconLayers,
  IconList,
  IconCalendar,
  IconClock,
  IconCircleCheck,
  IconCircleX,
  IconCircleSlash2,
  IconChartPie,
  IconDownload,
  IconHash,
  IconListChecks,
  IconSave,
  IconTriangleAlert,
} from '../shared/icons';

export interface HeroProps {
  summary: TestSummary;
  /**
   * Render the run actions (Export / Markdown / Save) in the masthead. Only the
   * LATEST run gets them: `/export/*` reads the latest summary server-side, so
   * offering them on a history or compare page would export the wrong run.
   */
  runActions?: boolean;
  /** The latest run is already archived — Save is no longer offered. */
  isArchived?: boolean;
}

function getVerdict(summary?: TestSummary): {
  label: string;
  tone: 'healthy' | 'warning' | 'critical';
  summaryLine: string;
} {
  const failed = summary?.failed ?? 0;
  const skipped = summary?.skipped ?? 0;
  const total = summary?.total ?? 0;

  if (failed > 0) {
    return {
      label: 'Run failed',
      tone: 'critical',
      summaryLine: `${failed} unhealthy test${failed === 1 ? '' : 's'} need${failed === 1 ? 's' : ''} triage.`,
    };
  }

  if (skipped > 0) {
    return {
      label: 'Run degraded',
      tone: 'warning',
      summaryLine: `${skipped} skipped test${skipped === 1 ? '' : 's'} reduced coverage.`,
    };
  }

  return {
    label: 'Run healthy',
    tone: 'healthy',
    summaryLine: total > 0 ? 'All executed tests passed.' : 'No tests were captured in this run.',
  };
}

export function formatDisplayTime(raw: string): string {
  try {
    const d = new Date(raw);
    if (isNaN(d.getTime())) return raw;
    const day = d.getDate();
    const months = [
      'Jan',
      'Feb',
      'Mar',
      'Apr',
      'May',
      'Jun',
      'Jul',
      'Aug',
      'Sep',
      'Oct',
      'Nov',
      'Dec',
    ];
    const mon = months[d.getMonth()];
    const yr = d.getFullYear();
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${day} ${mon} ${yr}, ${hh}:${mm}`;
  } catch {
    return raw;
  }
}

function truncateMiddle(value: string, max = 18): string {
  if (!value || value.length <= max) return value;
  const keep = Math.floor((max - 1) / 2);
  return `${value.slice(0, keep)}…${value.slice(-keep)}`;
}

export function Hero({ summary, runActions, isArchived }: HeroProps) {
  const verdict = getVerdict(summary);

  const displayTime = formatDisplayTime(summary?.timestamp || '');
  const appEnv = summary?.runMeta?.appEnv ?? 'unknown';
  const runId = summary?.runMeta?.runId;
  const totalDuration = formatDurationMs(summary?.runMeta?.totalDurationMs ?? 0);

  return (
    <header class={`hero hero--${verdict.tone}`}>
      <div class="hero__top-row">
        <div class="hero__identity">
          {/* The mark carries the verdict itself — one glyph that reads at a
              glance, instead of a document icon with an overlapping badge. */}
          <div class="hero__mark" aria-hidden="true">
            {verdict.tone === 'critical' ? (
              <IconCircleX size={24} />
            ) : verdict.tone === 'warning' ? (
              <IconTriangleAlert size={24} />
            ) : (
              <IconCircleCheck size={24} />
            )}
          </div>
          <div class="hero__copy">
            <h1 class="hero__title">
              {verdict.label === 'Run failed'
                ? 'Run Failed'
                : verdict.label === 'Run healthy'
                  ? 'Run Healthy'
                  : 'Run Degraded'}
            </h1>
            <p class="hero__subtitle" safe>
              {verdict.summaryLine}
            </p>
          </div>
        </div>
        <div class="hero__top-actions">
          {runActions ? (
            <div class="hero__run-actions">
              <a class="btn-export-sm" href="/export/portable" title="Download portable report">
                <IconDownload size={14} />
                <span>Export</span>
              </a>
              <a class="btn-export-sm" href="/export/markdown" title="Download Markdown report">
                <IconDownload size={14} />
                <span>Markdown</span>
              </a>
              {!isArchived ? (
                <button
                  class="btn-save-sm"
                  type="button"
                  onclick="openSaveModal && openSaveModal()"
                  title="Save latest run to archive"
                >
                  <IconSave size={14} />
                  <span>Save run</span>
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      <div class="hero__meta-inline">
        <div class="hero__meta-item">
          <span class="hero__meta-icon" aria-hidden="true">
            <IconLayers size={14} />
          </span>
          <span class="hero__meta-text">
            <span class="hero__meta-label">APP_ENV</span>
            <strong safe>{appEnv}</strong>
          </span>
        </div>
        {runId ? (
          <div class="hero__meta-item">
            <span class="hero__meta-icon" aria-hidden="true">
              <IconHash size={14} />
            </span>
            <span class="hero__meta-text">
              <span class="hero__meta-label">Run ID</span>
              <strong title={runId} safe>
                {truncateMiddle(runId, 16)}
              </strong>
            </span>
          </div>
        ) : null}
        <div class="hero__meta-item">
          <span class="hero__meta-icon" aria-hidden="true">
            <IconCalendar size={14} />
          </span>
          <span class="hero__meta-text">
            <span class="hero__meta-label">Generated</span>
            <strong safe>{displayTime}</strong>
          </span>
        </div>
        <div class="hero__meta-item">
          <span class="hero__meta-icon" aria-hidden="true">
            <IconClock size={14} />
          </span>
          <span class="hero__meta-text">
            <span class="hero__meta-label">Duration</span>
            <strong safe>{totalDuration}</strong>
          </span>
        </div>
      </div>

      <div class="hero-stat-bar">
        <div class="hero-stat">
          <span class="hero-stat__icon" aria-hidden="true">
            <IconListChecks size={16} />
          </span>
          <span class="hero-stat__copy">
            <span class="hero-stat__num">{summary?.total ?? 0}</span>
            <span class="hero-stat__lbl">Total</span>
          </span>
        </div>
        <div class="hero-stat hero-stat--passed">
          <span class="hero-stat__icon" aria-hidden="true">
            <IconCircleCheck size={16} />
          </span>
          <span class="hero-stat__copy">
            <span class="hero-stat__num">{summary?.passed ?? 0}</span>
            <span class="hero-stat__lbl">Passed</span>
          </span>
        </div>
        <div class="hero-stat hero-stat--failed">
          <span class="hero-stat__icon" aria-hidden="true">
            <IconCircleX size={16} />
          </span>
          <span class="hero-stat__copy">
            <span class="hero-stat__num">{summary?.failed ?? 0}</span>
            <span class="hero-stat__lbl">Failed</span>
          </span>
        </div>
        <div class="hero-stat hero-stat--skipped">
          <span class="hero-stat__icon" aria-hidden="true">
            <IconCircleSlash2 size={16} />
          </span>
          <span class="hero-stat__copy">
            <span class="hero-stat__num">{summary?.skipped ?? 0}</span>
            <span class="hero-stat__lbl">Skipped</span>
          </span>
        </div>
        <div class="hero-stat hero-stat--accent">
          <span class="hero-stat__icon" aria-hidden="true">
            <IconChartPie size={16} />
          </span>
          <span class="hero-stat__copy">
            <span class="hero-stat__num">{summary?.passRate ?? 0}%</span>
            <span class="hero-stat__lbl">Pass rate</span>
          </span>
        </div>
      </div>
    </header>
  );
}
