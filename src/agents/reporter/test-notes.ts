/**
 * Per-test notes sidecar — QA free-text and AI notes attached to individual
 * test rows.
 *
 * Notes live in a sidecar JSON instead of test-summary.json because they are
 * written after the run (QA review, healer narrative) while the summary is
 * machine-owned by the reporter. Entries are keyed by `<scenarioId>::<role>`
 * (testId fallback, mirroring the compare identity in report-compare.ts) so
 * they survive the latest-run → archive transition, where the archive runId is
 * regenerated at save time but the sidecar file itself is carried into the
 * archive directory by saveLatestRun().
 *
 * Storage:
 *   <reportDir>/test-notes.json           — latest run sidecar (reset after archive)
 *   <archiveDir>/<runId>/test-notes.json  — archived run sidecar (permanent)
 *
 * @module src/agents/reporter/test-notes
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { resolveWorkspaceReportDir } from '../../shared/workspace-paths';

// ─── Types ───────────────────────────────────────────────────────────────────

/** Notes attached to a single test row. Both note fields default to ''. */
export interface TestNoteEntry {
  /** QA free-text note. */
  qaNotes: string;
  /** AI-authored note (agent narrative + deterministic auto analysis). */
  aiNotes: string;
  qaUpdatedAt?: string;
  aiUpdatedAt?: string;
}

/** Sidecar file schema — qa.test-notes/v1. */
export interface TestNotesFile {
  version: 1;
  /** Reporter run identity this sidecar belongs to (summary.runId). */
  runId?: string;
  updatedAt: string;
  notes: Record<string, TestNoteEntry>;
  /** Run-level (cross-scenario) AI insights — overview panel + pipeline report. */
  runInsights?: RunInsightEntry[];
}

/** Patch for one test note — only provided fields are written. */
export interface TestNotePatch {
  qaNotes?: string;
  aiNotes?: string;
}

/** Who authored an AI note — shown as a badge in the dashboard. */
export const AI_NOTE_SOURCES = ['healer', 'generator', 'reporter', 'analyzer'] as const;
export type AiNoteSource = (typeof AI_NOTE_SOURCES)[number];

/** Evidence label per the canonical insight format (ai-insight-format.md). */
export const AI_INSIGHT_STATUSES = ['observed', 'inferred', 'recommendation'] as const;
export type AiInsightStatus = (typeof AI_INSIGHT_STATUSES)[number];

export const AI_INSIGHT_PRIORITIES = ['high', 'medium', 'low'] as const;
export type AiInsightPriority = (typeof AI_INSIGHT_PRIORITIES)[number];

export const AI_INSIGHT_CONFIDENCE = ['high', 'medium', 'low'] as const;
export type AiInsightConfidence = (typeof AI_INSIGHT_CONFIDENCE)[number];

/** Max stored run-level insights — oldest entries are dropped beyond this. */
export const MAX_RUN_INSIGHTS = 50;

/**
 * Cross-scenario (run-level) AI insight — rendered in the dashboard overview
 * panel. Structured fields follow the canonical insight format.
 */
export interface RunInsightEntry {
  /** Composed insight text in the canonical format (already rendered). */
  text: string;
  source: AiNoteSource;
  /** Insight kind (Jenis): root-cause, stability, test-quality, ui-ux, flow, data, trend, … */
  kind?: string;
  status?: AiInsightStatus;
  priority?: AiInsightPriority;
  confidence?: AiInsightConfidence;
  at: string;
  /** Traceability metadata — what the insight affects. */
  affected?: {
    tests?: string[];
    modules?: string[];
    roles?: string[];
  };
}

export const TEST_NOTES_VERSION = 1;
/** Upper bound per note field — keeps table cells and exports readable. */
export const MAX_TEST_NOTE_LENGTH = 4000;

// ─── Secret redaction ────────────────────────────────────────────────────────

/**
 * Defensive redaction applied to every note field before it touches disk —
 * QA notes, agent insights, and evidence quotes must never persist
 * credentials, tokens, or cookies into reports, exports, or archives.
 */
const SECRET_PATTERNS: Array<[RegExp, (match: string) => string]> = [
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

export function redactSecrets(text: string): string {
  let out = text ?? '';
  for (const [pattern, replace] of SECRET_PATTERNS) {
    out = out.replace(pattern, replace);
  }
  return out;
}

// ─── Dedupe ──────────────────────────────────────────────────────────────────

function normalizeForDedupe(text: string): string {
  return text
    .replace(/^\[[a-z]+\]\s*/i, '') // strip source badge — same insight from same source
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

// ─── Keys ────────────────────────────────────────────────────────────────────

function normalizeIdPart(value?: string): string {
  const v = (value ?? '').trim();
  return !v || v === '-' ? '' : v;
}

function normalizeRolePart(value?: string): string {
  const v = (value ?? '').trim().toLowerCase();
  return !v || v === '-' || v === 'all' ? 'general' : v;
}

/**
 * Stable note key for a test row: `<scenarioId>::<role>` with testId fallback.
 * Role `general` is used for general-mode runs and empty placeholders.
 *
 * Note on `user`: the generator convention uses role `user` for general-mode
 * runs, while writers that omit the role produce `general`. Readers resolve
 * both through `noteKeyCandidates` so the two spellings stay interchangeable.
 */
export function testNoteKey(scenarioId?: string, testId?: string, role?: string): string {
  const id = normalizeIdPart(scenarioId) || normalizeIdPart(testId);
  if (!id) throw new Error('testNoteKey requires a scenarioId or testId.');
  return `${id}::${normalizeRolePart(role)}`;
}

/**
 * Candidate keys for reading a note: the primary key plus the `user` ↔
 * `general` alias. Keeps legacy sidecars (keyed `::user` by the generator
 * convention) and writers that omit the role mutually compatible.
 */
export function noteKeyCandidates(scenarioId?: string, testId?: string, role?: string): string[] {
  const id = normalizeIdPart(scenarioId) || normalizeIdPart(testId);
  if (!id) return [];
  const rolePart = normalizeRolePart(role);
  const alias = rolePart === 'user' ? 'general' : rolePart === 'general' ? 'user' : undefined;
  return alias ? [`${id}::${rolePart}`, `${id}::${alias}`] : [`${id}::${rolePart}`];
}

// ─── Paths ───────────────────────────────────────────────────────────────────

// Mirrors report-archive.ts archiveDir() — kept local to avoid an import cycle
// (report-archive imports this module for the archive carry step).
function archiveDir(): string {
  if (process.env['QA_ARCHIVE_DIR']) return process.env['QA_ARCHIVE_DIR'];
  return path.join(resolveWorkspaceReportDir(), 'archive');
}

export function latestTestNotesPath(): string {
  return path.join(resolveWorkspaceReportDir(), 'test-notes.json');
}

/** Path of the sidecar inside an archive run dir, or null for invalid runIds. */
export function archivedTestNotesPath(runId: string): string | null {
  if (!isValidRunIdFormat(runId)) return null;
  return path.join(archiveDir(), runId, 'test-notes.json');
}

/** Same validation as report-archive.isValidRunId — duplicated to avoid an import cycle. */
export function isValidRunIdFormat(runId: string): boolean {
  return (
    /^run-[\d-]+$/.test(runId) &&
    !runId.includes('..') &&
    !runId.includes('/') &&
    !runId.includes('\\')
  );
}

// ─── Load / parse ────────────────────────────────────────────────────────────

export function emptyTestNotesFile(): TestNotesFile {
  return { version: TEST_NOTES_VERSION, updatedAt: new Date().toISOString(), notes: {} };
}

function isTestNoteEntry(value: unknown): value is TestNoteEntry {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return typeof v['qaNotes'] === 'string' && typeof v['aiNotes'] === 'string';
}

function isRunInsightEntry(value: unknown): value is RunInsightEntry {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v['text'] === 'string' && typeof v['source'] === 'string' && typeof v['at'] === 'string'
  );
}

/** Parse raw JSON into a TestNotesFile; null when the shape is invalid. */
export function parseTestNotesFile(raw: unknown): TestNotesFile | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  if (obj['version'] !== TEST_NOTES_VERSION) return null;
  if (typeof obj['updatedAt'] !== 'string') return null;
  if (!obj['notes'] || typeof obj['notes'] !== 'object' || Array.isArray(obj['notes'])) return null;
  const notes: Record<string, TestNoteEntry> = {};
  // Skip corrupt entries instead of failing the whole file
  for (const [key, entry] of Object.entries(obj['notes'] as Record<string, unknown>)) {
    if (isTestNoteEntry(entry)) notes[key] = entry;
  }
  const runInsights = Array.isArray(obj['runInsights'])
    ? (obj['runInsights'] as unknown[]).filter(isRunInsightEntry)
    : undefined;
  return {
    version: TEST_NOTES_VERSION,
    runId: typeof obj['runId'] === 'string' ? obj['runId'] : undefined,
    updatedAt: obj['updatedAt'],
    notes,
    ...(runInsights && runInsights.length > 0 ? { runInsights } : {}),
  };
}

/** Tolerant load for rendering — missing/corrupt file reads as empty. */
export function loadTestNotesFromFile(filePath: string): TestNotesFile {
  try {
    const parsed = parseTestNotesFile(JSON.parse(fs.readFileSync(filePath, 'utf-8')));
    return parsed ?? emptyTestNotesFile();
  } catch {
    return emptyTestNotesFile();
  }
}

/** Strict read for writes — corrupt files must fail loudly so notes are never lost. */
function readTestNotesForWrite(filePath: string): TestNotesFile {
  if (!fs.existsSync(filePath)) return emptyTestNotesFile();
  const parsed = parseTestNotesFile(JSON.parse(fs.readFileSync(filePath, 'utf-8')));
  if (!parsed) {
    throw new Error(`test-notes file is corrupt — refusing to overwrite: ${filePath}`);
  }
  return parsed;
}

export function loadLatestTestNotes(): TestNotesFile {
  return loadTestNotesFromFile(latestTestNotesPath());
}

export function loadArchivedTestNotes(runId: string): TestNotesFile {
  const notesPath = archivedTestNotesPath(runId);
  return notesPath ? loadTestNotesFromFile(notesPath) : emptyTestNotesFile();
}

// ─── Write ───────────────────────────────────────────────────────────────────

function validatePatch(patch: TestNotePatch): void {
  for (const field of ['qaNotes', 'aiNotes'] as const) {
    const value = patch[field];
    if (value === undefined) continue;
    if (typeof value !== 'string') throw new Error(`${field} must be a string.`);
    if (value.length > MAX_TEST_NOTE_LENGTH) {
      throw new Error(`${field} exceeds the maximum of ${MAX_TEST_NOTE_LENGTH} characters.`);
    }
  }
}

/**
 * Locked read-modify-write: the lock covers the WHOLE transaction (read →
 * mutate → temp write → atomic rename → release), so a concurrent MCP write
 * and dashboard write can never lose each other's update. A stale lock
 * (older than STALE_LOCK_MS) is broken after LOCK_TIMEOUT_MS.
 */
const LOCK_TIMEOUT_MS = Number(process.env['QA_NOTES_LOCK_TIMEOUT_MS']) || 3000;
const STALE_LOCK_MS = 5000;

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

interface NotesLockOwner {
  pid: number;
  token: string;
  acquiredAt: string;
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means the process exists but is not signalable; ESRCH means it is
    // gone. Treat every other uncertainty as alive (fail closed).
    return (error as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}

function acquireNotesLock(filePath: string): string {
  const lockDir = `${filePath}.lock`;
  const ownerPath = path.join(lockDir, 'owner.json');
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  while (true) {
    try {
      fs.mkdirSync(lockDir);
      const owner: NotesLockOwner = {
        pid: process.pid,
        token: `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        acquiredAt: new Date().toISOString(),
      };
      fs.writeFileSync(ownerPath, JSON.stringify(owner), 'utf-8');
      return lockDir;
    } catch {
      try {
        const stat = fs.statSync(lockDir);
        if (Date.now() - stat.mtimeMs > STALE_LOCK_MS && fs.existsSync(ownerPath)) {
          const owner = JSON.parse(fs.readFileSync(ownerPath, 'utf-8')) as Partial<NotesLockOwner>;
          // Only break a stale lock when its recorded owner is demonstrably
          // dead. Unknown/invalid owners remain locked (fail closed).
          if (typeof owner.pid === 'number' && !processIsAlive(owner.pid)) {
            fs.rmSync(lockDir, { recursive: true, force: true });
          }
        }
      } catch {
        // Lock vanished or owner metadata is unreadable — retry until timeout
      }
      if (Date.now() > deadline) {
        throw new Error(
          `NOTES_LOCK_TIMEOUT: another writer holds ${lockDir} (waited ${LOCK_TIMEOUT_MS}ms). ` +
            `If no other process is running, remove the stale lock directory manually.`,
        );
      }
      sleepSync(50);
    }
  }
}

/**
 * Run `mutate` against the freshly-read sidecar inside the lock; the mutated
 * file is persisted atomically before the lock is released.
 */
function withNotesWrite<T>(filePath: string, mutate: (file: TestNotesFile) => T): T {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const lockDir = acquireNotesLock(filePath);
  try {
    const file = readTestNotesForWrite(filePath);
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

/**
 * Hold the latest sidecar lock across an arbitrary transaction. The callback
 * receives one coherent snapshot; callers can build the archive and transfer
 * that exact snapshot before this lock is released.
 */
export function withLatestTestNotesLock<T>(callback: (snapshot: TestNotesFile | null) => T): T {
  const latest = latestTestNotesPath();
  fs.mkdirSync(path.dirname(latest), { recursive: true });
  const lockDir = acquireNotesLock(latest);
  try {
    const snapshot = fs.existsSync(latest) ? readTestNotesForWrite(latest) : null;
    return callback(snapshot);
  } finally {
    try {
      fs.rmSync(lockDir, { recursive: true, force: true });
    } catch {
      // Best-effort lock release
    }
  }
}

/** Coherent latest-sidecar snapshot for gate/evidence consumers. */
export interface TestNotesSnapshot {
  file: TestNotesFile | null;
  path: string;
}

export function readLatestTestNotesSnapshot(): TestNotesSnapshot {
  return withLatestTestNotesLock((file) => ({ file, path: latestTestNotesPath() }));
}

/**
 * Write one previously captured snapshot to an archive sidecar atomically.
 * Destination locking prevents an archived QA edit from being overwritten.
 */
export function archiveTestNotesSnapshot(runDir: string, snapshot: TestNotesFile): boolean {
  const destination = path.join(runDir, 'test-notes.json');
  if (fs.existsSync(destination)) return false;
  const destinationLock = acquireNotesLock(destination);
  try {
    // Re-check after acquiring the destination lock — another archive caller
    // may have created the file between the first check and the lock.
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
      fs.rmSync(destinationLock, { recursive: true, force: true });
    } catch {
      // Best-effort lock release
    }
  }
}

/**
 * Lock the sidecar for a complete archive-transfer transaction. The callback
 * runs while the source lock is held, before the archive directory is created;
 * a thrown error therefore leaves no archive directory behind. When it
 * returns, the source snapshot is atomically copied to the archive under a
 * destination lock, and only then is the latest sidecar removed.
 */
export function withLatestNotesArchive<T>(
  runDir: string,
  beforeTransfer: (snapshot: TestNotesFile | null) => T,
): { result: T; notesArchived: boolean; snapshot: TestNotesFile | null } {
  const latest = latestTestNotesPath();
  fs.mkdirSync(path.dirname(latest), { recursive: true });
  const sourceLock = acquireNotesLock(latest);
  try {
    const snapshot = fs.existsSync(latest) ? readTestNotesForWrite(latest) : null;
    const result = beforeTransfer(snapshot);

    fs.mkdirSync(path.dirname(runDir), { recursive: true });
    if (fs.existsSync(runDir)) {
      throw new Error(`Archive target already exists: ${runDir}`);
    }
    fs.mkdirSync(runDir, { recursive: true });

    if (!snapshot) return { result, notesArchived: false, snapshot: null };

    const destination = path.join(runDir, 'test-notes.json');
    const destinationLock = acquireNotesLock(destination);
    try {
      const tmp = `${destination}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(snapshot, null, 2), 'utf-8');
      fs.renameSync(tmp, destination);
    } finally {
      try {
        fs.rmSync(destinationLock, { recursive: true, force: true });
      } catch {
        // Best-effort lock release
      }
    }

    // Source lock is still held: no writer can sneak in between copy and reset.
    fs.rmSync(latest, { force: true });
    return { result, notesArchived: true, snapshot };
  } finally {
    try {
      fs.rmSync(sourceLock, { recursive: true, force: true });
    } catch {
      // Best-effort lock release
    }
  }
}

/**
 * Create or update one test note; the sidecar is created when missing.
 * `runId` stamps the sidecar with the owning run when not set yet.
 * Text fields are secret-redacted before persisting.
 */
export function upsertTestNote(
  filePath: string,
  key: string,
  patch: TestNotePatch,
  opts?: { runId?: string },
): TestNoteEntry {
  const redacted: TestNotePatch = {};
  if (patch.qaNotes !== undefined) redacted.qaNotes = redactSecrets(String(patch.qaNotes));
  if (patch.aiNotes !== undefined) redacted.aiNotes = redactSecrets(String(patch.aiNotes));
  validatePatch(redacted);
  if (redacted.qaNotes === undefined && redacted.aiNotes === undefined) {
    throw new Error('Nothing to update: provide qaNotes and/or aiNotes.');
  }

  return withNotesWrite(filePath, (file) => {
    const now = new Date().toISOString();
    const entry: TestNoteEntry = file.notes[key] ?? { qaNotes: '', aiNotes: '' };
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

/** Result of an append — `deduplicated` marks an already-present insight. */
export interface AppendAiNoteResult {
  entry: TestNoteEntry;
  deduplicated: boolean;
}

/**
 * Append an AI note (previous notes are kept, newest last, prefixed with the
 * source). Identical insights (same normalized text, same key) are not stored
 * twice — agent retries are idempotent. Oldest lines drop over the cap.
 */
export function appendAiNote(
  filePath: string,
  key: string,
  message: string,
  source: AiNoteSource = 'analyzer',
  opts?: { runId?: string },
): AppendAiNoteResult {
  const text = redactSecrets(message.trim());
  if (!text) throw new Error('AI note message must not be empty.');
  const addition = `[${source}] ${text}`.slice(0, MAX_TEST_NOTE_LENGTH);
  const normalizedNew = normalizeForDedupe(text);

  return withNotesWrite(filePath, (file) => {
    const now = new Date().toISOString();
    const entry: TestNoteEntry = file.notes[key] ?? { qaNotes: '', aiNotes: '' };

    const alreadyPresent = entry.aiNotes
      .split(/\r\n|\n|\r/)
      .some((line) => normalizeForDedupe(line) === normalizedNew);
    if (alreadyPresent) {
      return { entry, deduplicated: true };
    }

    let joined = entry.aiNotes ? `${entry.aiNotes}\n${addition}` : addition;
    while (joined.length > MAX_TEST_NOTE_LENGTH) {
      const newline = joined.indexOf('\n');
      if (newline === -1) {
        joined = joined.slice(0, MAX_TEST_NOTE_LENGTH);
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

export function upsertLatestTestNote(
  key: string,
  patch: TestNotePatch,
  opts?: { runId?: string },
): TestNoteEntry {
  return upsertTestNote(latestTestNotesPath(), key, patch, opts);
}

// ─── Run-level (cross-scenario) insights ─────────────────────────────────────

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

export function appendLatestAiNote(
  key: string,
  message: string,
  source?: AiNoteSource,
  opts?: { runId?: string },
): AppendAiNoteResult {
  return appendAiNote(latestTestNotesPath(), key, message, source, opts);
}

export function upsertArchivedTestNote(
  runId: string,
  key: string,
  patch: TestNotePatch,
): TestNoteEntry {
  const notesPath = archivedTestNotesPath(runId);
  if (!notesPath) {
    throw new Error(`Invalid runId: "${runId}". RunId must match pattern run-YYYYMMDD-HHmmss-SSS.`);
  }
  if (!fs.existsSync(path.dirname(notesPath))) {
    throw new Error(`Archive run not found: ${runId}`);
  }
  return upsertTestNote(notesPath, key, patch);
}

// ─── Run lifecycle ───────────────────────────────────────────────────────────

/**
 * Copy the latest sidecar into a freshly created archive run directory, then
 * reset it so the next run starts clean. When the copy fails the latest
 * sidecar is kept (notes must not be lost) and false is returned.
 */
export function archiveLatestTestNotes(runDir: string): boolean {
  let archived = false;
  try {
    withLatestTestNotesLock((snapshot) => {
      if (!snapshot) return;
      try {
        fs.mkdirSync(runDir, { recursive: true });
        archived = archiveTestNotesSnapshot(runDir, snapshot);
        if (archived) fs.rmSync(latestTestNotesPath(), { force: true });
      } catch {
        // Keep latest sidecar intact when the archive target is not writable.
        archived = false;
      }
    });
  } catch {
    // Lock or source-read failure is reported as a non-destructive no-op.
    archived = false;
  }
  return archived;
}

/** Remove the latest sidecar — a fresh run starts clean. */
export function resetLatestTestNotes(): void {
  try {
    const latest = latestTestNotesPath();
    if (fs.existsSync(latest)) fs.rmSync(latest);
  } catch {
    // Non-blocking
  }
}

/** Stamp the owning run identity onto the latest sidecar when not set yet. */
export function stampLatestTestNotesRunId(runId: string): void {
  const notesPath = latestTestNotesPath();
  if (!fs.existsSync(notesPath)) return;
  withNotesWrite(notesPath, (file) => {
    if (!file.runId) file.runId = runId;
    return file.runId;
  });
}

// ─── Render merge ────────────────────────────────────────────────────────────

/** Minimal shape a render target needs for note merging. */
interface NoteTarget {
  scenarioId?: string;
  testId: string;
  role?: string;
  qaNotes?: string;
  aiNotes?: string;
}

/**
 * Compose the displayed AI note: agent narrative first, deterministic auto
 * analysis after.
 */
export function composeAiNotes(autoNotes?: string, agentNotes?: string): string {
  return [agentNotes?.trim(), autoNotes?.trim()].filter(Boolean).join('\n');
}

/**
 * Merge sidecar notes into test cases for rendering/exports. Returns new
 * objects; cases without notes are returned unchanged. Key resolution tries
 * the primary `scenarioId::role` key, then the `user` ↔ `general` alias so
 * general-mode runs (role `user` per generator convention) match writers
 * that omit the role.
 */
export function mergeTestNotes<T extends NoteTarget>(
  testCases: readonly T[],
  notes: TestNotesFile,
): T[] {
  return testCases.map((tc) => {
    let entry: TestNoteEntry | undefined;
    try {
      for (const key of noteKeyCandidates(tc.scenarioId, tc.testId, tc.role)) {
        entry = notes.notes[key];
        if (entry) break;
      }
    } catch {
      return tc;
    }
    if (!entry) return tc;
    const qaNotes = entry.qaNotes.trim() || undefined;
    const aiNotes = composeAiNotes(tc.aiNotes, entry.aiNotes) || undefined;
    if (!qaNotes && !aiNotes) return tc;
    return { ...tc, ...(qaNotes ? { qaNotes } : {}), ...(aiNotes ? { aiNotes } : {}) };
  });
}

/**
 * Per-run lifecycle rule: a sidecar is stale when its run identity belongs to
 * another run, or when it holds content but was never stamped (unattributable
 * notes must not leak into the next run).
 */
export function isStaleSidecar(sidecar: TestNotesFile, canonicalRunId: string): boolean {
  if (sidecar.runId) return sidecar.runId !== canonicalRunId;
  const hasContent =
    Object.keys(sidecar.notes).length > 0 || (sidecar.runInsights?.length ?? 0) > 0;
  return hasContent;
}
