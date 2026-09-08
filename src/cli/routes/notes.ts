import type * as http from 'node:http';

import {
  loadLatestTestNotes,
  loadArchivedTestNotes,
  upsertLatestTestNote,
  upsertArchivedTestNote,
  testNoteKey,
  MAX_TEST_NOTE_LENGTH,
} from '../../agents/reporter/test-notes';
import { isValidRunId } from '../../agents/reporter/report-archive';
import { readBody, jsonResponse, validationError, isRecord } from './helpers';

export async function handleNotesRoute(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  pathname: string,
  method: string,
  canonicalLatestArchiveRunId: () => string | null,
  broadcastEvent: (type: string, data?: unknown) => void,
): Promise<boolean> {
  const latestNotesPathname =
    pathname === '/api/notes/latest' || pathname === '/api/runs/latest/notes';
  const archivedNotesMatch = pathname.match(/^\/api\/(?:archive|runs)\/([^/]+)\/notes$/);

  if (latestNotesPathname) {
    if (method === 'GET') {
      jsonResponse(res, 200, {
        runId: canonicalLatestArchiveRunId(),
        notes: loadLatestTestNotes().notes,
        runInsights: loadLatestTestNotes().runInsights ?? [],
      });
      return true;
    }
    if (method === 'POST' || method === 'PUT') {
      try {
        const body = await readBody(req);
        if (!isRecord(body)) {
          validationError(res, 'body', 'INVALID_BODY', 'request body must be a JSON object');
          return true;
        }
        const scenarioId = typeof body['scenarioId'] === 'string' ? body['scenarioId'].trim() : '';
        const testId = typeof body['testId'] === 'string' ? body['testId'].trim() : '';
        if (!scenarioId && !testId) {
          validationError(
            res,
            'scenarioId',
            'INVALID_KEY',
            'scenarioId or testId is required to identify the test row',
          );
          return true;
        }
        const role = typeof body['role'] === 'string' ? body['role'] : undefined;
        const qaNotes = body['qaNotes'] ?? body['note'];
        if (qaNotes === undefined || typeof qaNotes !== 'string') {
          validationError(res, 'qaNotes', 'INVALID_FIELD', 'qaNotes must be a string');
          return true;
        }
        if (qaNotes.length > MAX_TEST_NOTE_LENGTH) {
          validationError(
            res,
            'qaNotes',
            'INVALID_FIELD',
            `qaNotes exceeds the maximum of ${MAX_TEST_NOTE_LENGTH} characters`,
          );
          return true;
        }
        const key = testNoteKey(scenarioId, testId, role);
        // Bind the note to the canonical run identity — an unstamped sidecar
        // would be treated as stale by the next reporter run (notes leaking
        // from run A into run B is exactly what this prevents).
        const entry = upsertLatestTestNote(
          key,
          { qaNotes },
          { runId: canonicalLatestArchiveRunId() ?? undefined },
        );
        broadcastEvent('notes-updated', { scope: 'latest', key });
        jsonResponse(res, 200, { ok: true, key, entry });
      } catch (err) {
        const status = (err as { code?: number }).code === 413 ? 413 : 400;
        jsonResponse(res, status, {
          error: err instanceof Error ? err.message : String(err),
        });
      }
      return true;
    }
  } else if (archivedNotesMatch) {
    if (method === 'GET') {
      const runId = archivedNotesMatch[1] ?? '';
      if (!isValidRunId(runId)) {
        jsonResponse(res, 400, { error: 'Invalid runId', code: 'INVALID_RUN_ID', field: 'runId' });
        return true;
      }
      const archivedNotes = loadArchivedTestNotes(runId);
      jsonResponse(res, 200, {
        runId,
        notes: archivedNotes.notes,
        runInsights: archivedNotes.runInsights ?? [],
      });
      return true;
    }
    if (method === 'POST' || method === 'PUT') {
      try {
        const body = await readBody(req);
        if (!isRecord(body)) {
          validationError(res, 'body', 'INVALID_BODY', 'request body must be a JSON object');
          return true;
        }
        const runId = archivedNotesMatch[1] ?? '';
        if (!isValidRunId(runId)) {
          jsonResponse(res, 400, {
            error: 'Invalid runId',
            code: 'INVALID_RUN_ID',
            field: 'runId',
          });
          return true;
        }
        const scenarioId = typeof body['scenarioId'] === 'string' ? body['scenarioId'].trim() : '';
        const testId = typeof body['testId'] === 'string' ? body['testId'].trim() : '';
        if (!scenarioId && !testId) {
          validationError(
            res,
            'scenarioId',
            'INVALID_KEY',
            'scenarioId or testId is required to identify the test row',
          );
          return true;
        }
        const role = typeof body['role'] === 'string' ? body['role'] : undefined;
        const qaNotes = body['qaNotes'] ?? body['note'];
        if (qaNotes === undefined || typeof qaNotes !== 'string') {
          validationError(res, 'qaNotes', 'INVALID_FIELD', 'qaNotes must be a string');
          return true;
        }
        if (qaNotes.length > MAX_TEST_NOTE_LENGTH) {
          validationError(
            res,
            'qaNotes',
            'INVALID_FIELD',
            `qaNotes exceeds the maximum of ${MAX_TEST_NOTE_LENGTH} characters`,
          );
          return true;
        }
        const key = testNoteKey(scenarioId, testId, role);
        const entry = upsertArchivedTestNote(runId, key, { qaNotes });
        broadcastEvent('notes-updated', { runId, key });
        jsonResponse(res, 200, { ok: true, key, entry });
      } catch (err) {
        const status = (err as { code?: number }).code === 413 ? 413 : 400;
        const message = err instanceof Error ? err.message : String(err);
        if (/Archive run not found/.test(message)) {
          jsonResponse(res, 404, { error: message });
          return true;
        }
        jsonResponse(res, status, { error: message });
      }
      return true;
    }
  }

  return false;
}
