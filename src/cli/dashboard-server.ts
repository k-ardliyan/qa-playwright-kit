/**
 * Dashboard Serve Mode — Local HTTP server for interactive QA dashboard.
 *
 * Features:
 * - Serves dynamic dashboard HTML (rebuilt on every GET /)
 * - REST API: save, delete, compare, history
 * - Server-Sent Events (SSE) for auto-refresh after mutations
 * - Heartbeat-based auto-shutdown when browser tab is closed
 * - Zero external dependencies — uses Node.js built-in http/fs/url
 *
 * Usage:
 *   npm run dashboard
 *   npm run dashboard -- --port=4567 --no-open
 *
 * @module src/cli/dashboard-server
 */

import * as http from 'node:http';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as url from 'node:url';
import { exec } from 'node:child_process';

import { listReportHistory } from '../agents/reporter/report-history';
import {
  saveLatestRun,
  updateArchivedMetadata,
  deleteArchivedReport,
  getLatestRunInfo,
  listArchivedRunIds,
  isLatestRunArchived,
  loadArchivedSummary,
  loadArchivedMetadata,
  generateRunId,
  isValidRunId,
} from '../agents/reporter/report-archive';
import { compareLatestVsPrevious, compareReports } from '../agents/reporter/report-compare';
import type { ReportComparison } from '../agents/reporter/report-compare';
import {
  buildComparePage,
  buildHistoryPage,
  buildDetailPage,
} from '../support/custom-dashboard/build-fragments';
import { escapeHtml } from '../support/custom-dashboard/shared';
import type { QaDecision } from '../agents/reporter/report-archive';

import { buildDashboardOverview } from '../support/custom-dashboard/domain/dashboard-overview';
import { DashboardPage } from '../support/custom-dashboard/pages/dashboard';
import { HistoryPage } from '../support/custom-dashboard/pages/history';
import { ComparePage } from '../support/custom-dashboard/pages/compare';
import { ReportDetailPage } from '../support/custom-dashboard/pages/report-detail';
import { deriveDisplayName } from '../support/custom-dashboard/domain/run';

// ─── Config ──────────────────────────────────────────────────────────────────

const DEFAULT_PORT = 4567;
const HEARTBEAT_TIMEOUT_MS = 20_000; // server shuts down if no heartbeat for 20s

function getSummaryPath(): string {
  return path.resolve(process.cwd(), 'artifacts', 'reports', 'test-summary.json');
}

// ─── Arg parsing ─────────────────────────────────────────────────────────────

function parseServArgs(argv: string[]): { port: number; open: boolean; idle: boolean } {
  let port = DEFAULT_PORT;
  let open = true;
  let idle = true;
  for (const arg of argv.slice(2)) {
    const m = arg.match(/^--port=(\d+)$/);
    if (m) port = parseInt(m[1], 10);
    if (arg === '--no-open') open = false;
    if (arg === '--no-idle') idle = false;
  }
  return { port, open, idle };
}

// ─── SSE clients ─────────────────────────────────────────────────────────────

const sseClients = new Set<http.ServerResponse>();

function broadcastEvent(event: string, data: unknown = {}) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(payload);
    } catch {
      sseClients.delete(client);
    }
  }
}

// ─── Heartbeat ───────────────────────────────────────────────────────────────

let shutdownTimer: ReturnType<typeof setTimeout> | null = null;
let idleEnabled = true;

function resetHeartbeat() {
  if (!idleEnabled) return;
  if (shutdownTimer) clearTimeout(shutdownTimer);
  shutdownTimer = setTimeout(() => {
    console.log('\n[dashboard-server] No heartbeat received — shutting down.');
    process.exit(0);
  }, HEARTBEAT_TIMEOUT_MS);
}

// ─── Normalize CollectedTestCase → CollectedTestData ─────────────────────────
// test-summary.json stores CollectedTestCase (flat summary per test).
// The dashboard renderers expect CollectedTestData (full runtime data with
// errors, steps, attachments, retry, fullTitle, filePath, etc.).
// This normalizer bridges the gap with safe defaults for serve mode.
function normalizeTestCases(
  testCases: unknown[],
): import('../support/custom-dashboard/types').CollectedTestData[] {
  return testCases.map((tc) => {
    const t = tc as Record<string, unknown>;
    return {
      // Fields present in CollectedTestCase
      testId: (t['testId'] as string) || '',
      scenarioId: (t['scenarioId'] as string) || '',
      title: (t['title'] as string) || '',
      role: (t['role'] as string) || '',
      module: (t['module'] as string) || '',
      feature: (t['feature'] as string) || '',
      // Fix #6: status fallback 'skipped' jika nilai undefined/unknown.
      status: ((t['status'] as string) ||
        'skipped') as import('../support/custom-dashboard/types').CollectedTestData['status'],
      priority: (t['priority'] as import('../support/custom-dashboard/types').Priority) || 'medium',
      duration: (t['duration'] as number) || 0,
      inputData: (t['inputData'] as Record<string, string>) || {},
      expectedResult: (t['expectedResult'] as string) || '',
      actualResult: (t['actualResult'] as string) || '',
      affectedLayer:
        (t['affectedLayer'] as import('../support/custom-dashboard/types').AffectedLayer[]) || [],
      failureSource: t['failureSource'] as
        import('../support/custom-dashboard/types').FailureSource | undefined,
      // Fields not in CollectedTestCase — safe defaults for serve mode
      fullTitle: (t['title'] as string) || '',
      filePath: '',
      errorMessage: (t['errorMessage'] as string) || '',
      errors: (t['errors'] as import('../support/custom-dashboard/types').CollectedError[]) || [],
      steps: (t['steps'] as import('../support/custom-dashboard/types').CollectedStep[]) || [],
      attachments:
        (t['attachments'] as import('../support/custom-dashboard/types').CollectedAttachment[]) ||
        [],
      retry: 0,
      attachmentCount:
        (t['attachmentCount'] as number) ??
        (Array.isArray(t['attachments']) ? (t['attachments'] as unknown[]).length : 0),
      hasTrace:
        (t['hasTrace'] as boolean) ??
        (Array.isArray(t['attachments'])
          ? (t['attachments'] as Array<{ kind?: string }>).some((a) => a.kind === 'trace')
          : false),
    };
  });
}

// ─── Error & orphan run pages ────────────────────────────────────────────────

function buildErrorPage(title: string, body: string, command?: string): string {
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

function buildOrphanRunPage(latestRun: {
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

function renderDashboardOverviewPage(): string {
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

function renderHistoryPage(): string {
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
    }),
  );
}

function renderComparePage(baseline?: string, candidate?: string, series?: string): string {
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

function renderLatestDetailPage(): string {
  let summary: object | undefined;
  let collectedTests: import('../support/custom-dashboard/types').CollectedTestData[] = [];

  try {
    const summaryPath = getSummaryPath();
    if (fs.existsSync(summaryPath)) {
      const raw = JSON.parse(fs.readFileSync(summaryPath, 'utf-8'));
      summary = raw;
      collectedTests = Array.isArray(raw.testCases) ? normalizeTestCases(raw.testCases) : [];
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      summary: summary as any,
      collectedTests,
      displayName,
      isArchived,
      hasLatestRun: latestRun !== null,
      serveMode: true,
      breadcrumb: [{ label: 'Dashboard', href: '/dashboard' }, { label: 'Latest Report' }],
    }),
  );
}

function renderArchivedDetailPage(runId: string): string | null {
  if (!isValidRunId(runId)) return null;
  const summary = loadArchivedSummary(runId);
  const metadata = loadArchivedMetadata(runId);
  if (!summary && !metadata) return null;

  const rawSummary = (summary ?? {}) as Record<string, unknown>;
  const tc = Array.isArray(rawSummary.testCases)
    ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
      normalizeTestCases(rawSummary.testCases as any[])
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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        reportMode: (rawSummary.reportMode as any) ?? metadata?.reportMode ?? 'general',
        timestamp: metadata?.ranAt ?? (rawSummary.timestamp as string) ?? '',
        rolesInScope: (rawSummary.rolesInScope as string[]) ?? [],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        testCases: (rawSummary.testCases as any) ?? [],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
    }),
  );
}

// ─── JSON helpers ─────────────────────────────────────────────────────────────

function readBody(req: http.IncomingMessage): Promise<unknown> {
  const MAX_BYTES = 64 * 1024; // 64 KB — more than enough for decision+notes JSON
  return new Promise((resolve, reject) => {
    let data = '';
    let bytes = 0;
    req.on('data', (chunk: Buffer | string) => {
      bytes += Buffer.byteLength(chunk);
      if (bytes > MAX_BYTES) {
        req.destroy();
        reject(Object.assign(new Error('Request body too large'), { code: 413 }));
        return;
      }
      data += chunk;
    });
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

function jsonResponse(res: http.ServerResponse, status: number, body: unknown) {
  const json = JSON.stringify(body, null, 2);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
  });
  res.end(json);
}

function htmlResponse(res: http.ServerResponse, status: number, html: string) {
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(html);
}

// ─── Static File Handler for Artifacts & Reports ─────────────────────────────

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webm': 'video/webm',
  '.mp4': 'video/mp4',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.zip': 'application/zip',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
};

function serveStaticFile(
  res: http.ServerResponse,
  filePath: string,
  contentType?: string,
): boolean {
  try {
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      return false;
    }
    const ext = path.extname(filePath).toLowerCase();
    const mime = contentType || MIME_TYPES[ext] || 'application/octet-stream';
    const data = fs.readFileSync(filePath);
    res.writeHead(200, {
      'Content-Type': mime,
      'Content-Length': Buffer.byteLength(data),
      'Cache-Control': 'no-cache',
    });
    res.end(data);
    return true;
  } catch {
    return false;
  }
}

function resolveReportFile(relPath: string): string | null {
  const cleanRel = relPath.replace(/^\/+/, '');
  const candidate = path.resolve(process.cwd(), 'artifacts', 'reports', cleanRel);
  const root = path.resolve(process.cwd(), 'artifacts', 'reports');
  if (candidate !== root && !candidate.startsWith(`${root}${path.sep}`)) return null;
  try {
    return fs.existsSync(candidate) && fs.statSync(candidate).isFile() ? candidate : null;
  } catch {
    return null;
  }
}

function serveAttachmentsDirectory(res: http.ServerResponse, dirPath: string) {
  try {
    if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) {
      htmlResponse(
        res,
        404,
        buildErrorPage('Attachments Not Found', 'No attachments folder found for this run.'),
      );
      return;
    }
    const entries = fs.readdirSync(dirPath, { recursive: true, withFileTypes: true });
    const files = entries
      .filter((e) => e.isFile())
      .map((e) => {
        // Build relative path inside attachments directory
        const full = path.join((e as { parentPath?: string }).parentPath || dirPath, e.name);
        return path.relative(dirPath, full).replace(/\\/g, '/');
      });

    const isArchive = dirPath.includes('archive');
    const baseHref = isArchive
      ? dirPath.match(/(run-[\d-]+)/)?.[1]
        ? `/api/archive/${dirPath.match(/(run-[\d-]+)/)?.[1]}/attachments/`
        : '/attachments/'
      : '/attachments/';

    const fileListHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Attachments</title><style>body{font-family:sans-serif;padding:24px;background:#0d1117;color:#c9d1d9;}a{color:#58a6ff;text-decoration:none;display:inline-block;padding:4px 0;}a:hover{text-decoration:underline;}ul{list-style:none;padding:0;}li{margin:8px 0;border-bottom:1px solid #30363d;padding-bottom:6px;}</style></head><body><h2>Attachments Directory</h2><p style="color:#8b949e">Showing ${files.length} file(s) in: ${escapeHtml(dirPath)}</p><ul>${files.length > 0 ? files.map((f) => `<li><a href="${baseHref}${f}" target="_blank">${f}</a></li>`).join('') : '<li>No files recorded</li>'}</ul></body></html>`;
    htmlResponse(res, 200, fileListHtml);
  } catch (err) {
    htmlResponse(res, 500, buildErrorPage('Error', String(err)));
  }
}

// ─── Request router ───────────────────────────────────────────────────────────

export async function handleRequest(req: http.IncomingMessage, res: http.ServerResponse) {
  const parsed = url.parse(req.url ?? '/', true);
  const pathname = parsed.pathname ?? '/';
  const method = req.method ?? 'GET';

  // CORS preflight — kept minimal; dashboard is same-origin so no wildcard.
  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end();
    return;
  }

  // ── SSE /events ──────────────────────────────────────────────────────────
  if (pathname === '/events' && method === 'GET') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    // Tell the browser how long to wait before reconnecting after a drop, and
    // send an immediate comment so the stream is flushed as open.
    res.write('retry: 5000\n\n');
    res.write(':connected\n\n');
    sseClients.add(res);
    req.on('close', () => sseClients.delete(res));
    return;
  }

  // ── Heartbeat ─────────────────────────────────────────────────────────────
  // Accept GET as well as POST: some clients/probes send GET; a fast 200 keeps
  // the idle watchdog fed and avoids stacked pending requests.
  if (pathname === '/heartbeat' && (method === 'POST' || method === 'GET')) {
    resetHeartbeat();
    jsonResponse(res, 200, { ok: true });
    return;
  }

  // ── GET /favicon.ico — silence browser 404 noise ─────────────────────────
  if (pathname === '/favicon.ico' && method === 'GET') {
    res.writeHead(204);
    res.end();
    return;
  }

  // ── Page Route: GET / or GET /dashboard ──────────────────────────────────
  if ((pathname === '/' || pathname === '/dashboard') && method === 'GET') {
    try {
      const html = renderDashboardOverviewPage();
      htmlResponse(res, 200, html);
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end(`Error building dashboard: ${err instanceof Error ? err.message : String(err)}`);
    }
    return;
  }

  // ── Page Route: GET /history ─────────────────────────────────────────────
  if (pathname === '/history' && method === 'GET') {
    try {
      const html = renderHistoryPage();
      htmlResponse(res, 200, html);
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end(`Error building history page: ${err instanceof Error ? err.message : String(err)}`);
    }
    return;
  }

  // ── Page Route: GET /history/:runId ──────────────────────────────────────
  if (pathname.startsWith('/history/') && method === 'GET') {
    const subPath = pathname.replace('/history/', '');
    const parts = subPath.split('/');
    const runId = parts[0];

    // If sub-path requests a static report file inside history (e.g. /history/run-xxx/html/index.html or /history/html/index.html)
    if (runId === 'html' || parts.length > 1) {
      const targetRel =
        runId === 'html'
          ? `html/${parts.slice(1).join('/')}`
          : `archive/${runId}/${parts.slice(1).join('/')}`;
      const resolved = resolveReportFile(targetRel);
      if (resolved && serveStaticFile(res, resolved)) {
        return;
      }
    }

    if (runId && runId.startsWith('run-') && parts.length === 1) {
      const html = renderArchivedDetailPage(runId);
      if (!html) {
        htmlResponse(
          res,
          404,
          buildErrorPage(
            'Archived Run Not Found',
            `No archived run with ID "${escapeHtml(runId)}" exists.`,
            'npm run archive:view',
          ),
        );
        return;
      }
      htmlResponse(res, 200, html);
      return;
    }

    if (!runId || !isValidRunId(runId)) {
      htmlResponse(
        res,
        400,
        buildErrorPage('Invalid Run ID', `The run ID "${escapeHtml(runId)}" is invalid.`),
      );
      return;
    }
    try {
      const html = renderArchivedDetailPage(runId);
      if (!html) {
        htmlResponse(
          res,
          404,
          buildErrorPage(
            'Archive Not Found',
            `Archived run "${escapeHtml(runId)}" could not be found.`,
          ),
        );
        return;
      }
      htmlResponse(res, 200, html);
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end(`Error building report detail: ${err instanceof Error ? err.message : String(err)}`);
    }
    return;
  }

  // ── Page Route: GET /latest ──────────────────────────────────────────────
  if (pathname === '/latest' && method === 'GET') {
    try {
      const html = renderLatestDetailPage();
      htmlResponse(res, 200, html);
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end(`Error building latest report: ${err instanceof Error ? err.message : String(err)}`);
    }
    return;
  }

  // ── Page Route: GET /compare ─────────────────────────────────────────────
  if (pathname === '/compare' && method === 'GET') {
    const baseline = parsed.query['baseline'] as string | undefined;
    const candidate = (parsed.query['candidate'] ?? parsed.query['current']) as string | undefined;
    const series = parsed.query['series'] as string | undefined;

    if (baseline && !isValidRunId(baseline)) {
      htmlResponse(res, 400, buildErrorPage('Invalid Run ID', 'Baseline runId is invalid.'));
      return;
    }
    if (candidate && !isValidRunId(candidate)) {
      htmlResponse(res, 400, buildErrorPage('Invalid Run ID', 'Candidate runId is invalid.'));
      return;
    }

    try {
      const html = renderComparePage(baseline, candidate, series);
      htmlResponse(res, 200, html);
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end(`Error building compare page: ${err instanceof Error ? err.message : String(err)}`);
    }
    return;
  }

  // ── GET /fragment/:view — server-rendered HTML fragment for hash-router ──
  if (pathname.startsWith('/fragment/') && method === 'GET') {
    try {
      const frag = pathname.replace('/fragment/', '').split('/');
      const view = frag[0];
      let fragmentHtml: string;

      if (view === 'history') {
        const history = listReportHistory({ sort: 'newest', limit: 50 });
        const latestRun = getLatestRunInfo();
        fragmentHtml = buildHistoryPage({
          history,
          hasLatestRun: latestRun !== null,
          latestRunArchived: isLatestRunArchived(),
          latestRunId: latestRun ? generateRunId(latestRun.timestamp) : undefined,
          serveMode: true,
        });
      } else if (view === 'compare') {
        const runIds = listArchivedRunIds();
        const baseline = parsed.query['baseline'] as string | undefined;
        const current = parsed.query['current'] as string | undefined;
        if (baseline && !isValidRunId(baseline)) {
          jsonResponse(res, 400, { error: 'Invalid baseline runId' });
          return;
        }
        if (current && !isValidRunId(current)) {
          jsonResponse(res, 400, { error: 'Invalid current runId' });
          return;
        }
        let comparison: ReportComparison | null = null;
        if (baseline && current) {
          const result = compareReports(baseline, current);
          if (!('error' in result)) comparison = result;
        }
        fragmentHtml = buildComparePage({ runIds, comparison, baseline, current });
      } else if (view === 'detail') {
        const runId = frag[1] ?? '';
        if (!runId || !isValidRunId(runId)) {
          jsonResponse(res, 400, { error: 'Invalid runId' });
          return;
        }
        const summary = loadArchivedSummary(runId);
        const metadata = loadArchivedMetadata(runId);
        const scenarios = Array.isArray((summary as Record<string, unknown> | null)?.testCases)
          ? ((summary as Record<string, unknown>).testCases as Array<Record<string, unknown>>)
          : [];
        fragmentHtml = buildDetailPage({
          runId,
          summary,
          metadata,
          scenarios: scenarios.map((s) => ({
            testId: (s['testId'] as string) ?? '',
            scenarioId: (s['scenarioId'] as string) ?? '',
            title: (s['title'] as string) ?? '',
            status: (s['status'] as string) ?? 'skipped',
            role: (s['role'] as string) ?? '',
            module: (s['module'] as string) ?? '',
            feature: (s['feature'] as string) ?? '',
            priority: (s['priority'] as string) ?? 'medium',
            duration: (s['duration'] as number) ?? undefined,
            failureSource: (s['failureSource'] as string) ?? '',
            errorMessage: (s['errorMessage'] as string) ?? '',
            inputData: (s['inputData'] as Record<string, string>) ?? {},
            expectedResult: (s['expectedResult'] as string) ?? '',
            actualResult: (s['actualResult'] as string) ?? '',
            affectedLayer: (s['affectedLayer'] as string[]) ?? [],
            attachmentCount: (s['attachmentCount'] as number) ?? 0,
            hasTrace: (s['hasTrace'] as boolean) ?? false,
          })),
        });
      } else {
        jsonResponse(res, 404, { error: `Unknown fragment: ${view}` });
        return;
      }

      htmlResponse(res, 200, fragmentHtml);
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end(`Error building fragment: ${err instanceof Error ? err.message : String(err)}`);
    }
    return;
  }

  // ── GET /api/dashboard ────────────────────────────────────────────────────
  if (pathname === '/api/dashboard' && method === 'GET') {
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
    });
    jsonResponse(res, 200, overview);
    return;
  }

  // ── GET /api/status ───────────────────────────────────────────────────────
  if (pathname === '/api/status' && method === 'GET') {
    const latestRun = getLatestRunInfo();
    const archived = isLatestRunArchived();
    jsonResponse(res, 200, {
      hasLatestRun: latestRun !== null,
      latestRunArchived: archived,
      latestRun,
      archiveCount: listArchivedRunIds().length,
    });
    return;
  }

  // ── GET /api/history or GET /api/runs ─────────────────────────────────────
  if ((pathname === '/api/history' || pathname === '/api/runs') && method === 'GET') {
    const limit = parseInt((parsed.query['limit'] as string) ?? '50', 10);
    const history = listReportHistory({ sort: 'newest', limit });
    jsonResponse(res, 200, { history });
    return;
  }

  // ── GET /api/runs/latest ─────────────────────────────────────────────────
  if (pathname === '/api/runs/latest' && method === 'GET') {
    const summaryPath = getSummaryPath();
    if (!fs.existsSync(summaryPath)) {
      jsonResponse(res, 404, { error: 'No latest run found' });
      return;
    }
    try {
      const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf-8'));
      const latestRun = getLatestRunInfo();
      jsonResponse(res, 200, {
        summary,
        latestRun,
        isArchived: isLatestRunArchived(),
      });
    } catch (err) {
      jsonResponse(res, 500, { error: String(err) });
    }
    return;
  }

  // ── POST /api/archive/save or POST /api/runs/latest/archive ───────────────
  if (
    (pathname === '/api/archive/save' ||
      pathname === '/api/runs/latest/archive' ||
      pathname === '/api/runs/save') &&
    method === 'POST'
  ) {
    try {
      const body = (await readBody(req)) as Record<string, string>;
      const { decision, notes, label, series } = body;

      if (!decision) {
        jsonResponse(res, 400, { error: 'decision is required' });
        return;
      }

      const result = saveLatestRun({
        qaDecision: decision as QaDecision,
        qaNotes: notes ?? '',
        displayName: label,
        testSeriesId: series,
        triggerSource: 'dashboard-button',
      });

      broadcastEvent('archive-saved', { runId: result.runId });
      jsonResponse(res, 200, { ok: true, runId: result.runId, archivePath: result.archivePath });
    } catch (err) {
      const status = (err as { code?: number }).code === 413 ? 413 : 400;
      jsonResponse(res, status, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return;
  }

  // ── GET /api/archive/:runId or GET /api/runs/:runId ──────────────────────
  if (
    (pathname.startsWith('/api/archive/') || pathname.startsWith('/api/runs/')) &&
    method === 'GET' &&
    pathname !== '/api/archive/compare' &&
    pathname !== '/api/runs/compare' &&
    pathname !== '/api/archive/save' &&
    pathname !== '/api/runs/latest'
  ) {
    // If sub-path requests attachments folder inside archive (e.g. /api/archive/run-xxx/attachments/ or /api/archive/run-xxx/attachments)
    if (pathname.startsWith('/api/archive/') && pathname.includes('/attachments')) {
      const rest = pathname.replace('/api/archive/', '');
      const parts = rest.split('/');
      const rId = parts[0];
      const sub = parts.slice(1).join('/');
      if (sub === 'attachments' || sub === 'attachments/') {
        const targetDir = resolveReportFile(`archive/${rId}/attachments`);
        if (targetDir) {
          serveAttachmentsDirectory(res, targetDir);
          return;
        }
        // Folder is absent for this run (or runId is invalid) — give an honest
        // 404 instead of falling through to the misleading "Invalid runId" 400.
        if (isValidRunId(rId)) {
          htmlResponse(
            res,
            404,
            buildErrorPage(
              'Attachments Not Found',
              `No attachments folder found for run "${rId}". The run had no attachments to snapshot.`,
            ),
          );
          return;
        }
      }
    }

    // If sub-path requests a static file inside archive (e.g. /api/archive/run-xxx/summary.json or /api/archive/run-xxx/attachments/xxx.png)
    if (pathname.startsWith('/api/archive/') && pathname.includes('/', '/api/archive/'.length)) {
      const rest = pathname.replace('/api/archive/', '');
      const slashIdx = rest.indexOf('/');
      if (slashIdx !== -1) {
        const rId = rest.substring(0, slashIdx);
        const fileSub = rest.substring(slashIdx + 1);
        const resolved = resolveReportFile(`archive/${rId}/${fileSub}`);
        if (resolved && serveStaticFile(res, resolved)) {
          return;
        }
      }
    }

    const runId = pathname.replace(/^\/api\/(archive|runs)\//, '');
    if (!runId || /[/\\.]/.test(runId) || runId.includes('..')) {
      jsonResponse(res, 400, { error: 'Invalid runId' });
      return;
    }
    try {
      const summary = loadArchivedSummary(runId);
      const metadata = loadArchivedMetadata(runId);
      if (!summary && !metadata) {
        jsonResponse(res, 404, { error: `Archive ${escapeHtml(runId)} not found` });
        return;
      }
      const merged = {
        runId,
        ...(summary ?? {}),
        ...(metadata
          ? {
              displayName: metadata.displayName,
              testSeriesId: metadata.testSeriesId,
              requirementId: metadata.requirementId,
              qaDecision: metadata.qaDecision,
              qaNotes: metadata.qaNotes,
              savedAt: metadata.savedAt,
              appEnv: metadata.appEnv,
              reportMode: metadata.reportMode ?? 'general',
              durationMs: metadata.durationMs,
            }
          : {}),
      };
      jsonResponse(res, 200, merged);
    } catch (err) {
      jsonResponse(res, 500, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return;
  }

  // ── DELETE /api/archive/:runId or DELETE /api/runs/:runId ─────────────────
  if (
    (pathname.startsWith('/api/archive/') || pathname.startsWith('/api/runs/')) &&
    method === 'DELETE'
  ) {
    const runId = pathname.replace(/^\/api\/(archive|runs)\//, '');
    if (!runId || /[/\\.]/.test(runId) || runId.includes('..')) {
      jsonResponse(res, 400, { error: 'Invalid runId' });
      return;
    }
    try {
      const deleted = deleteArchivedReport(runId);
      if (!deleted) {
        jsonResponse(res, 404, { error: `Archive ${runId} not found` });
        return;
      }
      broadcastEvent('archive-deleted', { runId });
      jsonResponse(res, 200, { ok: true, runId });
    } catch (err) {
      jsonResponse(res, 400, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return;
  }

  // ── PATCH /api/archive/:runId or POST /api/archive/:runId/edit ─────────────
  if (
    ((pathname.startsWith('/api/archive/') || pathname.startsWith('/api/runs/')) &&
      (method === 'PATCH' || method === 'PUT')) ||
    ((pathname.startsWith('/api/archive/') || pathname.startsWith('/api/runs/')) &&
      pathname.endsWith('/edit') &&
      method === 'POST')
  ) {
    let runId = pathname.replace(/^\/api\/(archive|runs)\//, '');
    if (runId.endsWith('/edit')) runId = runId.replace(/\/edit$/, '');
    if (!runId || /[/\\.]/.test(runId) || runId.includes('..')) {
      jsonResponse(res, 400, { error: 'Invalid runId' });
      return;
    }
    try {
      const parsedBody = ((await readBody(req)) as Record<string, unknown>) || {};
      const updated = updateArchivedMetadata(runId, {
        displayName: (parsedBody['displayName'] ?? parsedBody['label']) as string | undefined,
        qaDecision: (parsedBody['qaDecision'] ?? parsedBody['decision']) as
          import('../agents/reporter/report-archive').QaDecision | undefined,
        qaNotes: (parsedBody['qaNotes'] ?? parsedBody['notes']) as string | undefined,
        testSeriesId: (parsedBody['testSeriesId'] ?? parsedBody['series']) as string | undefined,
        requirementId: parsedBody['requirementId'] as string | undefined,
        requirementTitle: parsedBody['requirementTitle'] as string | undefined,
      });

      if (!updated) {
        jsonResponse(res, 404, { error: `Archive ${runId} not found` });
        return;
      }
      broadcastEvent('archive-updated', { runId, metadata: updated });
      jsonResponse(res, 200, { ok: true, runId, metadata: updated });
    } catch (err) {
      const status = (err as { code?: number }).code === 413 ? 413 : 400;
      jsonResponse(res, status, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return;
  }

  // ── GET /api/archive/compare or GET /api/compare ─────────────────────────
  if ((pathname === '/api/archive/compare' || pathname === '/api/compare') && method === 'GET') {
    const baseline = parsed.query['baseline'] as string | undefined;
    const current = (parsed.query['current'] ?? parsed.query['candidate']) as string | undefined;

    if (baseline && !isValidRunId(baseline)) {
      jsonResponse(res, 400, { error: 'Invalid baseline runId' });
      return;
    }
    if (current && !isValidRunId(current)) {
      jsonResponse(res, 400, { error: 'Invalid current runId' });
      return;
    }

    try {
      const result =
        baseline && current ? compareReports(baseline, current) : compareLatestVsPrevious();

      if (!result || 'error' in result) {
        const message =
          result && 'error' in result
            ? result.error
            : 'Not enough archived runs to compare (need at least 2)';
        jsonResponse(res, 404, { error: message });
        return;
      }
      jsonResponse(res, 200, result);
    } catch (err) {
      jsonResponse(res, 400, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return;
  }

  // ── Static Report Files & Artifacts (HTML report, summary JSON, pipeline JSON, attachments) ──
  if (method === 'GET') {
    const cleanPath = pathname.replace(/^\/+/, '');

    // List directory for attachments folder link
    if (cleanPath === 'attachments' || cleanPath === 'attachments/') {
      const attachmentsDir = resolveReportFile('attachments');
      if (
        attachmentsDir &&
        fs.existsSync(attachmentsDir) &&
        fs.statSync(attachmentsDir).isDirectory()
      ) {
        serveAttachmentsDirectory(res, attachmentsDir);
        return;
      }
    }

    // Direct files: html/index.html, test-summary.json, pipeline-report.json, custom-dashboard.html, attachments/*, etc.
    const resolvedFile = resolveReportFile(cleanPath);
    if (resolvedFile && fs.statSync(resolvedFile).isFile()) {
      if (serveStaticFile(res, resolvedFile)) {
        return;
      }
    }
  }

  // ── 404 ───────────────────────────────────────────────────────────────────
  jsonResponse(res, 404, { error: `Not found: ${pathname}` });
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const { port, open, idle } = parseServArgs(process.argv);
  idleEnabled = idle;

  const server = http.createServer((req, res) => {
    const startedAt = Date.now();
    // Per-request render log: shows which page is being rendered and how long
    // it took, so a wedged/slow render is visible in the console.
    res.on('finish', () => {
      const ms = Date.now() - startedAt;
      const line = `[dashboard-server] ${req.method ?? 'GET'} ${req.url ?? '/'} → ${res.statusCode} (${ms}ms)`;
      if (ms >= 500) {
        console.log(`⚠️  ${line} — slow render`);
      } else {
        console.log(line);
      }
    });
    handleRequest(req, res).catch((err) => {
      console.error('[dashboard-server] Unhandled error:', err);
      try {
        jsonResponse(res, 500, { error: 'Internal server error' });
      } catch {
        // Response already sent
      }
    });
  });

  server.listen(port, '127.0.0.1', () => {
    const dashboardUrl = `http://localhost:${port}`;
    console.log('');
    console.log('────────────────────────────────────────────────────────');
    console.log(`  🌐 Dashboard running at: ${dashboardUrl}`);
    console.log(`  💾 Save / view / delete runs directly from the browser`);
    console.log(`  🔄 Auto-refresh via Server-Sent Events`);
    console.log(
      `  ⏱️  Server ${idleEnabled ? `shuts down ${HEARTBEAT_TIMEOUT_MS / 1000}s after tab is closed` : 'persists (idle disabled)'}`,
    );
    console.log('  Press Ctrl+C to stop manually');
    console.log('────────────────────────────────────────────────────────');
    console.log('');

    if (open) {
      // Cross-platform open — Windows: start, macOS: open, Linux: xdg-open
      const cmd =
        process.platform === 'win32'
          ? `start ${dashboardUrl}`
          : process.platform === 'darwin'
            ? `open ${dashboardUrl}`
            : `xdg-open ${dashboardUrl}`;
      exec(cmd, (err) => {
        if (err) console.log(`  [info] Could not auto-open browser: ${err.message}`);
      });
    }

    // Start heartbeat watchdog
    resetHeartbeat();
  });

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`\n❌ Port ${port} already in use. Try: npm run dashboard -- --port=4568`);
    } else {
      console.error('\n❌ Server error:', err.message);
    }
    process.exit(1);
  });

  // Graceful shutdown on Ctrl+C
  process.on('SIGINT', () => {
    console.log('\n[dashboard-server] Stopping...');
    server.close(() => process.exit(0));
  });
}

// Only start the server when executed directly (not when imported by tests).
// tsx runs this as CJS (package.json has no "type":"module"), so the
// require.main check works; avoid import.meta (breaks CJS test transpile).
const isMain = typeof require !== 'undefined' && require.main === module;
if (isMain) {
  main();
}
