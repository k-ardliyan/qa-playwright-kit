import * as fs from 'node:fs';
import * as path from 'node:path';
import type { TestNotesFile } from './test-notes';
import { latestTestNotesPath, readTestNotesForWrite } from './test-notes';

const LOCK_TIMEOUT_MS = Number(process.env['QA_NOTES_LOCK_TIMEOUT_MS']) || 3000;
const STALE_LOCK_MS = 5000;

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

export interface NotesLockOwner {
  pid: number;
  token: string;
  acquiredAt: string;
}

export function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means the process exists but is not signalable; ESRCH means it is
    // gone. Treat every other uncertainty as alive (fail closed).
    return (error as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}

export function acquireNotesLock(filePath: string): string {
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
export function withNotesWrite<T>(filePath: string, mutate: (file: TestNotesFile) => T): T {
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
