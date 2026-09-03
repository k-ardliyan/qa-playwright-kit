import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test, expect } from '@playwright/test';
import {
  writeEvidenceManifest,
  readEvidenceManifest,
  sanitizePathSegment,
} from '../../shared/evidence/manifest';
import { normalizeConsoleMessages } from '../../shared/evidence/console-normalizer';
import { classifyFailureFromEvidence } from '../../shared/evidence/failure-classifier';
import { McpTraceWorkflow } from '../../shared/evidence/trace-workflow';
import { McpVideoWorkflow } from '../../shared/evidence/video-workflow';
import { resolveMcpOutputDir } from '../../shared/mcp/output-resolver';
import { WorkspacePathRegistry } from '../../shared/workspace-paths';
import type { EvidenceManifest } from '../../shared/evidence/types';

test.describe('Evidence-Driven Healing & Observability (MCP-053 to MCP-065)', () => {
  test('writes and reads redacted EvidenceManifest', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'evidence-manifest-test-'));

    try {
      const manifest: EvidenceManifest = {
        version: '1.0',
        runId: 'run-test-100',
        testId: 'TC-AUTH-001',
        testTitle: 'Login with valid credentials',
        attempt: 1,
        environment: 'dev',
        role: 'finance',
        failureCategory: 'auth',
        errorMessage: 'Invalid authorization token: Bearer secret_token_xyz',
        consoleLogs: [
          {
            type: 'error',
            text: 'Authorization header secret_key_123 failed',
            timestamp: new Date().toISOString(),
          },
        ],
        timestamp: new Date().toISOString(),
      };

      const writtenPath = writeEvidenceManifest(manifest, tempDir);
      expect(fs.existsSync(writtenPath)).toBe(true);

      const loaded = readEvidenceManifest(writtenPath);
      expect(loaded).not.toBeNull();
      expect(loaded?.testId).toBe('TC-AUTH-001');
      // Redaction check
      expect(loaded?.errorMessage).toContain('Bearer [REDACTED]');
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test('sanitizes runId and testId before writing manifest paths', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'evidence-traversal-test-'));

    try {
      const manifest: EvidenceManifest = {
        version: '1.0',
        runId: '../escape/run-1',
        testId: 'TC/evil',
        attempt: 1,
        environment: 'dev',
        failureCategory: 'unknown',
        timestamp: new Date().toISOString(),
      };

      const writtenPath = writeEvidenceManifest(manifest, tempDir);
      const relative = path.relative(tempDir, writtenPath);
      // No path segment may escape the target directory.
      expect(relative.split(path.sep)).not.toContain('..');
      // With customDir, runId shapes the directory; the file name is derived
      // from the sanitized testId.
      expect(relative).toContain('TC_evil'); // testId sanitized
      expect(path.basename(writtenPath)).toBe('evidence-TC_evil-att1.json');
      expect(fs.existsSync(writtenPath)).toBe(true);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test('sanitizePathSegment strips traversal and separator characters', () => {
    expect(sanitizePathSegment('../run-1')).toBe('___run-1'); // . . / each become _
    expect(sanitizePathSegment('TC/A::B')).toBe('TC_A__B'); // / and both : become _
    expect(sanitizePathSegment('safe-id_1')).toBe('safe-id_1');
  });

  test('normalizes and sanitizes console messages', () => {
    const rawLogs = [
      { type: 'error', text: 'Uncaught TypeError: Cannot read properties of undefined' },
      { type: 'warning', text: 'Cookie session_token=123 is deprecated' },
    ];

    const normalized = normalizeConsoleMessages(rawLogs);
    expect(normalized.length).toBe(2);
    expect(normalized[0].type).toBe('error');
    expect(normalized[1].type).toBe('warning');
  });

  test('classifies 500 error as non-healable application bug', () => {
    const result = classifyFailureFromEvidence('Server error', {
      networkRequests: [
        {
          method: 'POST',
          url: '/api/v1/orders',
          status: 500,
          timestamp: new Date().toISOString(),
        },
      ],
    });

    expect(result.category).toBe('application');
    expect(result.isHealable).toBe(false);
    expect(result.recommendedAction).toContain('FILE BUG');
  });

  test('classifies locator timeout as healable locator failure', () => {
    const result = classifyFailureFromEvidence(
      'TimeoutError: locator.click: Timeout 10000ms exceeded. waiting for getByRole("button", { name: "Save" })',
    );

    expect(result.category).toBe('locator');
    expect(result.isHealable).toBe(true);
    expect(result.recommendedAction).toContain('HEAL LOCATOR');
  });

  test('does not misroute a locator failure that merely mentions auth to the auth category', () => {
    const result = classifyFailureFromEvidence(
      'TimeoutError: waiting for getByRole("button", { name: "auth submit" }) to be visible',
    );

    expect(result.category).toBe('locator');
    expect(result.isHealable).toBe(true);
  });

  test('classifies bare 503/504 status text as non-healable application bug', () => {
    expect(classifyFailureFromEvidence('503 Service Unavailable').category).toBe('application');
    expect(classifyFailureFromEvidence('Gateway Timeout 504').category).toBe('application');
    expect(classifyFailureFromEvidence('500 Internal Server Error').category).toBe('application');
  });

  test('classifies locator-suffixed timeouts as healable locator failures', () => {
    const withLocator = classifyFailureFromEvidence(
      'Timeout 10000ms exceeded waiting for getByRole("button")',
    );
    expect(withLocator.category).toBe('locator');
    expect(withLocator.isHealable).toBe(true);

    const bareLocator = classifyFailureFromEvidence('locator timeout 5000ms exceeded');
    // No locator keyword marker → reasonable timing classification, still healable.
    expect(bareLocator.isHealable).toBe(true);
  });

  test('prefers locator healing over console-error application when a locator signal exists', () => {
    const result = classifyFailureFromEvidence(
      'TimeoutError: locator.click: Timeout 10000ms exceeded. waiting for getByRole("button", { name: "Save" })',
      {
        consoleLogs: [
          {
            type: 'error',
            text: 'Uncaught TypeError: Cannot read properties of undefined',
            timestamp: 'now',
          },
        ],
      },
    );
    expect(result.category).toBe('locator');
    expect(result.isHealable).toBe(true);
  });

  test('plain timeouts without locator signals remain timing', () => {
    const result = classifyFailureFromEvidence('Timeout 5000ms exceeded waiting for response');
    expect(result.category).toBe('timing');
    expect(result.isHealable).toBe(true);
  });

  test('console-normalizer skips empty strings and uses word boundaries for error', () => {
    const normalized = normalizeConsoleMessages([
      '',
      'ErrorHandler failed silently',
      'Request error: 500',
    ]);
    expect(normalized).toHaveLength(2);
    expect(normalized[0].type).toBe('info'); // ErrorHandler is not an error
    expect(normalized[1].type).toBe('error');
  });

  test('custom manifest resolves MCP evidence outputs consistently', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'evidence-workspace-test-'));
    try {
      fs.mkdirSync(path.join(tempDir, 'config'), { recursive: true });
      fs.writeFileSync(
        path.join(tempDir, 'config', 'qa-kit.workspace.json'),
        JSON.stringify({ paths: { testResults: 'out/results' } }),
      );
      const registry = new WorkspacePathRegistry(tempDir);
      const outputDir = resolveMcpOutputDir({ registry, runId: 'run-1', ensureExists: false });
      expect(outputDir).toBe(path.join(tempDir, 'out', 'results', 'mcp', 'run-1'));
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test('manages trace and video sessions', () => {
    const trace = McpTraceWorkflow.startTraceSession('run-1', 'TC-01');
    expect(trace.active).toBe(true);
    expect(trace.tracePath).toContain('TC-01');

    const stoppedTrace = McpTraceWorkflow.stopTraceSession(trace);
    expect(trace.active).toBe(false);
    expect(stoppedTrace).toBe(trace.tracePath);

    const video = McpVideoWorkflow.startVideoSession('run-1', 'TC-01');
    expect(video.chapters.length).toBe(1);
    expect(video.chapters[0].title).toBe('Precondition');

    McpVideoWorkflow.addChapter(video, 'Action: Click Save');
    const stoppedVideo = McpVideoWorkflow.stopVideoSession(video);
    expect(stoppedVideo.chapters.length).toBe(2);
  });
});
