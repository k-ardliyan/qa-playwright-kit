import type {
  AiInsightConfidence,
  AiInsightPriority,
  AiInsightStatus,
  AiNoteSource,
  RunInsightEntry,
} from './test-notes';
import {
  MAX_RUN_INSIGHTS,
  MAX_TEST_NOTE_LENGTH,
  latestTestNotesPath,
  normalizeForDedupe,
  redactSecrets,
} from './test-notes';
import { withNotesWrite } from './notes-lock';

/** Structured insight input — canonical format fields (ai-insight-format.md). */
export interface InsightDraft {
  /** Free-form text; used alone when no structured fields are provided. */
  message?: string;
  /** Insight kind (Jenis): root-cause, stability, test-quality, ui-ux, flow, data, trend, … */
  kind?: string;
  observation?: string;
  evidence?: string;
  impact?: string;
  recommendation?: string;
  priority?: AiInsightPriority;
  confidence?: AiInsightConfidence;
  nextAction?: string;
  status?: AiInsightStatus;
  affectedTests?: string[];
  affectedModules?: string[];
  affectedRoles?: string[];
}

const INSIGHT_FIELD_CAP = 1000;

function capField(value: string): string {
  return value.slice(0, INSIGHT_FIELD_CAP);
}

/**
 * Compose an insight into the canonical multi-line BODY format:
 * `Jenis: … | Status: … | Prioritas: … | Confidence: …` header,
 * then Observasi / Bukti / Dampak / Rekomendasi / Next Action lines.
 * The `[source]` prefix is intentionally NOT added here — it belongs to the
 * storage layer (`appendAiNote`) or the render layer (badge from entry.source),
 * so insights never end up double-prefixed. Falls back to the plain message
 * when no structured field is provided.
 */
export function composeInsightText(draft: InsightDraft): string {
  const redact = (value: string | undefined): string =>
    capField(redactSecrets((value ?? '').trim()));
  const structured = [
    draft.observation,
    draft.evidence,
    draft.impact,
    draft.recommendation,
    draft.nextAction,
  ].some((v) => typeof v === 'string' && v.trim().length > 0);

  if (!structured) {
    const text = redact(draft.message);
    if (!text) throw new Error('Insight requires a message or structured observation.');
    return text.slice(0, MAX_TEST_NOTE_LENGTH);
  }

  const headerParts: string[] = [`Jenis: ${redact(draft.kind) || 'trend'}`];
  if (draft.status) headerParts.push(`Status: ${draft.status}`);
  if (draft.priority) headerParts.push(`Prioritas: ${draft.priority}`);
  if (draft.confidence) headerParts.push(`Confidence: ${draft.confidence}`);

  const lines = [headerParts.join(' | ')];
  const body: Array<[string, string | undefined]> = [
    ['Observasi', draft.observation],
    ['Bukti', draft.evidence],
    ['Dampak', draft.impact],
    ['Rekomendasi', draft.recommendation],
    ['Next Action', draft.nextAction],
  ];
  for (const [label, value] of body) {
    const text = redact(value);
    if (text) lines.push(`${label}: ${text}`);
  }
  return lines.join('\n').slice(0, MAX_TEST_NOTE_LENGTH);
}

/** Result of a run-insight append — `deduplicated` marks a repeat insight. */
export interface AppendRunInsightResult {
  entry: RunInsightEntry;
  deduplicated: boolean;
}

/** Append a run-level insight (cross-scenario) to a sidecar file. Idempotent. */
export function appendRunInsight(
  filePath: string,
  draft: InsightDraft,
  source: AiNoteSource = 'analyzer',
  opts?: { runId?: string },
): AppendRunInsightResult {
  const text = composeInsightText(draft);
  const normalizedNew = normalizeForDedupe(text);

  return withNotesWrite(filePath, (file) => {
    const now = new Date().toISOString();
    const entry: RunInsightEntry = {
      text,
      source,
      kind: draft.kind?.trim() || undefined,
      status: draft.status,
      priority: draft.priority,
      confidence: draft.confidence,
      at: now,
      affected: {
        ...(draft.affectedTests?.length ? { tests: draft.affectedTests } : {}),
        ...(draft.affectedModules?.length ? { modules: draft.affectedModules } : {}),
        ...(draft.affectedRoles?.length ? { roles: draft.affectedRoles } : {}),
      },
    };

    const existing = file.runInsights ?? [];
    const duplicate = existing.find(
      (e) => e.source === source && normalizeForDedupe(e.text) === normalizedNew,
    );
    if (duplicate) {
      return { entry: duplicate, deduplicated: true };
    }

    const list = [...existing, entry];
    file.runInsights = list.slice(Math.max(0, list.length - MAX_RUN_INSIGHTS));
    file.updatedAt = now;
    if (opts?.runId && !file.runId) file.runId = opts.runId;
    return { entry, deduplicated: false };
  });
}

/** Append a run-level insight to the latest sidecar. */
export function appendLatestRunInsight(
  draft: InsightDraft,
  source: AiNoteSource = 'analyzer',
  opts?: { runId?: string },
): AppendRunInsightResult {
  return appendRunInsight(latestTestNotesPath(), draft, source, opts);
}
