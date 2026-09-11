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
  resolveDriverTimeoutMs,
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

test.describe('workflow_run driver timeout resolution', () => {
  test('defaults to 10 minutes when nothing is configured', () => {
    const prev = process.env['QA_WORKFLOW_TIMEOUT_MS'];
    delete process.env['QA_WORKFLOW_TIMEOUT_MS'];
    expect(resolveDriverTimeoutMs(undefined)).toBe(600_000);
    if (prev === undefined) delete process.env['QA_WORKFLOW_TIMEOUT_MS'];
    else process.env['QA_WORKFLOW_TIMEOUT_MS'] = prev;
  });

  test('accepts an explicit in-range value and floors it', () => {
    expect(resolveDriverTimeoutMs(900_000)).toBe(900_000);
    expect(resolveDriverTimeoutMs(120_000.7)).toBe(120_000);
  });

  test('rejects out-of-range or non-numeric values (falls back, never unbounded)', () => {
    const prev = process.env['QA_WORKFLOW_TIMEOUT_MS'];
    delete process.env['QA_WORKFLOW_TIMEOUT_MS'];
    expect(resolveDriverTimeoutMs(1_000)).toBe(600_000); // below min
    expect(resolveDriverTimeoutMs(99_999_999)).toBe(600_000); // above max
    expect(resolveDriverTimeoutMs(Number.NaN)).toBe(600_000);
    expect(resolveDriverTimeoutMs('soon')).toBe(600_000);
    if (prev === undefined) delete process.env['QA_WORKFLOW_TIMEOUT_MS'];
    else process.env['QA_WORKFLOW_TIMEOUT_MS'] = prev;
  });

  test('environment override applies only inside the allowed range', () => {
    const prev = process.env['QA_WORKFLOW_TIMEOUT_MS'];
    process.env['QA_WORKFLOW_TIMEOUT_MS'] = '1800000';
    expect(resolveDriverTimeoutMs(undefined)).toBe(1_800_000);

    process.env['QA_WORKFLOW_TIMEOUT_MS'] = '1';
    expect(resolveDriverTimeoutMs(undefined)).toBe(600_000);

    if (prev === undefined) delete process.env['QA_WORKFLOW_TIMEOUT_MS'];
    else process.env['QA_WORKFLOW_TIMEOUT_MS'] = prev;
  });
});
