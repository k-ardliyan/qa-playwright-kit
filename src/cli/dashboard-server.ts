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
  getLatestRunInfo,
  listArchivedRunIds,
  isLatestRunArchived,
  loadArchivedSummary,
  loadArchivedMetadata,
  generateRunId,
  isValidRunId,
  getArchiveDir,
} from '../agents/reporter/report-archive';
import { compareLatestVsPrevious, compareReports } from '../agents/reporter/report-compare';
import type { ReportComparison } from '../agents/reporter/report-compare';
import {
  loadLatestTestNotes,
  loadArchivedTestNotes,
  mergeTestNotes,
} from '../agents/reporter/test-notes';
import type { CollectedTestCase } from '../support/custom-dashboard/types';
import {
  buildComparePage,
  buildHistoryPage,
  buildDetailPage,
} from '../support/custom-dashboard/build-fragments';
import { escapeHtml } from '../support/custom-dashboard/shared';
import { resolveWorkspaceReportDir } from '../shared/workspace-paths';
import { resolveCurrentRunIdentity } from '../agents/reporter/run-context';

import {
  jsonResponse,
  htmlResponse,
  validationError,
  readBody,
  isRecord,
  hasOwn,
} from './routes/helpers';
import {
  getSummaryPath,
  normalizeTestCases,
  buildErrorPage,
  buildOrphanRunPage,
  renderDashboardOverviewPage,
  renderHistoryPage,
  renderComparePage,
  renderLatestDetailPage,
  renderArchivedDetailPage,
  buildDashboardOverviewPayload,
} from './routes/render';
import { handleNotesRoute } from './routes/notes';
import { handleArchiveRoute } from './routes/archive';

export {
  jsonResponse,
  htmlResponse,
  validationError,
  readBody,
  isRecord,
  hasOwn,
  getSummaryPath,
  normalizeTestCases,
  buildErrorPage,
  buildOrphanRunPage,
  renderDashboardOverviewPage,
  renderHistoryPage,
  renderComparePage,
  renderLatestDetailPage,
  renderArchivedDetailPage,
  buildDashboardOverviewPayload,
};

// ─── Config ──────────────────────────────────────────────────────────────────

const DEFAULT_PORT = 4567;
const HEARTBEAT_TIMEOUT_MS = 20_000; // server shuts down if no heartbeat for 20s

/**
 * Canonical archive runId of the latest run (run-YYYYMMDD-HHmmss-SSS from the
 * run timestamp) — the same identity the archiver will use. A pending
 * pipeline run (active pipeline, pre-run notes) takes precedence. Null when
 * neither exists. Notes written for the latest run are stamped with this so
 * they can never leak into a subsequent run.
 */
function canonicalLatestArchiveRunId(): string | null {
  return resolveCurrentRunIdentity()?.runId ?? null;
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

function isContainedPath(root: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return (
    relative === '' ||
    (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
  );
}

/** Resolve an existing path while enforcing lexical and realpath containment. */
function resolveContainedPath(
  root: string,
  relPath: string,
  kind: 'file' | 'directory' | 'any',
): string | null {
  const cleanRel = relPath.replace(/^\/+/, '');
  const pathSegments = cleanRel.replace(/\\/g, '/').split('/');
  if (pathSegments.some((segment) => segment === '.' || segment === '..')) return null;
  const candidate = path.resolve(root, cleanRel);
  if (!isContainedPath(root, candidate)) return null;
  try {
    if (!fs.existsSync(root) || !fs.existsSync(candidate)) return null;
    const rootReal = fs.realpathSync(root);
    const candidateReal = fs.realpathSync(candidate);
    if (!isContainedPath(rootReal, candidateReal)) return null;
    const stat = fs.statSync(candidateReal);
    if (kind === 'file' && !stat.isFile()) return null;
    if (kind === 'directory' && !stat.isDirectory()) return null;
    return candidateReal;
  } catch {
    return null;
  }
}

function resolveReportPath(
  relPath: string,
  kind: 'file' | 'directory' | 'any' = 'any',
): string | null {
  return resolveContainedPath(resolveWorkspaceReportDir(), relPath, kind);
}

function resolveReportFile(relPath: string): string | null {
  return resolveReportPath(relPath, 'file');
}

/** Separate directory resolver: callers must opt into serving a folder. */
function resolveReportDirectory(relPath: string): string | null {
  return resolveReportPath(relPath, 'directory');
}

/** Archive resolver keeps archive routes scoped to the configured archive root. */
function resolveArchivePath(
  runId: string,
  relPath: string,
  kind: 'file' | 'directory' | 'any',
): string | null {
  if (!isValidRunId(runId)) return null;
  return resolveContainedPath(getArchiveDir(), path.join(runId, relPath), kind);
}

function decodeRequestPath(rawPath: string): string | null {
  try {
    const decoded = decodeURIComponent(rawPath);
    return decoded.includes('\0') ? null : decoded;
  } catch {
    return null;
  }
}

function encodePathForUrl(relativePath: string): string {
  return relativePath
    .replace(/\\/g, '/')
    .split('/')
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

function serveAttachmentsDirectory(
  res: http.ServerResponse,
  dirPath: string,
  baseHref = '/attachments/',
) {
  try {
    if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) {
      htmlResponse(
        res,
        404,
        buildErrorPage('Attachments Not Found', 'No attachments folder found for this run.'),
      );
      return;
    }

    // Walk explicitly instead of relying on Dirent.parentPath, which is not
    // available on every supported Node version and loses nested paths.
    const files: string[] = [];
    const walk = (current: string) => {
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        const full = path.join(current, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.isFile()) files.push(path.relative(dirPath, full).replace(/\\/g, '/'));
      }
    };
    walk(dirPath);
    files.sort();

    const fileListHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Attachments</title><style>body{font-family:sans-serif;padding:24px;background:#0d1117;color:#c9d1d9;}a{color:#58a6ff;text-decoration:none;display:inline-block;padding:4px 0;}a:hover{text-decoration:underline;}ul{list-style:none;padding:0;}li{margin:8px 0;border-bottom:1px solid #30363d;padding-bottom:6px;}</style></head><body><h2>Attachments Directory</h2><p style="color:#8b949e">Showing ${files.length} file(s) in: ${escapeHtml(dirPath)}</p><ul>${files.length > 0 ? files.map((f) => `<li><a href="${baseHref}${encodePathForUrl(f)}" target="_blank" rel="noopener">${escapeHtml(f)}</a></li>`).join('') : '<li>No files recorded</li>'}</ul></body></html>`;
    htmlResponse(res, 200, fileListHtml);
  } catch (err) {
    htmlResponse(res, 500, buildErrorPage('Error', String(err)));
  }
}

// ─── Request router ───────────────────────────────────────────────────────────

export async function handleRequest(req: http.IncomingMessage, res: http.ServerResponse) {
  const parsed = url.parse(req.url ?? '/', true);
  const rawPathname = parsed.pathname ?? '/';
  const pathname = decodeRequestPath(rawPathname);
  const method = req.method ?? 'GET';

  if (pathname === null) {
    jsonResponse(res, 400, { error: 'Invalid URL path' });
    return;
  }

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

    // Validate archive scope before resolving any static sub-path.
    if (runId === 'html' || parts.length > 1) {
      if (runId !== 'html' && !isValidRunId(runId)) {
        jsonResponse(res, 400, { error: 'Invalid runId', code: 'INVALID_RUN_ID', field: 'runId' });
        return;
      }
      const targetRel =
        runId === 'html'
          ? `html/${parts.slice(1).join('/')}`
          : `archive/${runId}/${parts.slice(1).join('/')}`;
      const resolvedDir = resolveReportDirectory(targetRel);
      if (resolvedDir) {
        serveAttachmentsDirectory(res, resolvedDir, `/history/${parts.join('/')}/`);
        return;
      }
      const resolvedFile = resolveReportFile(targetRel);
      if (resolvedFile && serveStaticFile(res, resolvedFile)) return;
      jsonResponse(res, 404, { error: 'Not found' });
      return;
    }

    // Individual archive view — serve ReportDetailPage with data from the archive directory
    if (!runId || !isValidRunId(runId)) {
      jsonResponse(res, 400, { error: 'Invalid runId', code: 'INVALID_RUN_ID', field: 'runId' });
      return;
    }
    try {
      const pageHtml = renderArchivedDetailPage(runId);
      if (!pageHtml) {
        htmlResponse(
          res,
          404,
          buildErrorPage('Run Not Found', `No archived run with ID "${escapeHtml(runId)}".`),
        );
        return;
      }
      htmlResponse(res, 200, pageHtml);
    } catch (err) {
      htmlResponse(
        res,
        500,
        buildErrorPage('Error', err instanceof Error ? err.message : String(err)),
      );
    }
    return;
  }

  // ── Page Route: GET /compare ─────────────────────────────────────────────
  if (pathname === '/compare' && method === 'GET') {
    try {
      const baseline = parsed.query['baseline'] as string | undefined;
      const candidate = (parsed.query['candidate'] ?? parsed.query['current']) as
        | string
        | undefined;
      const series = parsed.query['series'] as string | undefined;
      const html = renderComparePage(baseline, candidate, series);
      htmlResponse(res, 200, html);
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end(`Error building compare page: ${err instanceof Error ? err.message : String(err)}`);
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
      res.end(`Error building detail page: ${err instanceof Error ? err.message : String(err)}`);
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
        const rawScenarios = Array.isArray((summary as Record<string, unknown> | null)?.testCases)
          ? ((summary as Record<string, unknown>).testCases as Array<Record<string, unknown>>)
          : [];
        // Overlay the archived run's per-test notes sidecar (QA + AI notes)
        const mergedScenarios = mergeTestNotes(
          rawScenarios as unknown as CollectedTestCase[],
          loadArchivedTestNotes(runId),
        ) as unknown as Array<Record<string, unknown>>;
        const scenarios = mergedScenarios.map(
          (s: Record<string, unknown>) =>
            ({
              testId: (s['testId'] as string) ?? '',
              scenarioId: (s['scenarioId'] as string) ?? '',
              title: (s['title'] as string) ?? '',
              fullTitle: (s['fullTitle'] as string) ?? (s['title'] as string) ?? '',
              filePath: (s['filePath'] as string) ?? '',
              retry: (s['retry'] as number) ?? 0,
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
              qaNotes: (s['qaNotes'] as string) ?? '',
              aiNotes: (s['aiNotes'] as string) ?? '',
              errors: (s['errors'] as Array<{ message: string; stack?: string }>) ?? [],
              steps:
                (s['steps'] as Array<{
                  title: string;
                  status: string;
                  duration: number;
                  errorMessage?: string;
                  steps?: unknown[];
                }>) ?? [],
              attachments:
                (s['attachments'] as Array<{
                  name: string;
                  contentType?: string;
                  relativePath: string;
                  kind: string;
                }>) ?? [],
            }) as Record<string, unknown>,
        );
        fragmentHtml = buildDetailPage({
          runId,
          summary,
          metadata,
          // Deterministic insights baked into the archived summary + agent
          // insights from the archived sidecar — both, clearly sourced.
          runInsights: [
            ...(Array.isArray((summary as Record<string, unknown> | null)?.['aiInsights'])
              ? ((summary as Record<string, unknown>)['aiInsights'] as unknown[])
                  .filter((v): v is string => typeof v === 'string')
                  .map((text) => ({ text, source: 'analyzer' }))
              : []),
            ...(loadArchivedTestNotes(runId).runInsights ?? []),
          ],
          scenarios:
            scenarios as import('../support/custom-dashboard/build-fragments').DetailScenario[],
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

  // ── GET /api/dashboard — overview payload ─────────────────────────────────
  if (pathname === '/api/dashboard' && method === 'GET') {
    try {
      jsonResponse(res, 200, buildDashboardOverviewPayload());
    } catch (err) {
      jsonResponse(res, 500, { error: String(err) });
    }
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

  // ── GET latest attachment folder aliases ──────────────────────────────────
  if (
    method === 'GET' &&
    (pathname === '/latest/attachments' ||
      pathname === '/latest/attachments/' ||
      pathname === '/api/runs/latest/attachments' ||
      pathname === '/api/runs/latest/attachments/')
  ) {
    const attachmentsDir = resolveReportDirectory('attachments');
    if (attachmentsDir) {
      serveAttachmentsDirectory(res, attachmentsDir, '/attachments/');
    } else {
      htmlResponse(
        res,
        404,
        buildErrorPage('Attachments Not Found', 'No attachments folder found.'),
      );
    }
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
      // Overlay per-test sidecar notes for consumers reading testCases
      if (Array.isArray(summary?.testCases)) {
        summary.testCases = mergeTestNotes(
          summary.testCases as CollectedTestCase[],
          loadLatestTestNotes(),
        );
      }
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

  // ── Per-test notes API — sidecar read/write (QA + AI notes) ──────────────
  if (
    await handleNotesRoute(req, res, pathname, method, canonicalLatestArchiveRunId, broadcastEvent)
  ) {
    return;
  }

  // ── Archive API ──────────────────────────────────────────────────────────
  if (
    await handleArchiveRoute(req, res, pathname, method, parsed, {
      broadcastEvent,
      resolveArchivePath,
      serveAttachmentsDirectory,
      serveStaticFile,
    })
  ) {
    return;
  }

  // ── Static Report Files & Artifacts (HTML report, summary JSON, pipeline JSON, attachments) ──
  if (method === 'GET') {
    const cleanPath = pathname.replace(/^\/+/, '');

    // List directory for attachments folder link
    if (cleanPath === 'attachments' || cleanPath === 'attachments/') {
      const attachmentsDir = resolveReportDirectory('attachments');
      if (attachmentsDir) {
        serveAttachmentsDirectory(res, attachmentsDir, '/attachments/');
        return;
      }
      // A valid but empty/missing attachments directory is still a meaningful
      // route; report a normal 404 rather than falling through as an arbitrary file.
      htmlResponse(
        res,
        404,
        buildErrorPage('Attachments Not Found', 'No attachments folder found.'),
      );
      return;
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
