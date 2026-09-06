/**
 * Per-test notes sidecar for MCP tools — self-contained twin of
 * `src/agents/reporter/test-notes.ts` (the MCP server builds separately and
 * must not import from src/). Same schema: qa.test-notes/v1, keyed by
 * `<scenarioId>::<role>` with testId fallback, `user` ↔ `general` alias,
 * secret redaction, idempotent appends, and locked atomic writes.
 *
 * @module tools/mcp/src/utils/test-notes
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { mcpWorkspace } from './workspace-paths';

export interface McpTestNoteEntry {
  qaNotes: string;
  aiNotes: string;
  qaUpdatedAt?: string;
  aiUpdatedAt?: string;
}

export interface McpTestNotesFile {
  version: 1;
  runId?: string;
  updatedAt: string;
  notes: Record<string, McpTestNoteEntry>;
  runInsights?: McpRunInsightEntry[];
}

export const MCP_TEST_NOTES_VERSION = 1;
export const MCP_MAX_TEST_NOTE_LENGTH = 4000;
export const MCP_AI_NOTE_SOURCES = ['healer', 'generator', 'reporter', 'analyzer'] as const;
export type McpAiNoteSource = (typeof MCP_AI_NOTE_SOURCES)[number];

export const MCP_AI_INSIGHT_STATUSES = ['observed', 'inferred', 'recommendation'] as const;
export type McpAiInsightStatus = (typeof MCP_AI_INSIGHT_STATUSES)[number];
/** Canonical insight taxonomy (Jenis) — mirrors AI_INSIGHT_KINDS in src. */
export const MCP_AI_INSIGHT_KINDS = [
  'ui-ux',
  'flow',
  'data',
  'stability',
  'security',
  'test-quality',
  'root-cause',
  'coverage',
  'trend',
] as const;
export type McpAiInsightKind = (typeof MCP_AI_INSIGHT_KINDS)[number];
export const MCP_AI_INSIGHT_PRIORITIES = ['high', 'medium', 'low'] as const;
export type McpAiInsightPriority = (typeof MCP_AI_INSIGHT_PRIORITIES)[number];
export const MCP_AI_INSIGHT_CONFIDENCE = ['high', 'medium', 'low'] as const;
export type McpAiInsightConfidence = (typeof MCP_AI_INSIGHT_CONFIDENCE)[number];
/** Max stored run-level insights — oldest entries are dropped beyond this. */
export const MCP_MAX_RUN_INSIGHTS = 50;

export interface McpRunInsightEntry {
  text: string;
  source: McpAiNoteSource;
  kind?: string;
  status?: McpAiInsightStatus;
  priority?: McpAiInsightPriority;
  confidence?: McpAiInsightConfidence;
  at: string;
  /** Traceability metadata — what the insight affects. */
  affected?: {
    tests?: string[];
    modules?: string[];
    roles?: string[];
  };
}

/** Structured insight input — canonical format fields (ai-insight-format.md). */
export interface McpInsightDraft {
  message?: string;
  kind?: string;
  observation?: string;
  evidence?: string;
  impact?: string;
  recommendation?: string;
  priority?: McpAiInsightPriority;
  confidence?: McpAiInsightConfidence;
  nextAction?: string;
  status?: McpAiInsightStatus;
  affectedTests?: string[];
  affectedModules?: string[];
  affectedRoles?: string[];
}

const MCP_INSIGHT_FIELD_CAP = 1000;

// ─── Secret redaction (twin of src/agents/reporter/test-notes.ts) ───────────

const MCP_SECRET_PATTERNS: Array<[RegExp, (match: string) => string]> = [
  [
    /\b(password|passwd|pwd|secret|api[_-]?key|apikey|access[_-]?token|refresh[_-]?token|id[_-]?token|client[_-]?secret|auth(?:orization)?)\s*[:=]\s*["']?[^\s"',;]{4,}/gi,
    (m) => `${m.split(/[:=]/)[0]?.trim() ?? 'key'}: [REDACTED]`,
  ],
  [/\b(?:Bearer|Basic)\s+[A-Za-z0-9\-._~+/]{8,}={0,2}/gi, () => 'Bearer [REDACTED]'],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*/g, () => '[REDACTED_JWT]'],
  [/\b(?:set-cookie|cookie)\s*:\s*[^\r\n]{8,}/gi, () => '[REDACTED_COOKIE]'],
  [/\bAKIA[0-9A-Z]{16}\b/g, () => '[REDACTED_AWS_KEY]'],
  [
    /\b(?:otp|otp[_-]?code|one[_-]?time[_-]?code|verif(?:y|ication)[_-]?code)\s*[:=]\s*["']?\d{4,8}\b/gi,
    (m) => `${m.split(/[:=]/)[0]?.trim() ?? 'code'}: [REDACTED]`,
  ],
];

/** Defensive redaction before any note text touches disk. */
export function redactSecrets(text: string): string {
  let out = text ?? '';
  for (const [pattern, replace] of MCP_SECRET_PATTERNS) {
    out = out.replace(pattern, replace);
  }
  return out;
}

function normalizeForDedupe(text: string): string {
  return text
    .replace(/^\[[a-z]+\]\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Compose an insight into the canonical multi-line BODY format — twin of
 * composeInsightText in src/agents/reporter/test-notes.ts. The `[source]`
 * prefix is intentionally NOT added here; storage/render layers own it so
 * insights never end up double-prefixed.
 */
export function composeInsightText(draft: McpInsightDraft): string {
  const redact = (value: string | undefined): string =>
    redactSecrets((value ?? '').trim()).slice(0, MCP_INSIGHT_FIELD_CAP);
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
    return text.slice(0, MCP_MAX_TEST_NOTE_LENGTH);
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
  return lines.join('\n').slice(0, MCP_MAX_TEST_NOTE_LENGTH);
}

function archiveDir(): string {
  if (process.env['QA_ARCHIVE_DIR']) return process.env['QA_ARCHIVE_DIR'];
  return path.join(mcpWorkspace.reportsDir, 'archive');
}

export function latestTestNotesPath(): string {
  return path.join(mcpWorkspace.reportsDir, 'test-notes.json');
}

export function archivedTestNotesPath(runId: string): string | null {
  if (!isValidRunIdFormat(runId)) return null;
  return path.join(archiveDir(), runId, 'test-notes.json');
}

/** Same validation as report-archive.isValidRunId / src test-notes. */
export function isValidRunIdFormat(runId: string): boolean {
  return (
    /^run-[\d-]+$/.test(runId) &&
    !runId.includes('..') &&
    !runId.includes('/') &&
    !runId.includes('\\')
  );
}

function normalizeIdPart(value?: string): string {
  const v = (value ?? '').trim();
  return !v || v === '-' ? '' : v;
}

function normalizeRolePart(value?: string): string {
  const v = (value ?? '').trim().toLowerCase();
  return !v || v === '-' || v === 'all' ? 'general' : v;
}

/** Stable note key: `<scenarioId>::<role>`, testId fallback. */
export function testNoteKey(scenarioId?: string, testId?: string, role?: string): string {
  const id = normalizeIdPart(scenarioId) || normalizeIdPart(testId);
  if (!id) throw new Error('A scenarioId or testId is required to identify the test row.');
  return `${id}::${normalizeRolePart(role)}`;
}

/**
 * Candidate keys when reading a note — primary plus the `user` ↔ `general`
 * alias (generator convention uses role `user` for general-mode runs).
 */
export function noteKeyCandidates(scenarioId?: string, testId?: string, role?: string): string[] {
  const id = normalizeIdPart(scenarioId) || normalizeIdPart(testId);
  if (!id) return [];
  const rolePart = normalizeRolePart(role);
  const alias = rolePart === 'user' ? 'general' : rolePart === 'general' ? 'user' : undefined;
  return alias ? [`${id}::${rolePart}`, `${id}::${alias}`] : [`${id}::${rolePart}`];
}

function emptyNotesFile(): McpTestNotesFile {
  return { version: MCP_TEST_NOTES_VERSION, updatedAt: new Date().toISOString(), notes: {} };
}

function parseNotesFile(raw: unknown): McpTestNotesFile | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  if (obj['version'] !== MCP_TEST_NOTES_VERSION) return null;
  if (typeof obj['updatedAt'] !== 'string') return null;
  if (!obj['notes'] || typeof obj['notes'] !== 'object' || Array.isArray(obj['notes'])) return null;
  const notes: Record<string, McpTestNoteEntry> = {};
  for (const [key, entry] of Object.entries(obj['notes'] as Record<string, unknown>)) {
    if (
      entry &&
      typeof entry === 'object' &&
      typeof (entry as Record<string, unknown>)['qaNotes'] === 'string' &&
      typeof (entry as Record<string, unknown>)['aiNotes'] === 'string'
    ) {
      notes[key] = entry as McpTestNoteEntry;
    }
  }
  const runInsights = Array.isArray(obj['runInsights'])
    ? (obj['runInsights'] as unknown[]).filter(
        (e): e is McpRunInsightEntry =>
          !!e &&
          typeof e === 'object' &&
          typeof (e as Record<string, unknown>)['text'] === 'string' &&
          typeof (e as Record<string, unknown>)['source'] === 'string' &&
          typeof (e as Record<string, unknown>)['at'] === 'string',
      )
    : undefined;
  return {
    version: MCP_TEST_NOTES_VERSION,
    updatedAt: obj['updatedAt'],
    notes,
    ...(runInsights && runInsights.length > 0 ? { runInsights } : {}),
  };
}

/** Tolerant load — missing/corrupt file reads as empty. */
export function loadNotesFile(filePath: string): McpTestNotesFile {
  try {
    return parseNotesFile(JSON.parse(fs.readFileSync(filePath, 'utf-8'))) ?? emptyNotesFile();
  } catch {
    return emptyNotesFile();
  }
}

function readNotesForWrite(filePath: string): McpTestNotesFile {
  if (!fs.existsSync(filePath)) return emptyNotesFile();
  const parsed = parseNotesFile(JSON.parse(fs.readFileSync(filePath, 'utf-8')));
  if (!parsed) {
    throw new Error(`test-notes file is corrupt — refusing to overwrite: ${filePath}`);
  }
  return parsed;
}

/**
 * Locked read-modify-write — twin of withNotesWrite in the src module: the
 * lock covers the WHOLE transaction (read → mutate → temp write → atomic
 * rename → release), so concurrent MCP and dashboard writes cannot lose each
 * other's update. Stale lock broken after 5s.
 */
const MCP_LOCK_TIMEOUT_MS = Number(process.env['QA_NOTES_LOCK_TIMEOUT_MS']) || 3000;
const MCP_STALE_LOCK_MS = 5000;

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function acquireNotesLock(filePath: string): string {
  const lockDir = `${filePath}.lock`;
  const deadline = Date.now() + MCP_LOCK_TIMEOUT_MS;
  while (true) {
    try {
      fs.mkdirSync(lockDir);
      return lockDir;
    } catch {
      try {
        const stat = fs.statSync(lockDir);
        if (Date.now() - stat.mtimeMs > MCP_STALE_LOCK_MS) {
          fs.rmSync(lockDir, { recursive: true, force: true });
        }
      } catch {
        // Lock vanished between attempts — retry immediately
      }
      if (Date.now() > deadline) {
        // Never force-remove an ACTIVE lock — force-acquiring would reopen
        // the lost-update window this lock exists to close. Fail loudly.
        throw new Error(
          `NOTES_LOCK_TIMEOUT: another writer holds ${lockDir} (waited ${MCP_LOCK_TIMEOUT_MS}ms). ` +
            `If no other process is running, remove the stale lock directory manually.`,
        );
      }
      sleepSync(50);
    }
  }
}

/** Run `mutate` against the freshly-read sidecar inside the lock. */
function withNotesWrite<T>(filePath: string, mutate: (file: McpTestNotesFile) => T): T {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const lockDir = acquireNotesLock(filePath);
  try {
    const file = readNotesForWrite(filePath);
    const result = mutate(file);
    const tmp = `${filePath}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(file, null, 2), 'utf-8');
    fs.renameSync(tmp, filePath);
    return result;
  } finally {
    try {
      fs.rmSync(lockDir, { recursive: true, force: true });
    } catch {
      // Best-effort lock release
    }
  }
}

/** Hold the latest sidecar lock across an archive transaction. */
export function acquireLatestNotesLock(): {
  snapshot: McpTestNotesFile | null;
  release: () => void;
} {
  const latest = latestTestNotesPath();
  fs.mkdirSync(path.dirname(latest), { recursive: true });
  const lockDir = acquireNotesLock(latest);
  const snapshot = fs.existsSync(latest) ? readNotesForWrite(latest) : null;
  let released = false;
  return {
    snapshot,
    release: () => {
      if (released) return;
      released = true;
      try {
        fs.rmSync(lockDir, { recursive: true, force: true });
      } catch {
        // Best-effort lock release
      }
    },
  };
}

/** Write an exact snapshot to an archive sidecar under its own destination lock. */
export function archiveNotesSnapshot(runDir: string, snapshot: McpTestNotesFile): boolean {
  const destination = path.join(runDir, 'test-notes.json');
  if (fs.existsSync(destination)) return false;
  const lockDir = acquireNotesLock(destination);
  try {
    if (fs.existsSync(destination)) return false;
    const tmp = `${destination}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(snapshot, null, 2), 'utf-8');
    fs.renameSync(tmp, destination);
    return true;
  } catch {
    try {
      fs.rmSync(`${destination}.${process.pid}.tmp`, { force: true });
    } catch {
      // Best-effort temp cleanup
    }
    return false;
  } finally {
    try {
      fs.rmSync(lockDir, { recursive: true, force: true });
    } catch {
      // Best-effort lock release
    }
  }
}

function validateText(field: string, value: string | undefined): void {
  if (value === undefined) return;
  if (typeof value !== 'string') throw new Error(`${field} must be a string.`);
  if (value.length > MCP_MAX_TEST_NOTE_LENGTH) {
    throw new Error(`${field} exceeds the maximum of ${MCP_MAX_TEST_NOTE_LENGTH} characters.`);
  }
}

/** Create or update one test note; stamps the sidecar runId when not set. */
export function upsertTestNote(
  filePath: string,
  key: string,
  patch: { qaNotes?: string; aiNotes?: string },
  opts?: { runId?: string },
): McpTestNoteEntry {
  const redacted = {
    qaNotes: patch.qaNotes !== undefined ? redactSecrets(String(patch.qaNotes)) : undefined,
    aiNotes: patch.aiNotes !== undefined ? redactSecrets(String(patch.aiNotes)) : undefined,
  };
  validateText('qaNotes', redacted.qaNotes);
  validateText('aiNotes', redacted.aiNotes);
  if (redacted.qaNotes === undefined && redacted.aiNotes === undefined) {
    throw new Error('Nothing to update: provide qaNotes and/or aiNotes.');
  }

  return withNotesWrite(filePath, (file) => {
    const now = new Date().toISOString();
    const entry: McpTestNoteEntry = file.notes[key] ?? { qaNotes: '', aiNotes: '' };
    if (redacted.qaNotes !== undefined) {
      entry.qaNotes = redacted.qaNotes;
      entry.qaUpdatedAt = now;
    }
    if (redacted.aiNotes !== undefined) {
      entry.aiNotes = redacted.aiNotes;
      entry.aiUpdatedAt = now;
    }
    file.notes[key] = entry;
    file.updatedAt = now;
    if (opts?.runId && !file.runId) file.runId = opts.runId;
    return entry;
  });
}

export interface McpAppendAiNoteResult {
  entry: McpTestNoteEntry;
  deduplicated: boolean;
}

/** Append an AI note — idempotent: identical insights are not stored twice. */
export function appendAiNote(
  filePath: string,
  key: string,
  message: string,
  source: McpAiNoteSource = 'analyzer',
  opts?: { runId?: string },
): McpAppendAiNoteResult {
  const text = redactSecrets((message ?? '').trim());
  if (!text) throw new Error('message must not be empty.');
  validateText('message', text);
  const addition = `[${source}] ${text}`.slice(0, MCP_MAX_TEST_NOTE_LENGTH);
  const normalizedNew = normalizeForDedupe(text);

  return withNotesWrite(filePath, (file) => {
    const now = new Date().toISOString();
    const entry: McpTestNoteEntry = file.notes[key] ?? { qaNotes: '', aiNotes: '' };

    const alreadyPresent = entry.aiNotes
      .split(/\r\n|\n|\r/)
      .some((line) => normalizeForDedupe(line) === normalizedNew);
    if (alreadyPresent) {
      return { entry, deduplicated: true };
    }

    let joined = entry.aiNotes ? `${entry.aiNotes}\n${addition}` : addition;
    while (joined.length > MCP_MAX_TEST_NOTE_LENGTH) {
      const newline = joined.indexOf('\n');
      if (newline === -1) {
        joined = joined.slice(0, MCP_MAX_TEST_NOTE_LENGTH);
        break;
      }
      joined = joined.slice(newline + 1);
    }
    entry.aiNotes = joined;
    entry.aiUpdatedAt = now;
    file.notes[key] = entry;
    file.updatedAt = now;
    if (opts?.runId && !file.runId) file.runId = opts.runId;
    return { entry, deduplicated: false };
  });
}

export interface McpAppendRunInsightResult {
  entry: McpRunInsightEntry;
  deduplicated: boolean;
}

/** Append a run-level insight — idempotent per source + normalized text. */
export function appendRunInsight(
  filePath: string,
  draft: McpInsightDraft,
  source: McpAiNoteSource = 'analyzer',
  opts?: { runId?: string },
): McpAppendRunInsightResult {
  const text = composeInsightText(draft);
  const normalizedNew = normalizeForDedupe(text);

  return withNotesWrite(filePath, (file) => {
    const now = new Date().toISOString();
    const entry: McpRunInsightEntry = {
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
    file.runInsights = list.slice(Math.max(0, list.length - MCP_MAX_RUN_INSIGHTS));
    file.updatedAt = now;
    if (opts?.runId && !file.runId) file.runId = opts.runId;
    return { entry, deduplicated: false };
  });
}

/**
 * Canonical run identity of the latest run — `run-YYYYMMDD-HHmmss-SSS` derived
 * from test-summary.json timestamp, matching the archive directory naming in
 * src/agents/reporter/report-archive.ts. Null when no summary exists.
 */
export function canonicalLatestRunId(): string | null {
  const summaryPath = path.join(mcpWorkspace.reportsDir, 'test-summary.json');
  try {
    const raw = JSON.parse(fs.readFileSync(summaryPath, 'utf-8')) as Record<string, unknown>;
    const timestamp = typeof raw['timestamp'] === 'string' ? raw['timestamp'] : undefined;
    if (!timestamp) return null;
    const d = new Date(timestamp);
    if (Number.isNaN(d.getTime())) return null;
    const pad = (n: number, w = 2) => String(n).padStart(w, '0');
    return `run-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}-${pad(d.getMilliseconds(), 3)}`;
  } catch {
    return null;
  }
}
