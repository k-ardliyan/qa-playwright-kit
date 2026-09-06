import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  archivedTestNotesPath,
  latestTestNotesPath,
  testNoteKey,
  upsertTestNote,
} from '../utils/test-notes';
import { resolveCurrentRunIdentity } from '../utils/run-context';

export interface SetTestNoteInput {
  note: string;
  scenarioId?: string;
  testId?: string;
  role?: string;
  runId?: string;
}

export interface SetTestNoteOutput {
  status: 'success' | 'error';
  key?: string;
  target?: string;
  qaNotes?: string;
  message: string;
}

/**
 * Set or clear the QA free-text note for one test row in the report notes
 * sidecar (NOTES column). Replaces the previous QA note for that row.
 */
export function setTestNote(input: SetTestNoteInput): SetTestNoteOutput {
  const { note, scenarioId, testId, role, runId } = input ?? {};

  if (!input || typeof note !== 'string') {
    return { status: 'error', message: 'note is required and must be a string (empty clears).' };
  }
  if (note.length > 4000) {
    return {
      status: 'error',
      message: `note exceeds the maximum of 4000 characters (${note.length}).`,
    };
  }

  let key: string;
  try {
    key = testNoteKey(scenarioId, testId, role);
  } catch (err) {
    return { status: 'error', message: err instanceof Error ? err.message : String(err) };
  }

  try {
    if (runId) {
      const notesPath = archivedTestNotesPath(runId);
      if (!notesPath) {
        return {
          status: 'error',
          message: `Invalid runId "${runId}". Expected pattern run-YYYYMMDD-HHmmss-SSS.`,
        };
      }
      if (!fs.existsSync(path.dirname(notesPath))) {
        return { status: 'error', message: `Archive run not found: ${runId}` };
      }
      const entry = upsertTestNote(notesPath, key, { qaNotes: note });
      return {
        status: 'success',
        key,
        target: runId,
        qaNotes: entry.qaNotes,
        message: `QA note set for ${key} in archived run ${runId}.`,
      };
    }

    const entry = upsertTestNote(
      latestTestNotesPath(),
      key,
      { qaNotes: note },
      { runId: resolveCurrentRunIdentity()?.runId ?? undefined },
    );
    return {
      status: 'success',
      key,
      target: 'latest',
      qaNotes: entry.qaNotes,
      message: `QA note set for ${key} in the latest run sidecar.`,
    };
  } catch (err) {
    return { status: 'error', message: err instanceof Error ? err.message : String(err) };
  }
}
