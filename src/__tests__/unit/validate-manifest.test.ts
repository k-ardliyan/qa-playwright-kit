import { test, expect } from '@playwright/test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  writeValidateRunManifest,
  readValidateRunManifest,
  assertCurrentValidateManifest,
} from '../../agents/integration/validate-manifest';

test.describe('Validate current-run manifest', () => {
  test('Run A and Run B use independent result directories', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qak-manifest-'));
    const dirA = path.join(root, 'artifacts', 'test-results', 'workflow', 'run-a');
    const dirB = path.join(root, 'artifacts', 'test-results', 'workflow', 'run-b');
    const a = {
      runId: 'run-a',
      requirementPath: 'requirements/a.md',
      generatedFiles: ['tests/a.spec.ts'],
      resultsDir: dirA,
      summaryPath: path.join(dirA, 'results.json'),
      startedAt: new Date().toISOString(),
    };
    const b = {
      ...a,
      runId: 'run-b',
      resultsDir: dirB,
      summaryPath: path.join(dirB, 'results.json'),
    };
    const pathA = writeValidateRunManifest(root, a);
    const pathB = writeValidateRunManifest(root, b);
    expect(pathA).not.toBe(pathB);
    expect(readValidateRunManifest(pathA)?.runId).toBe('run-a');
    expect(readValidateRunManifest(pathB)?.runId).toBe('run-b');
    fs.rmSync(root, { recursive: true, force: true });
  });

  test('stale/missing manifest is rejected', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qak-manifest-'));
    const dir = path.join(root, 'results');
    const manifest = {
      runId: 'run-a',
      requirementPath: 'requirements/a.md',
      generatedFiles: [],
      resultsDir: dir,
      summaryPath: path.join(dir, 'results.json'),
      startedAt: new Date().toISOString(),
    };
    const manifestPath = writeValidateRunManifest(root, manifest);
    expect(() =>
      assertCurrentValidateManifest(readValidateRunManifest(manifestPath), {
        runId: 'run-b',
        requirementPath: 'requirements/a.md',
        resultsDir: dir,
      }),
    ).toThrow('VALIDATE_STALE_EVIDENCE');
    expect(() =>
      assertCurrentValidateManifest(null, {
        runId: 'run-a',
        requirementPath: 'requirements/a.md',
        resultsDir: dir,
      }),
    ).toThrow('VALIDATE_STALE_EVIDENCE');
    fs.rmSync(root, { recursive: true, force: true });
  });
});
