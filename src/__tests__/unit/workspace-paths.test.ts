import { test, expect } from '@playwright/test';
import * as path from 'node:path';
import {
  WorkspacePathRegistry,
  DEFAULT_WORKSPACE_MANIFEST,
  findRepoRoot,
} from '@/shared/workspace-paths';
import { mcpWorkspace } from '../../../tools/mcp/src/utils/workspace-paths';
import { McpWorkspacePathRegistry } from '../../../tools/mcp/src/utils/workspace-paths';

test.describe('Workspace Path Closure & Cross-Platform Resolver Contract (Phase 1)', () => {
  test('findRepoRoot resolves a valid directory containing workspace manifest', () => {
    const root = findRepoRoot();
    expect(root).toBeDefined();
    expect(typeof root).toBe('string');
    expect(root.length).toBeGreaterThan(0);
  });

  test('WorkspacePathRegistry resolves canonical relative paths with forward slashes', () => {
    const registry = new WorkspacePathRegistry();
    expect(registry.requirementsRel).toBe('requirements');
    expect(registry.specsRel).toBe('specs');
    expect(registry.testsRel).toBe('tests');
    expect(registry.testDataRel).toBe('tests/data');
    expect(registry.pagesRel).toBe('tests/pages');
    expect(registry.artifactsRel).toBe('artifacts');
    expect(registry.reportsRel).toBe('artifacts/reports');
    expect(registry.testResultsRel).toBe('artifacts/test-results');
    expect(registry.selectorCatalogRel).toBe('artifacts/selector-catalog');
    expect(registry.blobReportRel).toBe('artifacts/blob-report');
    expect(registry.environmentsRel).toBe('config/environments');
  });

  test('WorkspacePathRegistry resolves absolute directory paths inside rootDir', () => {
    const registry = new WorkspacePathRegistry();
    expect(registry.requirementsDir).toBe(path.resolve(registry.rootDir, 'requirements'));
    expect(registry.pagesDir).toBe(path.resolve(registry.rootDir, 'tests/pages'));
    expect(registry.selectorCatalogDir).toBe(
      path.resolve(registry.rootDir, 'artifacts/selector-catalog'),
    );
    expect(registry.reportsDir).toBe(path.resolve(registry.rootDir, 'artifacts/reports'));
    expect(registry.testResultsDir).toBe(path.resolve(registry.rootDir, 'artifacts/test-results'));
  });

  test('McpWorkspacePathRegistry mirrors canonical workspace paths identically', () => {
    expect(mcpWorkspace.requirementsRel).toBe('requirements');
    expect(mcpWorkspace.specsRel).toBe('specs');
    expect(mcpWorkspace.testsRel).toBe('tests');
    expect(mcpWorkspace.testDataRel).toBe('tests/data');
    expect(mcpWorkspace.pagesRel).toBe('tests/pages');
    expect(mcpWorkspace.artifactsRel).toBe('artifacts');
    expect(mcpWorkspace.reportsRel).toBe('artifacts/reports');
    expect(mcpWorkspace.testResultsRel).toBe('artifacts/test-results');
    expect(mcpWorkspace.selectorCatalogRel).toBe('artifacts/selector-catalog');
  });

  test('toRelative normalizes both backslashes and forward slashes cross-platform', () => {
    const registry = new WorkspacePathRegistry();
    const posixPath = `${registry.rootDir}/artifacts/reports/custom.html`;
    const winPath = `${registry.rootDir}\\artifacts\\reports\\custom.html`;
    const relWinPath = `artifacts\\reports\\custom.html`;
    const relPosixPath = `artifacts/reports/custom.html`;

    expect(registry.toRelative(posixPath)).toBe('artifacts/reports/custom.html');
    expect(registry.toRelative(winPath)).toBe('artifacts/reports/custom.html');
    expect(registry.toRelative(relWinPath)).toBe('artifacts/reports/custom.html');
    expect(registry.toRelative(relPosixPath)).toBe('artifacts/reports/custom.html');

    expect(mcpWorkspace.toRelative(posixPath)).toBe('artifacts/reports/custom.html');
    expect(mcpWorkspace.toRelative(winPath)).toBe('artifacts/reports/custom.html');
  });

  test('handles fallback to default manifest if missing or invalid path provided', () => {
    const customRegistry = new WorkspacePathRegistry('/non/existent/path/for/testing');
    expect(customRegistry.manifest.schemaVersion).toBe(DEFAULT_WORKSPACE_MANIFEST.schemaVersion);
    expect(customRegistry.pagesRel).toBe('tests/pages');
    expect(customRegistry.selectorCatalogRel).toBe('artifacts/selector-catalog');
  });

  test('MCP registry is strict by default and only compat mode falls back', () => {
    const missing = path.join('/non/existent/path/for/testing', 'child');
    expect(() => new McpWorkspacePathRegistry(missing).manifest).toThrow(
      /WORKSPACE_MANIFEST_MISSING/,
    );
    expect(new McpWorkspacePathRegistry(missing, 'compat').reportsRel).toBe('artifacts/reports');
  });
});
