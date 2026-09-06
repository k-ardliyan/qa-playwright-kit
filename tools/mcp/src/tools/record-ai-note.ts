import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  appendAiNote,
  appendRunInsight,
  archivedTestNotesPath,
  composeInsightText,
  latestTestNotesPath,
  MCP_AI_INSIGHT_CONFIDENCE,
  MCP_AI_INSIGHT_KINDS,
  MCP_AI_INSIGHT_PRIORITIES,
  MCP_AI_INSIGHT_STATUSES,
  MCP_AI_NOTE_SOURCES,
  testNoteKey,
  type McpAiInsightConfidence,
  type McpAiInsightKind,
  type McpAiInsightPriority,
  type McpAiInsightStatus,
  type McpAiNoteSource,
} from '../utils/test-notes';
import { resolveCurrentRunIdentity } from '../utils/run-context';

export interface RecordAiNoteInput {
  message?: string;
  scenarioId?: string;
  testId?: string;
  role?: string;
  source?: McpAiNoteSource;
  runId?: string;
  /** Insight target: a single test row (default) or the whole run. */
  scope?: 'test' | 'run';
  /** Canonical insight format fields (ai-insight-format.md). */
  kind?: McpAiInsightKind;
  observation?: string;
  evidence?: string;
  impact?: string;
  recommendation?: string;
  priority?: McpAiInsightPriority;
  confidence?: McpAiInsightConfidence;
  nextAction?: string;
  status?: McpAiInsightStatus;
  /** Scenario/module/role the run insight affects (traceability metadata). */
  affectedTests?: string[];
  affectedModules?: string[];
  affectedRoles?: string[];
}

export interface RecordAiNoteOutput {
  status: 'success' | 'error';
  scope?: 'test' | 'run';
  key?: string;
  target?: string;
  text?: string;
  deduplicated?: boolean;
  code?: string;
  message: string;
}

function isOneOf<T extends readonly string[]>(value: unknown, allowed: T): value is T[number] {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value);
}

/**
 * Append an AI-authored insight — either to a single test row (default) or to
 * the run-level insight list (scope: "run"). Structured fields render in the
 * canonical insight format; a plain message also works. Invalid enum values
 * (including `kind`) are REJECTED, never silently normalized; identical
 * insights are deduplicated and reported with `deduplicated: true`. Without
 * an explicit runId, the note attaches to the pending pipeline run when one
 * is active, else the latest run.
 */
export function recordAiNote(input: RecordAiNoteInput): RecordAiNoteOutput {
  const { scenarioId, testId, role, runId } = input ?? {};
  const error = (code: string, message: string): RecordAiNoteOutput => ({
    status: 'error',
    code,
    message,
  });

  if (!input) {
    return error('INVALID_INPUT', 'input is required.');
  }
  if (input.scope !== undefined && !isOneOf(input.scope, ['test', 'run'] as const)) {
    return error('INVALID_ENUM', 'scope must be "test" or "run".');
  }
  if (input.source !== undefined && !isOneOf(input.source, MCP_AI_NOTE_SOURCES)) {
    return error('INVALID_ENUM', `source must be one of: ${MCP_AI_NOTE_SOURCES.join(', ')}.`);
  }
  if (input.priority !== undefined && !isOneOf(input.priority, MCP_AI_INSIGHT_PRIORITIES)) {
    return error(
      'INVALID_ENUM',
      `priority must be one of: ${MCP_AI_INSIGHT_PRIORITIES.join(', ')}.`,
    );
  }
  if (input.confidence !== undefined && !isOneOf(input.confidence, MCP_AI_INSIGHT_CONFIDENCE)) {
    return error(
      'INVALID_ENUM',
      `confidence must be one of: ${MCP_AI_INSIGHT_CONFIDENCE.join(', ')}.`,
    );
  }
  if (input.status !== undefined && !isOneOf(input.status, MCP_AI_INSIGHT_STATUSES)) {
    return error('INVALID_ENUM', `status must be one of: ${MCP_AI_INSIGHT_STATUSES.join(', ')}.`);
  }
  if (input.kind !== undefined && !isOneOf(input.kind, MCP_AI_INSIGHT_KINDS)) {
    return error('INVALID_KIND', `kind must be one of: ${MCP_AI_INSIGHT_KINDS.join(', ')}.`);
  }
  for (const field of ['affectedTests', 'affectedModules', 'affectedRoles'] as const) {
    const value = input[field];
    if (
      value !== undefined &&
      (!Array.isArray(value) || value.some((v) => typeof v !== 'string'))
    ) {
      return error('INVALID_FIELD', `${field} must be an array of strings.`);
    }
  }

  const scope = input.scope === 'run' ? 'run' : 'test';
  const hasStructured = [
    input.observation,
    input.evidence,
    input.impact,
    input.recommendation,
    input.nextAction,
  ].some((v) => typeof v === 'string' && v.trim().length > 0);
  if ((!input.message || !String(input.message).trim()) && !hasStructured) {
    return error('INVALID_INPUT', 'Either message or structured observation fields are required.');
  }
  for (const field of [
    'message',
    'observation',
    'evidence',
    'impact',
    'recommendation',
    'nextAction',
  ] as const) {
    const value = input[field];
    if (value !== undefined && typeof value !== 'string') {
      return error('INVALID_FIELD', `${field} must be a string.`);
    }
    if (typeof value === 'string' && value.length > 4000) {
      return error('INVALID_FIELD', `${field} exceeds the maximum of 4000 characters.`);
    }
  }
  const source = (input.source ?? 'analyzer') as McpAiNoteSource;
  const draft = {
    message: input.message,
    kind: input.kind,
    observation: input.observation,
    evidence: input.evidence,
    impact: input.impact,
    recommendation: input.recommendation,
    nextAction: input.nextAction,
    priority: input.priority,
    confidence: input.confidence,
    status: input.status,
    affectedTests: input.affectedTests,
    affectedModules: input.affectedModules,
    affectedRoles: input.affectedRoles,
  };
  // Pending pipeline run first (Generator/Plan notes bind to the UPCOMING
  // run), then the latest run — never an unattributed sidecar.
  const attribution = resolveCurrentRunIdentity()?.runId ?? undefined;

  try {
    if (scope === 'run') {
      if (runId) {
        const notesPath = archivedTestNotesPath(runId);
        if (!notesPath) {
          return error(
            'INVALID_RUN_ID',
            `Invalid runId "${runId}". Expected pattern run-YYYYMMDD-HHmmss-SSS.`,
          );
        }
        if (!fs.existsSync(path.dirname(notesPath))) {
          return error('RUN_NOT_FOUND', `Archive run not found: ${runId}`);
        }
        const result = appendRunInsight(notesPath, draft, source);
        return {
          status: 'success',
          scope,
          target: runId,
          text: result.entry.text,
          deduplicated: result.deduplicated,
          message: result.deduplicated
            ? 'Run insight already recorded — deduplicated.'
            : 'Run insight recorded in archived run.',
        };
      }
      const result = appendRunInsight(latestTestNotesPath(), draft, source, {
        runId: attribution,
      });
      return {
        status: 'success',
        scope,
        target: 'latest',
        text: result.entry.text,
        deduplicated: result.deduplicated,
        message: result.deduplicated
          ? 'Run insight already recorded — deduplicated.'
          : 'Run insight recorded in the latest run sidecar.',
      };
    }

    let key: string;
    try {
      key = testNoteKey(scenarioId, testId, role);
    } catch (err) {
      return error('INVALID_KEY', err instanceof Error ? err.message : String(err));
    }

    if (runId) {
      const notesPath = archivedTestNotesPath(runId);
      if (!notesPath) {
        return error(
          'INVALID_RUN_ID',
          `Invalid runId "${runId}". Expected pattern run-YYYYMMDD-HHmmss-SSS.`,
        );
      }
      if (!fs.existsSync(path.dirname(notesPath))) {
        return error('RUN_NOT_FOUND', `Archive run not found: ${runId}`);
      }
      const result = appendAiNote(notesPath, key, composeInsightText(draft), source);
      return {
        status: 'success',
        scope,
        key,
        target: runId,
        text: result.entry.aiNotes,
        deduplicated: result.deduplicated,
        message: result.deduplicated
          ? 'AI insight already recorded — deduplicated.'
          : `AI insight recorded for ${key} in archived run ${runId}.`,
      };
    }

    const result = appendAiNote(latestTestNotesPath(), key, composeInsightText(draft), source, {
      runId: attribution,
    });
    return {
      status: 'success',
      scope,
      key,
      target: 'latest',
      text: result.entry.aiNotes,
      deduplicated: result.deduplicated,
      message: result.deduplicated
        ? 'AI insight already recorded — deduplicated.'
        : `AI insight recorded for ${key} in the latest run sidecar.`,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.startsWith('NOTES_LOCK_TIMEOUT')) {
      return error('NOTES_LOCK_TIMEOUT', message);
    }
    return error('WRITE_FAILED', message);
  }
}
