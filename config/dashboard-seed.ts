import type { FullConfig } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { generateRunId } from '../src/agents/reporter/report-archive';

/**
 * Seed the isolated QA_REPORT_DIR with deterministic report artifacts so the
 * dashboard has something real to render:
 *
 *   reports/test-summary.json      — latest run summary (latest-run marker)
 *   reports/archive/run-.../summary.json + metadata.json — archived runs
 *   reports/attachments/*.png      — tiny real files so evidence thumbs render
 *
 * The dashboard server (webServer) boots with QA_REPORT_DIR pointing here.
 *
 * INVARIANTS the browser suite depends on — change these and update
 * src/__tests__/dashboard-browser/*.spec.ts in the same commit:
 *   - latest run contains a FAILING test with testId SC-L2 (triage + ?test=)
 *   - exactly two archives carry the display names '…8 Sept, 17:40' / '17:00'
 *   - exactly ONE archive has qaDecision APPROVE (?decision=APPROVE → 1 row)
 */

/** A 1×1 PNG so seeded screenshot evidence renders instead of 404-ing. */
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

/**
 * A real VP8 webm (320×180, 1s) so the video thumbnail decodes an actual frame.
 * A byte-stub loads without error but never paints, so `videoWidth > 0` — the
 * assertion the browser suite makes — would pass vacuously against it.
 */
const SEED_WEBM = Buffer.from(
  'GkXfo59ChoEBQveBAULygQRC84EIQoKEd2VibUKHgQJChYECGFOAZwEAAAAAAAVMEU2bdLpNu4tTq4QVSalmU6yBoU27i1OrhBZU' +
    'rmtTrIHWTbuMU6uEElTDZ1OsggEzTbuMU6uEHFO7a1OsggU27AEAAAAAAABZAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
    'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAVSalmsCrXsYMPQkBNgIxM' +
    'YXZmNjMuMS4xMDFXQYxMYXZmNjMuMS4xMDFEiYhAj0AAAAAAABZUrmvYrgEAAAAAAABP14EBc8WIJ6Tnrq+RKEOcgQAitZyDdW5k' +
    'iIEAhoVWX1ZQOIOBASPjg4QCYloA4JGwggFAuoG0moECVbCEVbmBAVXugQDsAQAAAAAAAAIAABJUw2f6c3OfY8CAZ8iZRaOHRU5D' +
    'T0RFUkSHjExhdmY2My4xLjEwMXNz1WPAi2PFiCek566vkShDZ8igRaOHRU5DT0RFUkSHk0xhdmM2My4xLjEwMSBsaWJ2cHhnyKFF' +
    'o4hEVVJBVElPTkSHkzAwOjAwOjAxLjAwMDAwMDAwMAAfQ7Z1Q37ngQCjQJKBAACA8A4AnQEqQAG0AABHCIWFiIWEiAICAAYWBWl9' +
    'r25snOHsnOHsnOHsnOHsnOHsnOHsnOHsnOHsnOHsnOHsnOHsnOHsnOHsnOHsnOHsnOHsnOHsnOHsnOHsnOHsnOHsnOHsnOHsnOHs' +
    'nOHsnOHsnOHsnOHsnOHsnOHsnOHsnOHsnOHsnN4A/v9VYf/+dvxB+oLkAKOdgQAoALECAAEQEAAYABhYL/QACIAEM1+tck+VgACjnYEA' +
    'UACxAgABEBAAGAAYWC/0AAiABDNfrXJPlYAAo52BAHgAsQIAARAQABgAGFgv9AAIgAQzX61yT5WAAKOdgQCgALECAAEQEAAYABhY' +
    'L/QACIAEM1+tck+VgACjnYEAyACxAgABEBAAGAAYWC/0AAiABDNfrXJPlYAAo52BAPAAsQIAARAQABgAGFgv9AAIgAQzX61yT5WA' +
    'AKOcgQEYAJECAAEQEBRgAGFgv9AAIgAQzX61yT5WAKOdgQFAALECAAEQEAAYABhYL/QACIAEM1+tck+VgACjnYEBaACxAgABEBAA' +
    'GAAYWC/0AAiABDNfrXJPlYAAo52BAZAAsQIAARAQABgAGFgv9AAIgAQzX61yT5WAAKOdgQG4ALECAAEQEAAYABhYL/QACIAEM1+t' +
    'ck+VgACjnYEB4ACxAgABEBAAGAAYWC/0AAiABDNfrXJPlYAAo52BAggAsQIAARAQABgAGFgv9AAIgAQzX61yT5WAAKOdgQIwALEC' +
    'AAEQEAAYABhYL/QACIAEM1+tck+VgACjnYECWACxAgABEBAAGAAYWC/0AAiABDNfrXJPlYAAo52BAoAAsQIAARAQABgAGFgv9AAI' +
    'gAQzX61yT5WAAKOdgQKoALECAAEQEAAYABhYL/QACIAEM1+tck+VgACjnIEC0ACRAgABEBAUYABhYL/QACIAEM1+tck+VgCjnYEC' +
    '+ACxAgABEBAAGAAYWC/0AAiABDNfrXJPlYAAo52BAyAAsQIAARAQABgAGFgv9AAIgAQzX61yT5WAAKOdgQNIALECAAEQEAAYABhY' +
    'L/QACIAEM1+tck+VgACjnYEDcACxAgABEBAAGAAYWC/0AAiABDNfrXJPlYAAo52BA5gAsQIAARAQABgAGFgv9AAIgAQzX61yT5WA' +
    'AKOdgQPAALECAAEQEAAYABhYL/QACIAEM1+tck+VgAAcU7trkbuPs4EAt4r3gQHxggGy8IED',
  'base64',
);

interface CaseSpec {
  id: string;
  title: string;
  status: string;
  role: string;
  module?: string;
  feature?: string;
  priority?: string;
  failureSource?: string;
  retry?: number;
  layers?: string[];
  evidence?: boolean;
  /** Per-scenario fixme reason — the "why" behind a not-implemented row. */
  notImplementedReason?: string;
}

function testCase(spec: CaseSpec) {
  const {
    id,
    title,
    status,
    role,
    module = 'auth',
    feature = 'login',
    priority = 'medium',
    failureSource,
    retry = 0,
    layers = ['FE'],
    evidence = false,
    notImplementedReason,
  } = spec;

  const failed = status === 'failed' || status === 'timedOut' || status === 'interrupted';

  return {
    testId: id,
    scenarioId: id,
    title,
    fullTitle: `${module} > ${feature} > ${title}`,
    filePath: `tests/${module}-${feature}.spec.ts`,
    status,
    duration: 400 + ((id.charCodeAt(id.length - 1) * 137) % 3200),
    errorMessage: failed ? `Expected element to be visible for ${title}` : '',
    errors: [],
    steps: [
      {
        title: 'Navigate',
        status: 'passed',
        duration: 400,
        steps: [],
        location: { file: `tests/${module}-${feature}.spec.ts`, line: 12, column: 3 },
        snippet: {
          startLine: 10,
          highlightLine: 12,
          lines: [
            `test('${title}', async ({ page }) => {`,
            '  await page.goto(baseUrl);',
            "  await page.getByLabel('Username').fill(user);",
            '});',
          ],
        },
      },
      { title: 'Fill credentials', status: 'passed', duration: 350, steps: [] },
      { title: 'Submit', status: failed ? status : 'passed', duration: 500, steps: [] },
    ],
    attachments: evidence
      ? [
          { kind: 'trace', name: `${id}-trace.zip`, relativePath: `attachments/${id}-trace.zip` },
          {
            kind: 'screenshot',
            name: `${id}.png`,
            relativePath: `attachments/${id}.png`,
          },
          // A recording on the failing case so the video path (thumbnail in the
          // table, video stage in the lightbox) is exercised against real bytes.
          ...(id === 'SC-L2'
            ? [
                {
                  kind: 'video',
                  name: `${id}-recording.webm`,
                  contentType: 'video/webm',
                  relativePath: `attachments/${id}-recording.webm`,
                },
              ]
            : []),
        ]
      : [],
    retry,
    role,
    module,
    feature,
    priority,
    failureSource,
    ...(notImplementedReason ? { notImplementedReason } : {}),
    workerIndex: 1 + (id.charCodeAt(id.length - 1) % 3),
    inputData: { username: `${role}_user@erpku.com` },
    expectedResult: 'Dashboard loads',
    actualResult: failed ? 'Login redirect timed out' : 'Dashboard loaded',
    affectedLayer: layers,
  };
}

export default async function globalSetup(_config: FullConfig): Promise<void> {
  const root = process.cwd();
  const reportDir = path.join(root, '.tmp', 'dashboard-browser', 'reports');
  const archiveDir = path.join(reportDir, 'archive');

  fs.rmSync(reportDir, { recursive: true, force: true });
  fs.mkdirSync(archiveDir, { recursive: true });

  // Real (tiny) evidence files so thumbnails resolve.
  const attachDir = path.join(reportDir, 'attachments');
  fs.mkdirSync(attachDir, { recursive: true });
  for (const name of ['SC-L2.png', 'SC-P3.png', 'SC-R4.png']) {
    fs.writeFileSync(path.join(attachDir, name), TINY_PNG);
  }
  fs.writeFileSync(path.join(attachDir, 'SC-L2-recording.webm'), SEED_WEBM);

  // Latest run (not yet archived) — appears as the LatestRunCard.
  // analysisVerdict/Verified exercise the analysis badge; aiInsights feeds the
  // deterministic side of the AI Run Insights panel.
  const latestCases = [
    testCase({
      id: 'SC-L1',
      title: 'Login with valid credentials',
      status: 'passed',
      role: 'user',
      priority: 'high',
    }),
    testCase({
      id: 'SC-L2',
      title: 'Login with wrong password',
      status: 'failed',
      role: 'user',
      priority: 'high',
      failureSource: 'app',
      retry: 1,
      evidence: true,
    }),
    testCase({
      id: 'SC-L3',
      title: 'Login with empty username',
      status: 'passed',
      role: 'user',
      priority: 'medium',
      // Passed only after a retry → the Flaky panel's signal. Without at least
      // one such case the panel can only ever render its empty state.
      retry: 1,
    }),
    testCase({
      id: 'SC-L4',
      title: 'Logout clears session',
      status: 'skipped',
      role: 'user',
      priority: 'low',
    }),
    testCase({
      id: 'SC-P1',
      title: 'Approve pending invoice',
      status: 'passed',
      role: 'finance',
      module: 'invoice',
      feature: 'approval',
      priority: 'high',
      layers: ['FE', 'BE'],
    }),
    testCase({
      id: 'SC-P2',
      title: 'Reject invoice with reason',
      status: 'passed',
      role: 'finance',
      module: 'invoice',
      feature: 'approval',
      priority: 'medium',
      layers: ['FE', 'BE'],
    }),
    testCase({
      id: 'SC-P3',
      title: 'Export invoice to PDF',
      status: 'failed',
      role: 'finance',
      module: 'invoice',
      feature: 'export',
      priority: 'high',
      failureSource: 'test',
      evidence: true,
      layers: ['FE', 'API'],
    }),
    testCase({
      id: 'SC-R1',
      title: 'Create new employee record',
      status: 'passed',
      role: 'hrd',
      module: 'employee',
      feature: 'crud',
      priority: 'high',
      layers: ['FE', 'DB'],
    }),
    testCase({
      id: 'SC-R2',
      title: 'Update attendance dashboard',
      status: 'passed',
      role: 'hrd',
      module: 'attendance',
      feature: 'dashboard',
      priority: 'medium',
    }),
    testCase({
      id: 'SC-R3',
      title: 'Bulk import attendance CSV',
      status: 'timedOut',
      role: 'hrd',
      module: 'attendance',
      feature: 'import',
      priority: 'high',
      failureSource: 'env',
      layers: ['FE', 'API'],
    }),
    testCase({
      id: 'SC-R4',
      title: 'Recalculate payroll batch',
      status: 'failed',
      role: 'hrd',
      module: 'payroll',
      feature: 'batch',
      priority: 'high',
      failureSource: 'requirement',
      evidence: true,
      layers: ['BE', 'DB'],
    }),
    testCase({
      id: 'SC-A1',
      title: 'Role permission matrix loads',
      status: 'passed',
      role: 'admin',
      module: 'access',
      feature: 'roles',
      priority: 'medium',
    }),
    testCase({
      id: 'SC-A2',
      title: 'Audit log pagination',
      status: 'passed',
      role: 'admin',
      module: 'audit',
      feature: 'log',
      priority: 'low',
    }),
    testCase({
      id: 'SC-A3',
      title: 'Disable user account',
      status: 'passed',
      role: 'admin',
      module: 'access',
      feature: 'users',
      priority: 'high',
      layers: ['FE', 'BE', 'DB'],
    }),
    // Unbuilt work — the strip's "Belum dibangun" cell, the "Kenapa belum
    // jalan" panel and the not-implemented pill all need real rows to render
    // against, with reasons spanning more than one category.
    testCase({
      id: 'SC-N1',
      title: 'Export payroll recap to bank file',
      status: 'not-implemented',
      role: 'finance',
      module: 'payroll',
      feature: 'export',
      priority: 'high',
      layers: ['FE'],
      notImplementedReason:
        'Butuh payroll berjalan sampai status Dibayar — prasyarat rantai payroll belum tersedia.',
    }),
    testCase({
      id: 'SC-N2',
      title: 'Reconcile paid payroll against bank statement',
      status: 'not-implemented',
      role: 'hrd',
      module: 'payroll',
      feature: 'reconciliation',
      priority: 'medium',
      layers: ['FE', 'BE'],
      notImplementedReason:
        'UI belum dieksplorasi (form/dialog/stepper belum ada di selector catalog) — Explore lanjutan diperlukan',
    }),
  ];

  const failedCount = latestCases.filter(
    (t) => t.status === 'failed' || t.status === 'timedOut' || t.status === 'interrupted',
  ).length;
  const passedCount = latestCases.filter((t) => t.status === 'passed').length;
  const skippedCount = latestCases.filter((t) => t.status === 'skipped').length;
  const notImplementedCount = latestCases.filter((t) => t.status === 'not-implemented').length;

  const latestSummary = {
    total: latestCases.length,
    passed: passedCount,
    failed: failedCount,
    skipped: skippedCount,
    notImplemented: notImplementedCount,
    // Pass rate over tests that RAN (docs/REPORT-GUIDE.md): skipped and
    // not-implemented are coverage numbers, not part of the denominator.
    passRate:
      passedCount + failedCount > 0
        ? Math.round((passedCount / (passedCount + failedCount)) * 100)
        : 0,
    timestamp: '2026-09-08T18:41:43.575Z',
    reportMode: 'role-aware',
    rolesInScope: ['user', 'finance', 'hrd', 'admin'],
    analysisVerdict: 'complete',
    analysisVerified: true,
    aiInsights: [
      'Tiga kegagalan terkonsentrasi di alur invoice dan payroll — periksa perubahan skema terakhir.',
      'SC-L2 dan SC-P3 memerlukan evidence review sebelum APPROVE.',
    ],
    // Reporter Analyze declaration consumed by the archive APPROVE gate —
    // runInsightsRecorded must equal the sidecar runInsights length (2).
    analysis: { completed: true, runInsightsRecorded: 2, passedScenariosReviewed: 9 },
    testCases: latestCases,
    runMeta: {
      appEnv: 'dev',
      runId: 'run-20260908-184143-575',
      requirementPath: 'requirements/auth/login-none.md',
      ci: false,
      totalDurationMs: 41230,
      generatedAt: '2026-09-08T18:41:43.575Z',
    },
  };
  fs.writeFileSync(
    path.join(reportDir, 'test-summary.json'),
    JSON.stringify(latestSummary, null, 2),
  );

  // Notes sidecar — agent-authored run insights for the AI Run Insights panel.
  // Shape must satisfy parseTestNotesFile (version/updatedAt/notes required).
  // runId is derived with LOCAL time from summary.timestamp by generateRunId
  // (2026-09-08T18:41:43Z → local 2026-09-09 01:41 in Asia/Jakarta) and the
  // APPROVE gate requires sidecar.runId === that value, so compute it here
  // instead of hardcoding.
  const sidecarRunId = generateRunId('2026-09-08T18:41:43.575Z');
  fs.writeFileSync(
    path.join(reportDir, 'test-notes.json'),
    JSON.stringify(
      {
        version: 1,
        runId: sidecarRunId,
        updatedAt: '2026-09-08T18:45:00.000Z',
        notes: {
          'SC-L2::user': {
            qaNotes: 'Sudah dicek manual — pesan error tidak muncul di UI, hanya redirect.',
            aiNotes:
              '[healer] Elemen pesan error tidak ditemukan di DOM.\nObservasi: Redirect terjadi sebelum assertion.\nRekomendasi: Tunggu network idle sebelum assert.',
            updatedAt: '2026-09-08T18:44:00.000Z',
          },
          'SC-P3::finance': {
            aiNotes:
              '[analyzer] Durasi ekspor naik 3× dibanding run sebelumnya.\nDampak: Timeout pada batch besar.',
            updatedAt: '2026-09-08T18:44:30.000Z',
          },
        },
        runInsights: [
          {
            text: 'Kegagalan SC-L2 berulang di dua run terakhir — indikasi seed data atau regressi UI login.',
            source: 'reporter',
            kind: 'stability',
            status: 'observed',
            priority: 'high',
            confidence: 'high',
            at: '2026-09-08T18:45:00.000Z',
            affected: { tests: ['SC-L2'], modules: ['auth'] },
          },
          {
            text: 'Modul payroll dan invoice gagal bersamaan — kemungkinan migrasi skema bersama.',
            source: 'analyzer',
            kind: 'regression',
            status: 'inferred',
            priority: 'medium',
            confidence: 'medium',
            at: '2026-09-08T18:45:10.000Z',
            affected: { tests: ['SC-R4', 'SC-P3'], modules: ['payroll', 'invoice'] },
          },
        ],
      },
      null,
      2,
    ),
  );

  fs.writeFileSync(
    path.join(reportDir, '.latest-run'),
    JSON.stringify({
      archiveRunId: 'run-20260908-184143-575',
      timestamp: '2026-09-08T18:41:43.575Z',
      summaryPath: path.join(reportDir, 'test-summary.json').replace(/\\/g, '/'),
      total: latestSummary.total,
      passed: latestSummary.passed,
      failed: latestSummary.failed,
      skipped: latestSummary.skipped,
      passRate: latestSummary.passRate,
      reportMode: 'role-aware',
      appEnv: 'dev',
      totalDurationMs: 41230,
    }),
  );

  // Archived runs — history table + compare. Exactly one carries APPROVE so the
  // /history?decision=APPROVE deep-link keeps resolving to a single row.
  const archives = [
    {
      runId: 'run-20260908-174000-000',
      displayName: 'Test Run — dev — 8 Sept, 17:40',
      testCases: [
        testCase({
          id: 'SC-A1',
          title: 'Login with valid credentials',
          status: 'passed',
          role: 'user',
          priority: 'high',
        }),
        testCase({
          id: 'SC-A2',
          title: 'Login with wrong password',
          status: 'failed',
          role: 'user',
          priority: 'high',
          failureSource: 'app',
        }),
      ],
      savedAt: '2026-09-08T17:40:00.000Z',
      ranAt: '2026-09-08T17:39:10.000Z',
      qaDecision: 'APPROVE',
      qaNotes: 'Baseline diterima setelah review evidence.',
    },
    {
      runId: 'run-20260908-170000-000',
      displayName: 'Test Run — dev — 8 Sept, 17:00',
      testCases: [
        testCase({
          id: 'SC-B1',
          title: 'Login with valid credentials',
          status: 'passed',
          role: 'user',
          priority: 'high',
        }),
        testCase({
          id: 'SC-B2',
          title: 'Login with wrong password',
          status: 'passed',
          role: 'user',
          priority: 'high',
        }),
      ],
      savedAt: '2026-09-08T17:00:00.000Z',
      ranAt: '2026-09-08T16:59:10.000Z',
      qaDecision: 'FILE_BUG',
      qaNotes: 'Bug UI-2291 dilaporkan untuk alur login.',
    },
    {
      runId: 'run-20260907-160000-000',
      displayName: 'Test Run — dev — 7 Sept, 16:00',
      testCases: [
        testCase({
          id: 'SC-C1',
          title: 'Invoice approval flow',
          status: 'passed',
          role: 'finance',
          module: 'invoice',
          feature: 'approval',
          priority: 'high',
        }),
        testCase({
          id: 'SC-C2',
          title: 'Payroll batch recalculation',
          status: 'failed',
          role: 'hrd',
          module: 'payroll',
          feature: 'batch',
          priority: 'high',
          failureSource: 'requirement',
        }),
      ],
      savedAt: '2026-09-07T16:00:00.000Z',
      ranAt: '2026-09-07T15:59:00.000Z',
      qaDecision: 'REVISE_REQUIREMENT',
      qaNotes: 'Ambang batas payroll belum didefinisikan di requirement.',
    },
    {
      runId: 'run-20260906-090000-000',
      displayName: 'Test Run — dev — 6 Sept, 09:00',
      testCases: [
        testCase({
          id: 'SC-D1',
          title: 'Attendance CSV import',
          status: 'passed',
          role: 'hrd',
          module: 'attendance',
          feature: 'import',
          priority: 'medium',
        }),
        testCase({
          id: 'SC-D2',
          title: 'Audit log pagination',
          status: 'passed',
          role: 'admin',
          module: 'audit',
          feature: 'log',
          priority: 'low',
        }),
      ],
      savedAt: '2026-09-06T09:00:00.000Z',
      ranAt: '2026-09-06T08:59:00.000Z',
      qaDecision: 'FIX_TEST',
      qaNotes: 'Selector diperbaiki, dijalankan ulang hijau.',
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
          durationMs: 41230,
          appEnv: 'dev',
          requirementPath: 'requirements/auth/login-none.md',
          reportMode: 'general',
          qaDecision: arch.qaDecision,
          qaNotes: arch.qaNotes,
          triggeredBy: 'manual',
          triggerSource: 'cli',
        },
        null,
        2,
      ),
    );

    const passed = arch.testCases.filter((t) => t.status === 'passed').length;
    const failed = arch.testCases.filter((t) => t.status !== 'passed').length;
    fs.writeFileSync(
      path.join(dir, 'summary.json'),
      JSON.stringify(
        {
          total: arch.testCases.length,
          passed,
          failed,
          skipped: 0,
          passRate: Math.round((passed / arch.testCases.length) * 100),
          timestamp: arch.ranAt,
          reportMode: 'general',
          rolesInScope: [],
          testCases: arch.testCases,
          runMeta: {
            appEnv: 'dev',
            runId: arch.runId,
            requirementPath: 'requirements/auth/login-none.md',
            ci: false,
            totalDurationMs: 41230,
            generatedAt: arch.savedAt,
          },
        },
        null,
        2,
      ),
    );
  }
}
