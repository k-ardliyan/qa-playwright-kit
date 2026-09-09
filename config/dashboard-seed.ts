import type { FullConfig } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Seed the isolated QA_REPORT_DIR with deterministic report artifacts so the
 * dashboard has something real to render:
 *
 *   reports/test-summary.json      — latest run summary (latest-run marker)
 *   reports/archive/run-.../summary.json + metadata.json — archived runs
 *
 * The dashboard server (webServer) boots with QA_REPORT_DIR pointing here.
 */

export default async function globalSetup(_config: FullConfig): Promise<void> {
  const root = process.cwd();
  const reportDir = path.join(root, '.tmp', 'dashboard-browser', 'reports');
  const archiveDir = path.join(reportDir, 'archive');

  fs.rmSync(reportDir, { recursive: true, force: true });
  fs.mkdirSync(archiveDir, { recursive: true });

  const testCase = (id: string, title: string, status: string, role: string) => ({
    testId: id,
    scenarioId: id,
    title,
    fullTitle: `Auth > ${title}`,
    filePath: `tests/auth-${role}.spec.ts`,
    status,
    duration: 1250,
    errorMessage: status === 'failed' ? `Expected element to be visible for ${title}` : '',
    errors: [],
    steps: [
      { title: 'Navigate', status: 'passed', duration: 400, steps: [] },
      { title: 'Fill credentials', status: 'passed', duration: 350, steps: [] },
      { title: 'Submit', status, duration: 500, steps: [] },
    ],
    attachments: [],
    retry: 0,
    role,
    module: 'auth',
    feature: 'login',
    priority: 'high',
    inputData: { username: `${role}_user@erpku.com` },
    expectedResult: 'Dashboard loads',
    actualResult: status === 'failed' ? 'Login redirect timed out' : 'Dashboard loaded',
    affectedLayer: ['FE'],
  });

  // Latest run (not yet archived) — appears as the LatestRunCard.
  const latestSummary = {
    total: 2,
    passed: 1,
    failed: 1,
    skipped: 0,
    passRate: 50,
    timestamp: '2026-09-08T18:41:43.575Z',
    reportMode: 'general',
    rolesInScope: [],
    testCases: [
      testCase('SC-L1', 'Login with valid credentials', 'passed', 'user'),
      testCase('SC-L2', 'Login with wrong password', 'failed', 'user'),
    ],
    runMeta: {
      appEnv: 'dev',
      runId: 'run-20260908-184143-575',
      requirementPath: 'requirements/auth/login-none.md',
      ci: false,
      totalDurationMs: 4100,
      generatedAt: '2026-09-08T18:41:43.575Z',
    },
  };
  fs.writeFileSync(
    path.join(reportDir, 'test-summary.json'),
    JSON.stringify(latestSummary, null, 2),
  );

  fs.writeFileSync(
    path.join(reportDir, '.latest-run'),
    JSON.stringify({
      archiveRunId: 'run-20260908-184143-575',
      timestamp: '2026-09-08T18:41:43.575Z',
      summaryPath: path.join(reportDir, 'test-summary.json').replace(/\\/g, '/'),
      total: 2,
      passed: 1,
      failed: 1,
      skipped: 0,
      passRate: 50,
      reportMode: 'general',
      appEnv: 'dev',
      totalDurationMs: 4100,
    }),
  );

  // Two archived runs for the history table + compare.
  const archives = [
    {
      runId: 'run-20260908-174000-000',
      displayName: 'Test Run — dev — 8 Sept, 17:40',
      testCases: [
        testCase('SC-A1', 'Login with valid credentials', 'passed', 'user'),
        testCase('SC-A2', 'Login with wrong password', 'failed', 'user'),
      ],
      savedAt: '2026-09-08T17:40:00.000Z',
      ranAt: '2026-09-08T17:39:10.000Z',
      qaDecision: 'APPROVE',
    },
    {
      runId: 'run-20260908-170000-000',
      displayName: 'Test Run — dev — 8 Sept, 17:00',
      testCases: [
        testCase('SC-B1', 'Login with valid credentials', 'passed', 'user'),
        testCase('SC-B2', 'Login with wrong password', 'passed', 'user'),
      ],
      savedAt: '2026-09-08T17:00:00.000Z',
      ranAt: '2026-09-08T16:59:10.000Z',
      qaDecision: 'FILE_BUG',
    },
  ];

  for (const arch of archives) {
    const dir = path.join(archiveDir, arch.runId);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'metadata.json'),
      JSON.stringify(
        {
          schemaVersion: 2,
          runId: arch.runId,
          displayName: arch.displayName,
          testSeriesId: 'default-series',
          requirementId: 'REQ-AUTH-001',
          requirementTitle: 'Login None',
          savedAt: arch.savedAt,
          ranAt: arch.ranAt,
          durationMs: 4100,
          appEnv: 'dev',
          requirementPath: 'requirements/auth/login-none.md',
          reportMode: 'general',
          qaDecision: arch.qaDecision,
          qaNotes: '',
          triggeredBy: 'manual',
          triggerSource: 'cli',
        },
        null,
        2,
      ),
    );
    const passRate = (arch.testCases.filter((t) => t.status === 'passed').length / 2) * 100;
    fs.writeFileSync(
      path.join(dir, 'summary.json'),
      JSON.stringify(
        {
          total: 2,
          passed: arch.testCases.filter((t) => t.status === 'passed').length,
          failed: arch.testCases.filter((t) => t.status === 'failed').length,
          skipped: 0,
          passRate,
          timestamp: arch.ranAt,
          reportMode: 'general',
          rolesInScope: [],
          testCases: arch.testCases,
          runMeta: {
            appEnv: 'dev',
            runId: arch.runId,
            requirementPath: 'requirements/auth/login-none.md',
            ci: false,
            totalDurationMs: 4100,
            generatedAt: arch.savedAt,
          },
        },
        null,
        2,
      ),
    );
  }
}
