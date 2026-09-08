import type * as http from 'node:http';
import * as url from 'node:url';

import {
  saveLatestRun,
  updateArchivedMetadata,
  deleteArchivedReport,
  loadArchivedSummary,
  loadArchivedMetadata,
  isValidRunId,
  isQaDecision,
  QA_DECISIONS,
  type QaDecision,
} from '../../agents/reporter/report-archive';
import { compareLatestVsPrevious, compareReports } from '../../agents/reporter/report-compare';
import { loadArchivedTestNotes, mergeTestNotes } from '../../agents/reporter/test-notes';
import type { CollectedTestCase } from '../../support/custom-dashboard/types';
import { escapeHtml } from '../../support/custom-dashboard/shared';
import { readBody, jsonResponse, htmlResponse, validationError, isRecord, hasOwn } from './helpers';
import { buildErrorPage } from './render';

export interface ArchiveRouteDependencies {
  broadcastEvent: (type: string, data?: unknown) => void;
  resolveArchivePath: (
    runId: string,
    relPath: string,
    kind: 'file' | 'directory' | 'any',
  ) => string | null;
  serveAttachmentsDirectory: (res: http.ServerResponse, dirPath: string, baseHref?: string) => void;
  serveStaticFile: (res: http.ServerResponse, filePath: string, contentType?: string) => boolean;
}

export async function handleArchiveRoute(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  pathname: string,
  method: string,
  parsed: url.UrlWithParsedQuery,
  deps: ArchiveRouteDependencies,
): Promise<boolean> {
  // ── POST /api/archive/save or POST /api/runs/latest/archive ───────────────
  if (
    (pathname === '/api/archive/save' ||
      pathname === '/api/runs/latest/archive' ||
      pathname === '/api/runs/save') &&
    method === 'POST'
  ) {
    try {
      const body = ((await readBody(req)) || {}) as Record<string, unknown>;
      const decision = body['decision'];
      const notes = body['notes'];
      const label = body['label'];
      const series = body['series'];

      if (!isQaDecision(decision)) {
        validationError(
          res,
          'decision',
          'INVALID_QA_DECISION',
          `decision must be one of: ${QA_DECISIONS.join(', ')}`,
        );
        return true;
      }
      if (label !== undefined && (typeof label !== 'string' || label.trim() === '')) {
        validationError(res, 'label', 'INVALID_LABEL', 'label must be a non-empty string');
        return true;
      }
      if (notes !== undefined && typeof notes !== 'string') {
        validationError(res, 'notes', 'INVALID_FIELD', 'notes must be a string');
        return true;
      }
      if (series !== undefined && typeof series !== 'string') {
        validationError(res, 'series', 'INVALID_FIELD', 'series must be a string');
        return true;
      }

      const result = saveLatestRun({
        qaDecision: decision,
        qaNotes: (notes as string | undefined) ?? '',
        displayName: label as string | undefined,
        testSeriesId: series as string | undefined,
        triggerSource: 'dashboard-button',
      });

      deps.broadcastEvent('archive-saved', { runId: result.runId });
      jsonResponse(res, 200, { ok: true, runId: result.runId, archivePath: result.archivePath });
    } catch (err) {
      const status = (err as { code?: number }).code === 413 ? 413 : 400;
      jsonResponse(res, status, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return true;
  }

  // ── GET /api/archive/compare or GET /api/compare ─────────────────────────
  if ((pathname === '/api/archive/compare' || pathname === '/api/compare') && method === 'GET') {
    const baseline = parsed.query['baseline'] as string | undefined;
    const current = (parsed.query['current'] ?? parsed.query['candidate']) as string | undefined;

    if (baseline && !isValidRunId(baseline)) {
      jsonResponse(res, 400, { error: 'Invalid baseline runId' });
      return true;
    }
    if (current && !isValidRunId(current)) {
      jsonResponse(res, 400, { error: 'Invalid current runId' });
      return true;
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
        return true;
      }
      jsonResponse(res, 200, result);
    } catch (err) {
      jsonResponse(res, 400, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return true;
  }

  // ── GET /api/archive/:runId or GET /api/runs/:runId ──────────────────────
  if (
    (pathname.startsWith('/api/archive/') || pathname.startsWith('/api/runs/')) &&
    method === 'GET' &&
    pathname !== '/api/archive/compare' &&
    pathname !== '/api/runs/compare' &&
    pathname !== '/api/archive/save' &&
    pathname !== '/api/runs/latest' &&
    !pathname.endsWith('/notes')
  ) {
    const archiveMatch = pathname.match(/^\/api\/(?:archive|runs)\/([^/]+)(?:\/(.*))?$/);
    if (archiveMatch) {
      const rId = archiveMatch[1];
      const fileSub = archiveMatch[2] ?? '';
      // Validate runId before resolving either files or directories.
      if (!isValidRunId(rId)) {
        jsonResponse(res, 400, {
          error: 'Invalid runId',
          code: 'INVALID_RUN_ID',
          field: 'runId',
        });
        return true;
      }
      if (fileSub === 'attachments' || fileSub === 'attachments/') {
        const targetDir = deps.resolveArchivePath(rId, 'attachments', 'directory');
        if (targetDir) {
          deps.serveAttachmentsDirectory(
            res,
            targetDir,
            `/api/archive/${encodeURIComponent(rId)}/attachments/`,
          );
        } else {
          htmlResponse(
            res,
            404,
            buildErrorPage(
              'Attachments Not Found',
              `No attachments folder found for run "${escapeHtml(rId)}". The run had no attachments to snapshot.`,
            ),
          );
        }
        return true;
      }
      if (fileSub) {
        const resolved = deps.resolveArchivePath(rId, fileSub, 'file');
        if (resolved && deps.serveStaticFile(res, resolved)) return true;
        jsonResponse(res, 404, { error: 'Archive file not found' });
        return true;
      }
    }

    const runId = pathname.replace(/^\/api\/(archive|runs)\//, '');
    if (!runId || !isValidRunId(runId)) {
      jsonResponse(res, 400, {
        error: 'Invalid runId',
        code: 'INVALID_RUN_ID',
        field: 'runId',
      });
      return true;
    }
    try {
      const summary = loadArchivedSummary(runId);
      const metadata = loadArchivedMetadata(runId);
      if (!summary && !metadata) {
        jsonResponse(res, 404, { error: `Archive ${escapeHtml(runId)} not found` });
        return true;
      }
      const merged: Record<string, unknown> = {
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
      if (Array.isArray(merged.testCases)) {
        merged.testCases = mergeTestNotes(
          merged.testCases as CollectedTestCase[],
          loadArchivedTestNotes(runId),
        );
      }
      jsonResponse(res, 200, merged);
    } catch (err) {
      jsonResponse(res, 500, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return true;
  }

  // ── DELETE /api/archive/:runId or DELETE /api/runs/:runId ─────────────────
  if (
    (pathname.startsWith('/api/archive/') || pathname.startsWith('/api/runs/')) &&
    method === 'DELETE' &&
    !pathname.endsWith('/notes')
  ) {
    const runId = pathname.replace(/^\/api\/(archive|runs)\//, '');
    if (!runId || !isValidRunId(runId)) {
      jsonResponse(res, 400, { error: 'Invalid runId', code: 'INVALID_RUN_ID', field: 'runId' });
      return true;
    }
    try {
      const deleted = deleteArchivedReport(runId);
      if (!deleted) {
        jsonResponse(res, 404, { error: `Archive ${runId} not found` });
        return true;
      }
      deps.broadcastEvent('archive-deleted', { runId });
      jsonResponse(res, 200, { ok: true, runId });
    } catch (err) {
      jsonResponse(res, 400, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return true;
  }

  // ── PATCH /api/archive/:runId or POST /api/archive/:runId/edit ─────────────
  if (
    !pathname.endsWith('/notes') &&
    (((pathname.startsWith('/api/archive/') || pathname.startsWith('/api/runs/')) &&
      (method === 'PATCH' || method === 'PUT')) ||
      ((pathname.startsWith('/api/archive/') || pathname.startsWith('/api/runs/')) &&
        pathname.endsWith('/edit') &&
        method === 'POST'))
  ) {
    let runId = pathname.replace(/^\/api\/(archive|runs)\//, '');
    if (runId.endsWith('/edit')) runId = runId.replace(/\/edit$/, '');
    if (!runId || !isValidRunId(runId)) {
      jsonResponse(res, 400, { error: 'Invalid runId', code: 'INVALID_RUN_ID', field: 'runId' });
      return true;
    }
    try {
      const rawBody = await readBody(req);
      if (!isRecord(rawBody)) {
        validationError(res, 'body', 'INVALID_BODY', 'request body must be a JSON object');
        return true;
      }
      const parsedBody = rawBody;
      const decisionValue = parsedBody['qaDecision'] ?? parsedBody['decision'];
      const labelValue = parsedBody['displayName'] ?? parsedBody['label'];
      if (hasOwn(parsedBody, 'qaDecision') || hasOwn(parsedBody, 'decision')) {
        if (!isQaDecision(decisionValue)) {
          validationError(
            res,
            'qaDecision',
            'INVALID_QA_DECISION',
            `qaDecision must be one of: ${QA_DECISIONS.join(', ')}`,
          );
          return true;
        }
      }
      if (hasOwn(parsedBody, 'displayName') || hasOwn(parsedBody, 'label')) {
        if (typeof labelValue !== 'string' || labelValue.trim() === '') {
          validationError(
            res,
            'displayName',
            'INVALID_LABEL',
            'displayName must be a non-empty string',
          );
          return true;
        }
      }
      for (const [key, value] of [
        ['qaNotes', parsedBody['qaNotes'] ?? parsedBody['notes']],
        ['testSeriesId', parsedBody['testSeriesId'] ?? parsedBody['series']],
        ['requirementId', parsedBody['requirementId']],
        ['requirementTitle', parsedBody['requirementTitle']],
      ] as const) {
        if (value !== undefined && typeof value !== 'string') {
          validationError(res, key, 'INVALID_FIELD', `${key} must be a string`);
          return true;
        }
      }
      const updated = updateArchivedMetadata(runId, {
        displayName: (parsedBody['displayName'] ?? parsedBody['label']) as string | undefined,
        qaDecision: (parsedBody['qaDecision'] ?? parsedBody['decision']) as QaDecision | undefined,
        qaNotes: (parsedBody['qaNotes'] ?? parsedBody['notes']) as string | undefined,
        testSeriesId: (parsedBody['testSeriesId'] ?? parsedBody['series']) as string | undefined,
        requirementId: parsedBody['requirementId'] as string | undefined,
        requirementTitle: parsedBody['requirementTitle'] as string | undefined,
      });

      if (!updated) {
        jsonResponse(res, 404, { error: `Archive ${runId} not found` });
        return true;
      }
      deps.broadcastEvent('archive-updated', { runId, metadata: updated });
      jsonResponse(res, 200, { ok: true, runId, metadata: updated });
    } catch (err) {
      const status = (err as { code?: number }).code === 413 ? 413 : 400;
      jsonResponse(res, status, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return true;
  }

  return false;
}
