import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const TMP_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-notes-lock-'));
const TMP_REPORT_DIR = path.join(TMP_ROOT, 'reports');
fs.mkdirSync(TMP_REPORT_DIR, { recursive: true });
process.env['QA_REPORT_DIR'] = TMP_REPORT_DIR;
// Keep lock waiting short in tests
process.env['QA_NOTES_LOCK_TIMEOUT_MS'] = '500';

import { test, expect } from '@playwright/test';
import { upsertTestNote, loadTestNotesFromFile } from '../../agents/reporter/test-notes';

test.afterAll(() => {
  fs.rmSync(TMP_ROOT, { recursive: true, force: true });
  delete process.env['QA_REPORT_DIR'];
  delete process.env['QA_NOTES_LOCK_TIMEOUT_MS'];
});

test.describe('notes write lock', () => {
  test('never force-removes an ACTIVE lock — fails with NOTES_LOCK_TIMEOUT instead', () => {
    const filePath = path.join(TMP_REPORT_DIR, 'timeout-lock-notes.json');
    const lockDir = `${filePath}.lock`;
    fs.mkdirSync(lockDir, { recursive: true });

    expect(() => upsertTestNote(filePath, 'SC-99::general', { qaNotes: 'harus gagal' })).toThrow(
      /NOTES_LOCK_TIMEOUT/,
    );
    // The held lock must still be intact and no partial write may exist
    expect(fs.existsSync(lockDir)).toBe(true);
    expect(fs.existsSync(filePath)).toBe(false);
    fs.rmSync(lockDir, { recursive: true, force: true });
  });

  test('a stale foreign lock (older than 5s) is broken immediately', () => {
    const filePath = path.join(TMP_REPORT_DIR, 'stale-lock-notes.json');
    const lockDir = `${filePath}.lock`;
    fs.mkdirSync(lockDir, { recursive: true });
    // Backdate lock mtime AND write an owner whose process is demonstrably dead
    // — active owners are never force-broken.
    const old = new Date(Date.now() - 10_000);
    fs.utimesSync(lockDir, old, old);
    fs.writeFileSync(
      path.join(lockDir, 'owner.json'),
      JSON.stringify({ pid: 2147483647, token: 'dead-owner', acquiredAt: old.toISOString() }),
      'utf-8',
    );
    // Writing owner metadata updates the directory mtime; backdate again so
    // the stale-owner branch is exercised rather than the timeout branch.
    fs.utimesSync(lockDir, old, old);

    const attempt = upsertTestNote(filePath, 'SC-02::general', { qaNotes: 'break stale' });
    expect(attempt.qaNotes).toBe('break stale');
    expect(fs.existsSync(lockDir)).toBe(false);
  });

  test('interleaved read-modify-write calls do not lose either update', () => {
    const filePath = path.join(TMP_REPORT_DIR, 'rmw-notes.json');
    // Simulate two writers whose read-modify-write overlaps: both must persist
    upsertTestNote(filePath, 'SC-A::general', { aiNotes: 'insight A' });
    upsertTestNote(filePath, 'SC-B::general', { aiNotes: 'insight B' });
    const file = loadTestNotesFromFile(filePath);
    expect(file.notes['SC-A::general']?.aiNotes).toContain('insight A');
    expect(file.notes['SC-B::general']?.aiNotes).toContain('insight B');
  });

  test('no lock residue after successful writes', () => {
    const filePath = path.join(TMP_REPORT_DIR, 'residue-notes.json');
    upsertTestNote(filePath, 'SC-C::general', { qaNotes: 'x' });
    upsertTestNote(filePath, 'SC-C::general', { qaNotes: 'y' });
    const residue = fs
      .readdirSync(TMP_REPORT_DIR)
      .filter((f) => f.includes('.lock') || f.endsWith('.tmp'));
    expect(residue).toEqual([]);
  });
});
