import { test, expect } from '@playwright/test';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import {
  WorkspacePathRegistry,
  findRepoRoot,
  DEFAULT_WORKSPACE_MANIFEST,
} from '../workspace-paths';

test.describe('WorkspacePathRegistry', () => {
  test('findRepoRoot resolves current repo root', () => {
    const root = findRepoRoot(__dirname);
    expect(fs.existsSync(path.join(root, 'package.json'))).toBe(true);
  });

  test('loads default manifest when no manifest file exists in a directory', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-playwright-kit-ws-test-'));
    try {
      const reg = new WorkspacePathRegistry(tempDir);
      expect(reg.manifest.schemaVersion).toBe(DEFAULT_WORKSPACE_MANIFEST.schemaVersion);
      expect(reg.requirementsRel).toBe('requirements');
      expect(reg.testsRel).toBe('tests');
      expect(reg.artifactsRel).toBe('artifacts');
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test('resolves canonical relative and absolute paths correctly for active repository', () => {
    const reg = new WorkspacePathRegistry();
    expect(reg.requirementsRel).toBe('requirements');
    expect(reg.specsRel).toBe('specs');
    expect(reg.testsRel).toBe('tests');
    expect(reg.testDataRel).toBe('tests/data');
    expect(reg.artifactsRel).toBe('artifacts');
    expect(reg.reportsRel).toBe('artifacts/reports');
    expect(reg.testResultsRel).toBe('artifacts/test-results');
    expect(reg.selectorCatalogRel).toBe('artifacts/selector-catalog');
    expect(reg.blobReportRel).toBe('artifacts/blob-report');
    expect(reg.environmentsRel).toBe('config/environments');

    expect(path.isAbsolute(reg.requirementsDir)).toBe(true);
    expect(path.isAbsolute(reg.testsDir)).toBe(true);
    expect(path.isAbsolute(reg.artifactsDir)).toBe(true);
    expect(path.isAbsolute(reg.reportsDir)).toBe(true);
  });

  test('toRelative normalizes paths with forward slashes', () => {
    const reg = new WorkspacePathRegistry();
    const sub = path.join(reg.rootDir, 'tests', 'sample.spec.ts');
    expect(reg.toRelative(sub)).toBe('tests/sample.spec.ts');
  });

  test('ownership categories are loaded and populated', () => {
    const reg = new WorkspacePathRegistry();
    expect(Array.isArray(reg.ownership.qa)).toBe(true);
    expect(Array.isArray(reg.ownership.review)).toBe(true);
    expect(Array.isArray(reg.ownership.generated)).toBe(true);
    expect(Array.isArray(reg.ownership.protected)).toBe(true);
  });
});
