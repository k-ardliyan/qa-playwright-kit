import * as fs from 'node:fs';
import * as path from 'node:path';

import { listReportHistory } from '../../agents/reporter/report-history';
import {
  getLatestRunInfo,
  isLatestRunArchived,
  generateRunId,
  loadArchivedSummary,
  loadArchivedMetadata,
  isValidRunId,
} from '../../agents/reporter/report-archive';
import { compareReports, type ReportComparison } from '../../agents/reporter/report-compare';
import {
  loadLatestTestNotes,
  loadArchivedTestNotes,
  noteKeyCandidates,
  composeAiNotes,
} from '../../agents/reporter/test-notes';
import { buildDashboardOverview } from '../../support/custom-dashboard/domain/dashboard-overview';
import { DashboardPage } from '../../support/custom-dashboard/pages/dashboard';
import { HistoryPage } from '../../support/custom-dashboard/pages/history';
import { ComparePage } from '../../support/custom-dashboard/pages/compare';
import { ReportDetailPage } from '../../support/custom-dashboard/pages/report-detail';
import { deriveDisplayName } from '../../support/custom-dashboard/domain/run';
import { escapeHtml } from '../../support/custom-dashboard/shared';
import { resolveWorkspaceReportDir } from '../../shared/workspace-paths';

export function getSummaryPath(): string {
  return path.join(resolveWorkspaceReportDir(), 'test-summary.json');
}

/** GET /api/dashboard — overview payload for the dashboard overview page. */
export function buildDashboardOverviewPayload(): Record<string, unknown> {
  const history = listReportHistory({ sort: 'newest', limit: 50 });
  const latestRun = getLatestRunInfo();
  const latestRunArchived = isLatestRunArchived();

  let latestSummary: Record<string, unknown> | null = null;
  const summaryPath = getSummaryPath();
  if (fs.existsSync(summaryPath)) {
    try {
      latestSummary = JSON.parse(fs.readFileSync(summaryPath, 'utf-8'));
    } catch {
      // ignore
    }
  }

  return buildDashboardOverview({
    latestRunInfo: latestRun,
    latestSummary,
    latestRunArchived,
    history,
    testNotes: loadLatestTestNotes(),
  }) as unknown as Record<string, unknown>;
}

// ─── Normalize CollectedTestCase → CollectedTestData ─────────────────────────
// test-summary.json stores CollectedTestCase (flat summary per test).
// The dashboard renderers expect CollectedTestData (full runtime data with
// errors, steps, attachments, retry, fullTitle, filePath, etc.).
// This normalizer bridges the gap with safe defaults for serve mode.
export function normalizeTestCases(
  testCases: unknown[],
  archivedRunId?: string,
): import('../../support/custom-dashboard/types').CollectedTestData[] {
  // Per-test notes live in the sidecar — latest sidecar for the latest run,
  // archived sidecar for archived runs. Missing/corrupt file reads as empty.
  const notes = archivedRunId ? loadArchivedTestNotes(archivedRunId) : loadLatestTestNotes();
  return testCases.map((tc) => {
    const t = tc as Record<string, unknown>;
    const rawAttachments = Array.isArray(t['attachments'])
      ? (t['attachments'] as Array<Record<string, unknown>>)
      : [];
    const attachments = rawAttachments.map((attachment) => {
      const relativePath =
        typeof attachment.relativePath === 'string' ? attachment.relativePath : '';
      if (!archivedRunId || !relativePath || relativePath.startsWith('/')) return attachment;
      const encodedPath = relativePath
        .replace(/\\/g, '/')
        .split('/')
        .filter(Boolean)
        .map((segment) => encodeURIComponent(segment))
        .join('/');
      return {
        ...attachment,
        relativePath: `/api/archive/${encodeURIComponent(archivedRunId)}/${encodedPath}`,
      };
    });
    const base: import('../../support/custom-dashboard/types').CollectedTestData = {
      // Fields present in CollectedTestCase
      testId: (t['testId'] as string) || '',
      scenarioId: (t['scenarioId'] as string) || '',
      title: (t['title'] as string) || '',
      role: (t['role'] as string) || '',
      module: (t['module'] as string) || '',
      feature: (t['feature'] as string) || '',
      // Fix #6: status fallback 'skipped' jika nilai undefined/unknown.
      status: ((t['status'] as string) ||
        'skipped') as import('../../support/custom-dashboard/types').CollectedTestData['status'],
      priority:
        (t['priority'] as import('../../support/custom-dashboard/types').Priority) || 'medium',
      duration: (t['duration'] as number) || 0,
      inputData: (t['inputData'] as Record<string, string>) || {},
      expectedResult: (t['expectedResult'] as string) || '',
      actualResult: (t['actualResult'] as string) || '',
      affectedLayer:
        (t['affectedLayer'] as import('../../support/custom-dashboard/types').AffectedLayer[]) ||
        [],
      failureSource: t['failureSource'] as
        | import('../../support/custom-dashboard/types').FailureSource
        | undefined,
      // Per-test notes: baked aiNotes from the summary, sidecar overlay below
      qaNotes: typeof t['qaNotes'] === 'string' ? (t['qaNotes'] as string) : undefined,
      aiNotes: typeof t['aiNotes'] === 'string' ? (t['aiNotes'] as string) : undefined,
      // Fields not in CollectedTestCase — safe defaults for serve mode
      fullTitle: (t['fullTitle'] as string) || (t['title'] as string) || '',
      filePath: (t['filePath'] as string) || '',
      errorMessage: (t['errorMessage'] as string) || '',
      errors:
        (t['errors'] as import('../../support/custom-dashboard/types').CollectedError[]) || [],
      steps: (t['steps'] as import('../../support/custom-dashboard/types').CollectedStep[]) || [],
      attachments:
        attachments as unknown as import('../../support/custom-dashboard/types').CollectedAttachment[],
      retry: (t['retry'] as number) ?? 0,
      attachmentCount:
        (t['attachmentCount'] as number) ??
        (Array.isArray(t['attachments']) ? (t['attachments'] as unknown[]).length : 0),
      hasTrace:
        (t['hasTrace'] as boolean) ??
        (Array.isArray(t['attachments'])
          ? (t['attachments'] as Array<{ kind?: string }>).some((a) => a.kind === 'trace')
          : false),
    };

    // Overlay sidecar notes (QA free-text; AI agent narrative composed over
    // the baked deterministic notes). Alias-aware: `user` ↔ `general`.
    try {
      for (const key of noteKeyCandidates(base.scenarioId, base.testId, base.role)) {
        const entry = notes.notes[key];
        if (!entry) continue;
        base.qaNotes = entry.qaNotes.trim() ? entry.qaNotes : undefined;
        const ai = composeAiNotes(base.aiNotes, entry.aiNotes);
        base.aiNotes = ai || undefined;
        break;
      }
    } catch {
      // Missing ids — row simply has no notes key
    }
    return base;
  });
}

// ─── Error & orphan run pages ────────────────────────────────────────────────

export function buildErrorPage(title: string, body: string, command?: string): string {
  const cmdBlock = command ? `<code class="cmd">${escapeHtml(command)}</code>` : '';
  const escapedTitle = escapeHtml(title);
  const escapedBody = escapeHtml(body).replace(/\n/g, '<br>');
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>QA Dashboard</title>
<style>body{font-family:system-ui;background:#1a1a1a;color:#e0d6c8;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;flex-direction:column;gap:14px;padding:24px;text-align:left;max-width:680px;margin:0 auto}
.msg{font-size:1.1rem;color:#c4956a;margin:0}
.body{font-size:0.95rem;line-height:1.6;color:#cfc4b6;margin:0}
.cmd{background:#2a2a2a;padding:10px 16px;border-radius:6px;font-family:monospace;color:#c4956a;display:block;width:fit-content}
.summary-box{background:#221a14;border:1px solid #4a3a2c;border-radius:8px;padding:14px 18px;display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:12px;width:100%}
.summary-box strong{color:#c4956a}
.actions{display:flex;gap:8px;flex-wrap:wrap}
.btn{background:#c4956a;color:#1a1a1a;border:none;padding:8px 16px;border-radius:6px;cursor:pointer;font-weight:600;text-decoration:none;display:inline-block}
.btn:hover{background:#d4a47a}
</style></head>
<body>
  <p class="msg">📊 ${escapedTitle}</p>
  <p class="body">${escapedBody}</p>
  ${cmdBlock}
</body></html>`;
}

export function buildOrphanRunPage(latestRun: {
  timestamp: string;
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  passRate: number;
  reportMode: string;
}): string {
  const escapedTitle = escapeHtml('Run summary found, but test-summary.json is missing');
  const escapedBody = escapeHtml(
    `The latest run marker (.latest-run) shows the run completed, but the summary ` +
      `file is gone. Without test-summary.json the dashboard cannot render test details.\n\n` +
      `Quick fix — re-run the tests to regenerate the summary, OR view the archived ` +
      `history (saved runs are still safe in artifacts/reports/archive/).`,
  );
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>QA Dashboard</title>
<style>body{font-family:system-ui;background:#1a1a1a;color:#e0d6c8;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;flex-direction:column;gap:14px;padding:24px;text-align:left;max-width:680px;margin:0 auto}
.msg{font-size:1.1rem;color:#c4956a;margin:0}
.body{font-size:0.95rem;line-height:1.6;color:#cfc4b6;margin:0}
.cmd{background:#2a2a2a;padding:10px 16px;border-radius:6px;font-family:monospace;color:#c4956a;display:block;width:fit-content}
.summary-box{background:#221a14;border:1px solid #4a3a2c;border-radius:8px;padding:14px 18px;display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:12px;width:100%}
.summary-box strong{color:#c4956a}
.actions{display:flex;gap:8px;flex-wrap:wrap}
.btn{background:#c4956a;color:#1a1a1a;border:none;padding:8px 16px;border-radius:6px;cursor:pointer;font-weight:600;text-decoration:none;display:inline-block}
.btn:hover{background:#d4a47a}
</style></head>
<body>
  <p class="msg">📊 ${escapedTitle}</p>
  <div class="summary-box">
    <div><strong>Total</strong><br>${latestRun.total}</div>
    <div><strong>Passed</strong><br>${latestRun.passed}</div>
    <div><strong>Failed</strong><br>${latestRun.failed}</div>
    <div><strong>Skipped</strong><br>${latestRun.skipped}</div>
    <div><strong>Pass rate</strong><br>${latestRun.passRate}%</div>
    <div><strong>Mode</strong><br>${escapeHtml(latestRun.reportMode)}</div>
    <div><strong>Timestamp</strong><br>${escapeHtml(latestRun.timestamp)}</div>
  </div>
  <p class="body">${escapedBody}</p>
  <code class="cmd">npx playwright test</code>
  <div class="actions">
    <a class="btn" href="/api/history">View saved history (JSON)</a>
  </div>
</body></html>`;
}

// ─── Modern Page Builders ───────────────────────────────────────────────────

export function renderDashboardOverviewPage(): string {
  const history = listReportHistory({ sort: 'newest', limit: 50 });
  const latestRun = getLatestRunInfo();
  const latestRunArchived = isLatestRunArchived();

  let latestSummary: Record<string, unknown> | null = null;
  const summaryPath = getSummaryPath();
  if (fs.existsSync(summaryPath)) {
    try {
      latestSummary = JSON.parse(fs.readFileSync(summaryPath, 'utf-8'));
    } catch {
      // ignore
    }
  }

  const overview = buildDashboardOverview({
    latestRunInfo: latestRun,
    latestSummary,
    latestRunArchived,
    history,
    testNotes: loadLatestTestNotes(),
  });

  return String(
    DashboardPage({
      overview,
      hasLatestRun: latestRun !== null,
      latestRunArchived,
      serveMode: true,
    }),
  );
}

/** Deep-link query options for detail pages (view mode + test anchor). */
export interface DetailPageQuery {
  view?: string;
  test?: string;
}

/** Deep-link query options for the history list. */
export interface HistoryPageQuery {
  q?: string;
  env?: string;
  decision?: string;
}

/** Sanitize a deep-link param into a safe short token (or undefined). */
function safeParam(value: string | undefined, allowed: Set<string>): string | undefined {
  if (!value) return undefined;
  const clean = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '');
  return allowed.has(clean) ? clean : undefined;
}

export function renderHistoryPage(query?: HistoryPageQuery): string {
  const history = listReportHistory({ sort: 'newest', limit: 100 });
  const latestRun = getLatestRunInfo();
  const latestRunArchived = isLatestRunArchived();
  const latestRunId = latestRun ? generateRunId(latestRun.timestamp) : undefined;

  return String(
    HistoryPage({
      history,
      hasLatestRun: latestRun !== null,
      latestRunArchived,
      latestRunId,
      serveMode: true,
      initialQuery: query?.q,
      initialEnv: query?.env,
      initialDecision: query?.decision,
    }),
  );
}

export function renderComparePage(baseline?: string, candidate?: string, series?: string): string {
  const history = listReportHistory({ sort: 'newest', limit: 100 });
  const latestRun = getLatestRunInfo();
  const latestRunArchived = isLatestRunArchived();

  let comparison: ReportComparison | null = null;
  if (baseline && candidate) {
    const result = compareReports(baseline, candidate);
    if (!('error' in result)) comparison = result;
  }

  return String(
    ComparePage({
      history,
      comparison,
      selectedBaseline: baseline || '',
      selectedCandidate: candidate || '',
      selectedSeries: series,
      serveMode: true,
      hasLatestRun: latestRun !== null,
      latestRunArchived,
    }),
  );
}

export function renderLatestDetailPage(query?: DetailPageQuery): string {
  let summary: object | undefined;
  let collectedTests: import('../../support/custom-dashboard/types').CollectedTestData[] = [];
  let latestRunId: string | undefined;

  try {
    const summaryPath = getSummaryPath();
    if (fs.existsSync(summaryPath)) {
      const raw = JSON.parse(fs.readFileSync(summaryPath, 'utf-8'));
      summary = raw;
      const latest = getLatestRunInfo();
      latestRunId = latest ? generateRunId(latest.timestamp) : undefined;
      collectedTests = Array.isArray(raw.testCases)
        ? normalizeTestCases(raw.testCases, isLatestRunArchived() ? latestRunId : undefined)
        : [];
    }
  } catch (err) {
    return buildErrorPage(
      'test-summary.json is unreadable',
      `The file exists but could not be parsed:\n\n${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (!summary) {
    const latestRun = getLatestRunInfo();
    if (latestRun) return buildOrphanRunPage(latestRun);
    return buildErrorPage(
      'No test run found yet.',
      'Run tests first, then refresh this page.',
      'npx playwright test',
    );
  }

  const latestRun = getLatestRunInfo();
  const isArchived = isLatestRunArchived();
  const rawSummary = summary as Record<string, unknown>;

  const displayName = deriveDisplayName({
    requirementTitle: rawSummary.requirementTitle as string,
    requirementPath: rawSummary.requirementPath as string,
    appEnv: (rawSummary.appEnv as string) || (process.env.APP_ENV as string),
    ranAt: rawSummary.timestamp as string,
  });

  return String(
    ReportDetailPage({
      mode: 'local',
      // biome-ignore lint/suspicious/noExplicitAny: runtime-validated report payload
      summary: summary as any,
      collectedTests,
      displayName,
      isArchived,
      hasLatestRun: latestRun !== null,
      serveMode: true,
      runId: isArchived ? latestRunId : undefined,
      breadcrumb: [{ label: 'Dashboard', href: '/dashboard' }, { label: 'Latest Report' }],
      view: safeParam(query?.view, new Set(['table', 'accordion'])),
      testAnchor: query?.test?.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64) || undefined,
    }),
  );
}

export function renderArchivedDetailPage(runId: string, query?: DetailPageQuery): string | null {
  if (!isValidRunId(runId)) return null;
  const summary = loadArchivedSummary(runId);
  const metadata = loadArchivedMetadata(runId);
  if (!summary && !metadata) return null;

  const rawSummary = (summary ?? {}) as Record<string, unknown>;
  const tc = Array.isArray(rawSummary.testCases)
    ? // biome-ignore lint/suspicious/noExplicitAny: runtime-validated report payload
      normalizeTestCases(rawSummary.testCases as any[], runId)
    : [];

  const displayName =
    metadata?.displayName ||
    deriveDisplayName({
      requirementTitle: metadata?.requirementTitle,
      requirementPath: metadata?.requirementPath,
      appEnv: metadata?.appEnv,
      ranAt: metadata?.ranAt,
    });

  return String(
    ReportDetailPage({
      mode: 'local',
      summary: {
        total: (rawSummary.total as number) ?? 0,
        passed: (rawSummary.passed as number) ?? 0,
        failed: (rawSummary.failed as number) ?? 0,
        skipped: (rawSummary.skipped as number) ?? 0,
        passRate: (rawSummary.passRate as number) ?? 0,
        // biome-ignore lint/suspicious/noExplicitAny: runtime-validated report payload
        reportMode: (rawSummary.reportMode as any) ?? metadata?.reportMode ?? 'general',
        timestamp: metadata?.ranAt ?? (rawSummary.timestamp as string) ?? '',
        rolesInScope: (rawSummary.rolesInScope as string[]) ?? [],
        // biome-ignore lint/suspicious/noExplicitAny: runtime-validated report payload
        testCases: (rawSummary.testCases as any) ?? [],
        // biome-ignore lint/suspicious/noExplicitAny: runtime-validated report payload
        runMeta: (rawSummary.runMeta as any) ?? {
          appEnv: metadata?.appEnv ?? 'local',
          ci: false,
          totalDurationMs: metadata?.durationMs ?? 0,
          generatedAt: metadata?.savedAt ?? '',
        },
      },
      collectedTests: tc,
      runId,
      displayName,
      isArchived: true,
      hasLatestRun: false,
      serveMode: true,
      breadcrumb: [{ label: 'History', href: '/history' }, { label: displayName || runId }],
      view: safeParam(query?.view, new Set(['table', 'accordion'])),
      testAnchor: query?.test?.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64) || undefined,
    }),
  );
}
