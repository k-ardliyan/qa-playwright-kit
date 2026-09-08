/**
 * Security & protocol hardening tests for the workflow_run MCP tool.
 *
 * Validates Task 7.x: path boundary rejection, shell-free spawning,
 * JSON parsing contract, and fail-closed behavior.
 */

import { test, expect } from '@playwright/test';
import {
  workflowRun,
  validateBoundaryPaths,
  type WorkflowRunArgs,
} from '../../../tools/mcp/src/tools/workflow-run';
import * as path from 'node:path';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');

function safe(args: Partial<WorkflowRunArgs>): WorkflowRunArgs {
  return { requirementPath: 'requirements/login.md', ...args };
}

test.describe('workflow_run boundary hardening', () => {
  test('rejects absolute requirement path', () => {
    const winResult = validateBoundaryPaths(
      safe({ requirementPath: 'C:/windows/system32/x.md' }),
      REPO_ROOT,
    );
    expect(winResult.ok).toBe(false);
    if (!winResult.ok) expect(winResult.error).toContain('repo-relative');

    const posixResult = validateBoundaryPaths(
      safe({ requirementPath: '/etc/passwd.md' }),
      REPO_ROOT,
    );
    expect(posixResult.ok).toBe(false);
    if (!posixResult.ok) expect(posixResult.error).toContain('repo-relative');
  });

  test('rejects requirement outside requirements/', () => {
    const r = validateBoundaryPaths(safe({ requirementPath: 'src/foo.md' }), REPO_ROOT);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("under 'requirements/'");
  });

  test('rejects parent traversal in requirement path', () => {
    const r = validateBoundaryPaths(
      safe({ requirementPath: 'requirements/../../secret.md' }),
      REPO_ROOT,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('parent traversal');
  });

  test('rejects non-markdown requirement extension', () => {
    const r = validateBoundaryPaths(
      safe({ requirementPath: 'requirements/login.md.exe' }),
      REPO_ROOT,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('.md');
  });

  test('rejects evidence outside selector-catalog', () => {
    const r = validateBoundaryPaths(
      safe({ evidence: ['artifacts/test-results/trace.zip'] }),
      REPO_ROOT,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('selector-catalog');
  });

  test('rejects evidence parent traversal', () => {
    const r = validateBoundaryPaths(
      safe({ evidence: ['artifacts/selector-catalog/../../.env'] }),
      REPO_ROOT,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('parent traversal');
  });

  test('rejects runId with unsafe characters', () => {
    const r = validateBoundaryPaths(safe({ runId: 'id; rm -rf /' }), REPO_ROOT);
    expect(r.ok).toBe(false);
  });

  test('accepts canonical safe request', () => {
    const r = validateBoundaryPaths(
      safe({
        evidence: ['artifacts/selector-catalog/login/home.json'],
        runId: 'run-20260907-123456-789',
      }),
      REPO_ROOT,
    );
    expect(r.ok).toBe(true);
  });

  test('workflowRun returns blocked (not spawn) for traversal', () => {
    const out = workflowRun({ requirementPath: '../../../etc/passwd' });
    expect(out.status).toBe('error');
    expect(out.errors?.[0]?.code).toBe('WORKFLOW_PATH_REJECTED');
  });

  test('workflowRun rejects shell metacharacters before spawning', () => {
    const out = workflowRun({ requirementPath: 'requirements/login.md; calc.exe' });
    expect(out.status).toBe('error');
    expect(out.errors?.[0]?.code).toBe('WORKFLOW_PATH_REJECTED');
  });

  test('workflowRun invalid input without requirementPath', () => {
    const out = workflowRun({} as WorkflowRunArgs);
    expect(out.status).toBe('error');
    expect(out.errors?.[0]?.code).toBe('INVALID_INPUT');
  });
});
