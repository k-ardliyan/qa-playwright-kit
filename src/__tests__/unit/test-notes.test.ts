import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const TMP_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-notes-test-'));
const TMP_REPORT_DIR = path.join(TMP_ROOT, 'reports');
fs.mkdirSync(TMP_REPORT_DIR, { recursive: true });
process.env['QA_REPORT_DIR'] = TMP_REPORT_DIR;
process.env['QA_ARCHIVE_DIR'] = path.join(TMP_REPORT_DIR, 'archive');

import { test, expect } from '@playwright/test';
import { bakeAutoAiNotes, buildAutoAiNote, buildRunInsights } from '../../agents/reporter/ai-notes';
import {
  appendAiNote,
  appendLatestRunInsight,
  archiveLatestTestNotes,
  composeInsightText,
  emptyTestNotesFile,
  isStaleSidecar,
  loadArchivedTestNotes,
  loadLatestTestNotes,
  loadTestNotesFromFile,
  mergeTestNotes,
  parseTestNotesFile,
  redactSecrets,
  resetLatestTestNotes,
  stampLatestTestNotesRunId,
  testNoteKey,
  upsertLatestTestNote,
  upsertTestNote,
  MAX_TEST_NOTE_LENGTH,
} from '../../agents/reporter/test-notes';
import { AiNotesCell, NotesCell } from '../../support/custom-dashboard/components/table/TableCells';
import type { CollectedTestData, CollectedStep } from '../../support/custom-dashboard/types';

test.afterAll(() => {
  fs.rmSync(TMP_ROOT, { recursive: true, force: true });
  delete process.env['QA_REPORT_DIR'];
  delete process.env['QA_ARCHIVE_DIR'];
});

function makeTest(overrides: Partial<CollectedTestData> = {}): CollectedTestData {
  return {
    title: 'login works',
    fullTitle: 'auth > login works',
    filePath: 'tests/auth.spec.ts',
    status: 'passed',
    duration: 1200,
    errorMessage: '',
    errors: [],
    steps: [],
    attachments: [],
    retry: 0,
    testId: 'TC-AUTH-001',
    scenarioId: 'SC-01',
    role: 'finance',
    module: 'auth',
    feature: 'login',
    priority: 'high',
    inputData: {},
    expectedResult: 'redirect to dashboard',
    actualResult: 'Sesuai dengan expected result',
    affectedLayer: [],
    ...overrides,
  };
}

test.describe('testNoteKey', () => {
  test('uses scenarioId::role with normalization', () => {
    expect(testNoteKey('SC-01', 'TC-X', 'Finance')).toBe('SC-01::finance');
    expect(testNoteKey('SC-01', 'TC-X', '-')).toBe('SC-01::general');
    expect(testNoteKey('SC-01', 'TC-X')).toBe('SC-01::general');
  });

  test('falls back to testId when scenarioId missing or placeholder', () => {
    expect(testNoteKey('', 'TC-LOGIN-001', 'finance')).toBe('TC-LOGIN-001::finance');
    expect(testNoteKey('-', 'TC-LOGIN-001', '')).toBe('TC-LOGIN-001::general');
  });

  test('throws when both ids are empty', () => {
    expect(() => testNoteKey('', '', 'finance')).toThrow(/scenarioId or testId/);
  });
});

test.describe('test-notes sidecar round-trip', () => {
  test.afterEach(() => resetLatestTestNotes());

  test('upsert creates, updates, and clears qaNotes with timestamps', () => {
    const first = upsertLatestTestNote('SC-01::finance', { qaNotes: 'catatan awal' });
    expect(first.qaNotes).toBe('catatan awal');
    expect(first.qaUpdatedAt).toBeTruthy();

    const second = upsertLatestTestNote('SC-01::finance', { qaNotes: 'revisi catatan' });
    expect(second.qaNotes).toBe('revisi catatan');

    const cleared = upsertLatestTestNote('SC-01::finance', { qaNotes: '' });
    expect(cleared.qaNotes).toBe('');

    const loaded = loadLatestTestNotes();
    expect(loaded.notes['SC-01::finance']?.qaNotes).toBe('');
  });

  test('rejects oversized notes and empty patches', () => {
    expect(() =>
      upsertLatestTestNote('SC-01::finance', { qaNotes: 'x'.repeat(MAX_TEST_NOTE_LENGTH + 1) }),
    ).toThrow(/maximum/);
    expect(() => upsertLatestTestNote('SC-01::finance', {})).toThrow(/Nothing to update/);
  });

  test('appendAiNote is additive with source prefix and drops oldest lines over the cap', () => {
    appendAiNote(TMP_REPORT_DIR + '/test-notes.json', 'SC-01::finance', 'penyebab A', 'healer');
    appendAiNote(TMP_REPORT_DIR + '/test-notes.json', 'SC-01::finance', 'saran B', 'analyzer');
    const loaded = loadLatestTestNotes();
    const entry = loaded.notes['SC-01::finance']!;
    expect(entry.aiNotes).toContain('[healer] penyebab A');
    expect(entry.aiNotes).toContain('[analyzer] saran B');

    // Over-cap: oldest lines are dropped, the newest is kept
    const p = path.join(TMP_REPORT_DIR, 'cap-notes.json');
    for (let i = 0; i < 30; i++) {
      appendAiNote(p, 'k::general', `line-${i} ${'x'.repeat(200)}`, 'healer');
    }
    const capped = loadTestNotesFromFile(p);
    const cappedEntry = capped.notes['k::general']!;
    expect(cappedEntry.aiNotes.length).toBeLessThanOrEqual(MAX_TEST_NOTE_LENGTH);
    expect(cappedEntry.aiNotes).not.toContain('line-0');
  });

  test('stamps runId once and never overwrites an existing stamp', () => {
    upsertLatestTestNote('SC-02::general', { qaNotes: 'n' });
    stampLatestTestNotesRunId('run-20260906-000000-001');
    stampLatestTestNotesRunId('run-20260906-000000-002');
    const loaded = loadLatestTestNotes();
    expect(loaded.runId).toBe('run-20260906-000000-001');
  });

  test('parse skips corrupt entries instead of failing the whole file', () => {
    const parsed = parseTestNotesFile({
      version: 1,
      updatedAt: new Date().toISOString(),
      notes: {
        'ok::general': { qaNotes: 'fine', aiNotes: '' },
        'bad::general': { qaNotes: 42 },
      },
    });
    expect(parsed?.notes['ok::general']?.qaNotes).toBe('fine');
    expect(parsed?.notes['bad::general']).toBeUndefined();
  });
});

test.describe('test-notes archive lifecycle', () => {
  test.afterEach(() => resetLatestTestNotes());

  test('archiveLatestTestNotes copies the sidecar into the run dir and resets latest', () => {
    upsertLatestTestNote('SC-03::finance', { qaNotes: 'ikut arsip' });
    const runDir = path.join(TMP_REPORT_DIR, 'archive', 'run-20260906-010101-001');
    const carried = archiveLatestTestNotes(runDir);
    expect(carried).toBe(true);
    const archived = loadArchivedTestNotes('run-20260906-010101-001');
    expect(archived.notes['SC-03::finance']?.qaNotes).toBe('ikut arsip');
    expect(fs.existsSync(path.join(TMP_REPORT_DIR, 'test-notes.json'))).toBe(false);
  });

  test('archiveLatestTestNotes returns false when there is no sidecar', () => {
    resetLatestTestNotes();
    expect(
      archiveLatestTestNotes(path.join(TMP_REPORT_DIR, 'archive', 'run-20260906-010101-002')),
    ).toBe(false);
  });

  test('archiveLatestTestNotes keeps the latest sidecar when the target is unwritable', () => {
    upsertLatestTestNote('SC-04::general', { qaNotes: 'jangan hilang' });
    const fileAsDir = path.join(TMP_REPORT_DIR, 'not-a-dir');
    fs.writeFileSync(fileAsDir, 'blocker', 'utf-8');
    try {
      const result = archiveLatestTestNotes(fileAsDir);
      expect(result).toBe(false);
      expect(loadLatestTestNotes().notes['SC-04::general']?.qaNotes).toBe('jangan hilang');
    } finally {
      fs.rmSync(fileAsDir, { force: true });
    }
  });

  test('upsertArchivedTestNote requires an existing archive run', async () => {
    const { upsertArchivedTestNote } = await import('../../agents/reporter/test-notes');
    const runDir = path.join(TMP_REPORT_DIR, 'archive', 'run-20260906-020202-003');
    fs.mkdirSync(runDir, { recursive: true });
    upsertArchivedTestNote('run-20260906-020202-003', 'SC-05::general', {
      qaNotes: 'edit arsip',
    });
    expect(loadArchivedTestNotes('run-20260906-020202-003').notes['SC-05::general']?.qaNotes).toBe(
      'edit arsip',
    );
    expect(() =>
      upsertArchivedTestNote('run-20260906-999999-999', 'SC-05::general', { qaNotes: 'x' }),
    ).toThrow(/Archive run not found/);
  });
});

test.describe('mergeTestNotes', () => {
  test('overlays qaNotes and composes aiNotes (agent narrative first, auto after)', () => {
    const notes = emptyTestNotesFile();
    notes.notes['SC-01::finance'] = {
      qaNotes: ' catatan QA ',
      aiNotes: '[healer] Token expired',
    };
    const merged = mergeTestNotes([makeTest({ aiNotes: 'Analisa: timeout' })], notes);
    expect(merged[0]?.qaNotes).toBe('catatan QA');
    expect(merged[0]?.aiNotes).toBe('[healer] Token expired\nAnalisa: timeout');
  });

  test('leaves rows without entries or ids untouched', () => {
    const notes = emptyTestNotesFile();
    const withId = makeTest({ testId: 'TC-OTHER', scenarioId: 'SC-99' });
    const noId = makeTest({ testId: '', scenarioId: '' });
    const merged = mergeTestNotes([withId, noId], notes);
    expect(merged[0]?.qaNotes).toBeUndefined();
    expect(merged[0]?.aiNotes).toBeUndefined();
    expect(merged[1]).toBe(noId);
  });
});

test.describe('buildAutoAiNote', () => {
  test('explains failures with classifier text, suspected cause, and failing step', () => {
    const step: CollectedStep = { title: 'Fill email', status: 'passed', duration: 10, steps: [] };
    const failStep: CollectedStep = {
      title: 'Click submit',
      status: 'failed',
      duration: 10,
      steps: [],
    };
    const note = buildAutoAiNote(
      makeTest({
        status: 'failed',
        errorMessage: 'Timeout 5000ms exceeded waiting for locator("#submit")',
        failureSource: 'test',
        steps: [step, failStep],
      }),
    );
    expect(note).toContain('Elemen tidak muncul tepat waktu');
    expect(note).toContain('Diduga penyebab: kode test');
    expect(note).toContain('Berhenti di langkah "Click submit"');
  });

  test('marks retried passes as flaky and stays silent on clean passes', () => {
    const flaky = buildAutoAiNote(makeTest({ status: 'passed', retry: 2, attempts: 3 }));
    expect(flaky).toContain('Flaky');
    expect(flaky).toContain('×2');

    // A clean pass WITH an assertion stays silent (anti-noise)
    expect(
      buildAutoAiNote(
        makeTest({
          status: 'passed',
          steps: [{ title: 'Expect "x" toBeVisible', status: 'passed', duration: 5, steps: [] }],
        }),
      ),
    ).toBe('');
  });

  test('flags metadata gaps on passed scenarios', () => {
    const note = buildAutoAiNote(makeTest({ status: 'passed', metadataIncomplete: true }));
    expect(note).toContain('Actual result belum diisi');
  });

  test('flags run-relative slow passes only above 3× median', () => {
    const context = { medianPassedMs: 1000 };
    const passStep: CollectedStep[] = [
      { title: 'Expect "x" toBeVisible', status: 'passed', duration: 5, steps: [] },
    ];
    const slow = buildAutoAiNote(
      makeTest({ status: 'passed', duration: 5000, steps: passStep }),
      context,
    );
    expect(slow).toContain('di atas median scenario passed (1.00s)');

    const normal = buildAutoAiNote(
      makeTest({ status: 'passed', duration: 2500, steps: passStep }),
      context,
    );
    expect(normal).toBe('');
  });

  test('flags passed tests without any expect step as false-green risk', () => {
    const noAssert = buildAutoAiNote(
      makeTest({
        status: 'passed',
        steps: [{ title: 'Navigate to dashboard', status: 'passed', duration: 10, steps: [] }],
      }),
    );
    expect(noAssert).toContain('Jenis: Test Quality');
    expect(noAssert).toContain('Tidak terdeteksi assertion');
    expect(noAssert).toContain('validasi manual');

    const withAssert = buildAutoAiNote(
      makeTest({
        status: 'passed',
        steps: [
          { title: 'Navigate to dashboard', status: 'passed', duration: 10, steps: [] },
          {
            title: 'Expect "locator" toBeVisible',
            status: 'passed',
            duration: 5,
            steps: [],
          },
        ],
      }),
    );
    expect(withAssert).not.toContain('Tidak terdeteksi assertion');
  });

  test('covers skipped and not-generated states', () => {
    expect(buildAutoAiNote(makeTest({ status: 'skipped' }))).toContain('dilewati');
    expect(buildAutoAiNote(makeTest({ status: 'not-generated' }))).toContain('belum digenerate');
  });

  test('falls back to a generic hint when no pattern matches', () => {
    const note = buildAutoAiNote(makeTest({ status: 'failed', errorMessage: 'weird failure' }));
    expect(note).toContain('trace/screenshot');
  });
});

test.describe('bakeAutoAiNotes', () => {
  test('computes the passed median across the run and only annotates real outliers', () => {
    const passStep: CollectedStep[] = [
      { title: 'Expect "x" toBeVisible', status: 'passed', duration: 5, steps: [] },
    ];
    const tests = [
      makeTest({ testId: 'TC-1', scenarioId: 'SC-1', duration: 1000, steps: passStep }),
      makeTest({ testId: 'TC-2', scenarioId: 'SC-2', duration: 1100, steps: passStep }),
      makeTest({ testId: 'TC-3', scenarioId: 'SC-3', duration: 900, steps: passStep }),
      makeTest({ testId: 'TC-4', scenarioId: 'SC-4', duration: 1000, steps: passStep }),
      makeTest({ testId: 'TC-5', scenarioId: 'SC-5', duration: 1000, steps: passStep }),
      // 5× the median → flagged
      makeTest({ testId: 'TC-6', scenarioId: 'SC-6', duration: 5000, steps: passStep }),
    ];
    bakeAutoAiNotes(tests);
    expect(tests[0]?.aiNotes).toBe('');
    expect(tests[5]?.aiNotes).toContain('di atas median scenario passed');
  });

  test('skips run-relative detection with too few passed samples', () => {
    const passStep: CollectedStep[] = [
      { title: 'Expect "x" toBeVisible', status: 'passed', duration: 5, steps: [] },
    ];
    const tests = [
      makeTest({ testId: 'TC-1', scenarioId: 'SC-1', duration: 1000, steps: passStep }),
      makeTest({ testId: 'TC-2', scenarioId: 'SC-2', duration: 90000, steps: passStep }),
    ];
    bakeAutoAiNotes(tests);
    expect(tests[1]?.aiNotes).toBe('');
  });
});

test.describe('buildRunInsights', () => {
  test('reports hot module, flaky set, repeated fingerprint, and weak-assertion cluster', () => {
    const error = 'Timeout 5000ms exceeded waiting for locator("#shared")';
    const tests = [
      makeTest({ testId: 'TC-1', scenarioId: 'SC-1', status: 'failed', errorMessage: error }),
      makeTest({
        testId: 'TC-2',
        scenarioId: 'SC-2',
        status: 'failed',
        errorMessage: error,
      }),
      makeTest({ testId: 'TC-3', scenarioId: 'SC-3', status: 'passed', retry: 1 }),
      makeTest({ testId: 'TC-4', scenarioId: 'SC-4', status: 'passed' }),
      makeTest({ testId: 'TC-5', scenarioId: 'SC-5', status: 'passed' }),
    ];
    const insights = buildRunInsights(tests);
    const joined = insights.join('\n');
    expect(joined).toContain('Pola error berulang');
    expect(joined).toContain('test flaky');
    expect(joined).toContain('tanpa assertion terdeteksi');
  });

  test('stays silent for small clean runs', () => {
    const insights = buildRunInsights([makeTest(), makeTest({ testId: 'TC-2' })]);
    expect(insights).toEqual([]);
  });
});

test.describe('composeInsightText + run insights', () => {
  test('renders the canonical structured format (source badge owned by storage/render layers)', () => {
    const text = composeInsightText({
      kind: 'flow',
      observation: 'Pengguna mengisi data yang sama dua kali.',
      evidence: 'SC-03 step 2 & 4',
      impact: 'Waktu input bertambah.',
      recommendation: 'Pakai ulang data dari langkah pertama.',
      nextAction: 'Validasi dengan product owner.',
      priority: 'medium',
      confidence: 'medium',
      status: 'inferred',
    });
    const lines = text.split('\n');
    expect(lines[0]).toBe(
      'Jenis: flow | Status: inferred | Prioritas: medium | Confidence: medium',
    );
    expect(lines[0]).not.toContain('[reporter]');
    expect(text).toContain('Observasi: Pengguna mengisi data yang sama dua kali.');
    expect(text).toContain('Bukti: SC-03 step 2 & 4');
    expect(text).toContain('Rekomendasi: Pakai ulang data dari langkah pertama.');
    expect(text).toContain('Next Action: Validasi dengan product owner.');
  });

  test('falls back to a plain message when no structured field is provided', () => {
    const text = composeInsightText({ message: 'catatan singkat' });
    expect(text).toBe('catatan singkat');
  });

  test('throws when neither message nor structured fields are present', () => {
    expect(() => composeInsightText({})).toThrow(/message or structured observation/);
  });

  test('appendLatestRunInsight stores entries in the sidecar and caps the list', () => {
    for (let i = 0; i < 55; i++) {
      appendLatestRunInsight({ message: `insight-${i}` }, 'reporter');
    }
    const file = loadLatestTestNotes();
    expect(file.runInsights?.length).toBe(50);
    expect(file.runInsights?.at(-1)?.text).toContain('insight-54');
    expect(file.runInsights?.[0]?.text).not.toContain('insight-0');
  });

  test('run insights are deduplicated per source + normalized text', () => {
    resetLatestTestNotes();
    const first = appendLatestRunInsight({ message: 'pola error sama' }, 'healer');
    const second = appendLatestRunInsight({ message: 'Pola   error sama' }, 'healer');
    expect(first.deduplicated).toBe(false);
    expect(second.deduplicated).toBe(true);
    const file = loadLatestTestNotes();
    expect(file.runInsights?.length).toBe(1);
    // different source = different insight, not deduped
    const third = appendLatestRunInsight({ message: 'pola error sama' }, 'reporter');
    expect(third.deduplicated).toBe(false);
  });

  test('runInsights survive a parse round-trip and archive carry', () => {
    appendLatestRunInsight(
      { kind: 'trend', observation: 'modul auth paling panas', status: 'observed' },
      'analyzer',
    );
    const runDir = path.join(TMP_REPORT_DIR, 'archive', 'run-20260906-040404-005');
    expect(archiveLatestTestNotes(runDir)).toBe(true);
    const archived = loadArchivedTestNotes('run-20260906-040404-005');
    const entry = archived.runInsights?.at(-1);
    expect(entry?.text).toContain('Jenis: trend');
    expect(entry?.status).toBe('observed');
  });
});

test.describe('secret redaction', () => {
  test('redacts tokens, JWTs, passwords, cookies, and AWS keys', () => {
    const input = [
      'Authorization: Bearer abc123def456ghi',
      'token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c leaked',
      'password: supersecret123',
      'Set-Cookie: session=abc123def456; HttpOnly',
      'key AKIAIOSFODNN7EXAMPLE found',
    ].join('\n');
    const output = redactSecrets(input);
    expect(output).toContain('Authorization: [REDACTED]');
    expect(output).toContain('[REDACTED_JWT]');
    expect(output).toContain('password: [REDACTED]');
    expect(output).toContain('[REDACTED_COOKIE]');
    expect(output).toContain('[REDACTED_AWS_KEY]');
    expect(output).not.toContain('supersecret123');
    expect(output).not.toContain('AKIAIOSFODNN7EXAMPLE');
  });

  test('upsert redacts qaNotes before persisting', () => {
    upsertTestNote(TMP_REPORT_DIR + '/redact-notes.json', 'SC-R::general', {
      qaNotes: 'login pakai api_key=sk-live-abc123def456',
    });
    const file = loadTestNotesFromFile(TMP_REPORT_DIR + '/redact-notes.json');
    expect(file.notes['SC-R::general']?.qaNotes).toContain('api_key: [REDACTED]');
    expect(file.notes['SC-R::general']?.qaNotes).not.toContain('sk-live');
  });
});

test.describe('dedupe per-test AI notes', () => {
  test('appendAiNote is idempotent for identical insight text', () => {
    const p = path.join(TMP_REPORT_DIR, 'dedupe-notes.json');
    const first = appendAiNote(p, 'SC-D::general', 'root cause: token expired', 'healer');
    const second = appendAiNote(p, 'SC-D::general', 'root cause: token expired', 'healer');
    expect(first.deduplicated).toBe(false);
    expect(second.deduplicated).toBe(true);
    const file = loadTestNotesFromFile(p);
    expect(file.notes['SC-D::general']?.aiNotes.match(/token expired/g)?.length).toBe(1);
  });
});

test.describe('role alias user <-> general', () => {
  test('merges sidecar keyed ::general into a row whose role is user', () => {
    const notes = emptyTestNotesFile();
    notes.notes['SC-01::general'] = { qaNotes: 'dari CLI tanpa role', aiNotes: '' };
    const merged = mergeTestNotes([makeTest({ role: 'user' })], notes);
    expect(merged[0]?.qaNotes).toBe('dari CLI tanpa role');
  });

  test('merges sidecar keyed ::user into a general-mode row', () => {
    const notes = emptyTestNotesFile();
    notes.notes['SC-02::user'] = { qaNotes: 'dari generator convention', aiNotes: '' };
    const merged = mergeTestNotes([makeTest({ scenarioId: 'SC-02', role: '' })], notes);
    expect(merged[0]?.qaNotes).toBe('dari generator convention');
  });
});

test.describe('isStaleSidecar (per-run lifecycle)', () => {
  test('unattributed sidecar with content is stale; empty is not', () => {
    const withNotes = emptyTestNotesFile();
    withNotes.notes['SC-01::general'] = { qaNotes: 'x', aiNotes: '' };
    expect(isStaleSidecar(withNotes, 'run-20260906-000000-001')).toBe(true);

    const empty = emptyTestNotesFile();
    expect(isStaleSidecar(empty, 'run-20260906-000000-001')).toBe(false);
  });

  test('stamped sidecar is stale only for a different run', () => {
    const stamped = emptyTestNotesFile();
    stamped.runId = 'run-20260906-000000-001';
    stamped.notes['SC-01::general'] = { qaNotes: 'x', aiNotes: '' };
    expect(isStaleSidecar(stamped, 'run-20260906-000000-001')).toBe(false);
    expect(isStaleSidecar(stamped, 'run-20260906-000000-002')).toBe(true);
  });
});

test.describe('XSS-safe rendering of notes', () => {
  test('AI notes and QA notes render as escaped text, never raw HTML elements', () => {
    const payload = '<img src=x onerror=alert(1)>';
    const test = makeTest({ qaNotes: payload, aiNotes: `<script>alert(1)</script>analisa` });

    const notesHtml = String(NotesCell({ test, runId: undefined }));
    // The data-* attribute legitimately carries the raw payload (quoted, inert);
    // the visible TEXT must be escaped so it never becomes an element.
    expect(notesHtml).toMatch(/&lt;img src=x/);
    expect(notesHtml).not.toMatch(/(?:^|>)\s*<img src=x/);

    const aiHtml = String(AiNotesCell({ test }));
    expect(aiHtml).not.toContain('<script>');
    expect(aiHtml).toContain('&lt;script');
  });
});
