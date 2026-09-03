/**
 * Test isolation helper — redirect pipeline/report writes to a temp dir.
 *
 * Shared by tests that call saveState/loadState/resumeState or the reporter
 * archive helpers. Without this, tests pollute the production
 * artifacts/reports/pipeline-state.json (previously shipped a fake
 * `runId: "test-run-staleness"` state to disk).
 *
 * Usage (Playwright unit test):
 *   import { useIsolatedReportDir } from './report-dir-isolation';
 *   const isolate = useIsolatedReportDir();
 *   test.beforeAll(isolate.setup);
 *   test.afterAll(isolate.teardown);
 *
 * Usage (tsx script):
 *   const isolate = await createIsolatedReportDir();
 *   // ... run code ...
 *   isolate.teardown();
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

export interface IsolatedReportDir {
  /** Absolute path of the isolated report dir. */
  dir: string;
  /** Restore the previous QA_REPORT_DIR and delete the temp dir. */
  teardown(): void;
}

/** Set QA_REPORT_DIR to a fresh temp dir. Returns teardown handle. */
export function createIsolatedReportDir(): IsolatedReportDir {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pwkit-state-'));
  const prev = process.env['QA_REPORT_DIR'];
  process.env['QA_REPORT_DIR'] = dir;
  return {
    dir,
    teardown(): void {
      if (prev === undefined) delete process.env['QA_REPORT_DIR'];
      else process.env['QA_REPORT_DIR'] = prev;
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        // best-effort cleanup; temp dir is OS-reclaimable anyway
      }
    },
  };
}

/** Playwright-flavored binding: { setup, teardown } for beforeAll/afterAll. */
export function useIsolatedReportDir(): { setup: () => void; teardown: () => void } {
  let handle: IsolatedReportDir | null = null;
  return {
    setup(): void {
      handle = createIsolatedReportDir();
    },
    teardown(): void {
      handle?.teardown();
      handle = null;
    },
  };
}
