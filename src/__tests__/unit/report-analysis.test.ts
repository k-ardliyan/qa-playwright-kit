import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const TMP_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-report-analysis-'));
const TMP_REPORT_DIR = path.join(TMP_ROOT, 'reports');
fs.mkdirSync(TMP_REPORT_DIR, { recursive: true });
process.env['QA_REPORT_DIR'] = TMP_REPORT_DIR;

import { test, expect } from '@playwright/test';
import {
  buildReport,
  isAnalysisComplete,
  writeReportMarkdown,
} from '../../agents/reporter/report-builder';
import { evaluateAnalysisGate } from '../../agents/reporter/analysis-gate';
import { mcpEvaluateAnalysisGate } from '../../../tools/mcp/src/utils/analysis-gate';

const BASE_INPUT = {
  runId: 'run-test-analysis-001',
  startedAt: '2026-09-06T08:00:00.000Z',
  completedAt: '2026-09-06T08:05:00.000Z',
  scenariosPlanned: 3,
  testsGenerated: 3,
  testResults: { passing: 2, failing: 1, skipped: 0 },
  healedCount: 0,
  scenarios: [
    { id: 'SC-01', name: 'login works', status: 'passed' as const },
    { id: 'SC-02', name: 'logout works', status: 'passed' as const },
    { id: 'SC-03', name: 'upload fails', status: 'failed' as const },
  ],
  unresolvedFailures: [],
};

test.afterAll(() => {
  fs.rmSync(TMP_ROOT, { recursive: true, force: true });
  delete process.env['QA_REPORT_DIR'];
});

test.describe('PipelineReport analysis contract', () => {
  test('buildReport defaults analysis to completed:false when Analyze was not proven', () => {
    const report = buildReport(BASE_INPUT);
    expect(report.analysis).toEqual({ completed: false });
    expect(isAnalysisComplete(report)).toBe(false);
  });

  test('buildReport preserves the Reporter-declared analysis and validates it', () => {
    const report = buildReport({
      ...BASE_INPUT,
      analysis: { completed: true, runInsightsRecorded: 2, passedScenariosReviewed: 2 },
    });
    expect(report.analysis?.completed).toBe(true);
    expect(isAnalysisComplete(report)).toBe(true);
  });

  test('markdown carries the AI Analysis section with a warning when incomplete', () => {
    const reportPath = writeReportMarkdown(buildReport(BASE_INPUT));
    const md = fs.readFileSync(reportPath, 'utf-8');
    expect(md).toContain('## AI Analysis');
    expect(md).toContain('**Completed:** false');
    expect(md).toContain('⚠️ Analyze sub-phase tidak terbukti berjalan');
    expect(reportPath).toContain(`pipeline-report-${BASE_INPUT.runId}.md`);
    fs.rmSync(reportPath, { force: true });
  });

  test('markdown omits the warning and includes counts when analysis completed', () => {
    const reportPath = writeReportMarkdown(
      buildReport({
        ...BASE_INPUT,
        analysis: { completed: true, runInsightsRecorded: 2, passedScenariosReviewed: 2 },
      }),
    );
    const md = fs.readFileSync(reportPath, 'utf-8');
    expect(md).toContain('**Completed:** true');
    expect(md).toContain('**Run insights recorded:** 2');
    expect(md).toContain('**Passed scenarios reviewed:** 2');
    expect(md).not.toContain('⚠️');
    fs.rmSync(reportPath, { force: true });
  });
});

test.describe('evaluateAnalysisGate (unified archive gate)', () => {
  const APPROVE = 'APPROVE';

  test('plain runs without pipeline context are not gated', () => {
    const result = evaluateAnalysisGate({
      qaDecision: APPROVE,
      pipelineContext: false,
      evidence: {},
    });
    expect(result.allowed).toBe(true);
    expect(result.verdict).toBe('not-applicable');
  });

  test('pipeline APPROVE without declaration or agent insights is rejected as unverifiable', () => {
    const result = evaluateAnalysisGate({
      qaDecision: APPROVE,
      pipelineContext: true,
      evidence: { runInsightsCount: 0, agentRunInsightsCount: 0, passedCount: 3 },
    });
    expect(result.allowed).toBe(false);
    expect(result.verdict).toBe('unverifiable');
    expect(result.code).toBe('ANALYSIS_UNVERIFIABLE');
  });

  test('pipeline APPROVE without a declaration is unverifiable even with agent telemetry', () => {
    const result = evaluateAnalysisGate({
      qaDecision: APPROVE,
      pipelineContext: true,
      evidence: {
        sidecarAvailable: true,
        sidecarRunId: 'run-20260906-000000-001',
        expectedRunId: 'run-20260906-000000-001',
        runInsightsCount: 1,
        agentRunInsightsCount: 1,
        reporterRunInsightsCount: 1,
        passedCount: 3,
      },
    });
    expect(result.allowed).toBe(false);
    expect(result.verdict).toBe('unverifiable');
    expect(result.code).toBe('ANALYSIS_UNVERIFIABLE');
  });

  test('pipeline APPROVE with declaration completed:false is rejected', () => {
    const result = evaluateAnalysisGate({
      qaDecision: APPROVE,
      pipelineContext: true,
      declaration: { completed: false },
      evidence: {
        sidecarAvailable: true,
        sidecarRunId: 'run-20260906-000000-001',
        expectedRunId: 'run-20260906-000000-001',
        runInsightsCount: 2,
        agentRunInsightsCount: 2,
        reporterRunInsightsCount: 1,
        passedCount: 3,
      },
    });
    expect(result.allowed).toBe(false);
    expect(result.verdict).toBe('incomplete');
    expect(result.code).toBe('ANALYSIS_INCOMPLETE');
  });

  test('pipeline APPROVE with matching declaration and bound evidence is allowed', () => {
    const result = evaluateAnalysisGate({
      qaDecision: APPROVE,
      pipelineContext: true,
      declaration: {
        completed: true,
        runInsightsRecorded: 2,
        passedScenariosReviewed: 2,
      },
      evidence: {
        sidecarAvailable: true,
        sidecarRunId: 'run-20260906-000000-001',
        expectedRunId: 'run-20260906-000000-001',
        runInsightsCount: 2,
        agentRunInsightsCount: 2,
        reporterRunInsightsCount: 1,
        passedCount: 3,
      },
    });
    expect(result.allowed).toBe(true);
    expect(result.verdict).toBe('complete');
    expect(result.analysisVerified).toBe(true);
  });

  test('over-claimed runInsightsRecorded is a hard mismatch for APPROVE', () => {
    const result = evaluateAnalysisGate({
      qaDecision: APPROVE,
      pipelineContext: true,
      declaration: { completed: true, runInsightsRecorded: 5, passedScenariosReviewed: 0 },
      evidence: {
        sidecarAvailable: true,
        sidecarRunId: 'run-20260906-000000-001',
        expectedRunId: 'run-20260906-000000-001',
        runInsightsCount: 2,
        agentRunInsightsCount: 1,
        reporterRunInsightsCount: 1,
        passedCount: 3,
      },
    });
    expect(result.allowed).toBe(false);
    expect(result.verdict).toBe('inconsistent');
    expect(result.code).toBe('ANALYSIS_EVIDENCE_MISMATCH');
  });

  test('missing sidecar evidence is strict for APPROVE (inconsistent)', () => {
    const result = evaluateAnalysisGate({
      qaDecision: APPROVE,
      pipelineContext: true,
      declaration: { completed: true, runInsightsRecorded: 1, passedScenariosReviewed: 0 },
      evidence: { passedCount: 3 },
    });
    expect(result.allowed).toBe(false);
    expect(result.verdict).toBe('inconsistent');
    expect(result.code).toBe('ANALYSIS_EVIDENCE_MISMATCH');
    expect(result.issues[0]).toContain('sidecar evidence unavailable');
  });

  test('passedScenariosReviewed cannot exceed the passed count', () => {
    const result = evaluateAnalysisGate({
      qaDecision: APPROVE,
      pipelineContext: true,
      declaration: { completed: true, runInsightsRecorded: 1, passedScenariosReviewed: 9 },
      evidence: {
        sidecarAvailable: true,
        sidecarRunId: 'run-20260906-000000-001',
        expectedRunId: 'run-20260906-000000-001',
        runInsightsCount: 1,
        agentRunInsightsCount: 1,
        reporterRunInsightsCount: 1,
        passedCount: 2,
      },
    });
    expect(result.allowed).toBe(false);
    expect(result.verdict).toBe('inconsistent');
    expect(result.code).toBe('ANALYSIS_EVIDENCE_MISMATCH');
  });

  test('non-APPROVE decisions always archive, with the verdict surfaced', () => {
    const result = evaluateAnalysisGate({
      qaDecision: 'MARK_BLOCKED',
      pipelineContext: true,
      declaration: { completed: false },
      evidence: { runInsightsCount: 0, agentRunInsightsCount: 0, passedCount: 3 },
    });
    expect(result.allowed).toBe(true);
    expect(result.verdict).toBe('incomplete');
    expect(result.code).toBe('ANALYSIS_INCOMPLETE');
  });
});

test.describe('MCP twin gate parity', () => {
  // The MCP server builds separately and keeps a twin of the gate — this
  // contract test pins both implementations to identical verdicts so they
  // can never drift apart.
  const CASES: Array<{
    name: string;
    input: {
      qaDecision: string;
      pipelineContext: boolean;
      declaration?: {
        completed?: boolean;
        runInsightsRecorded?: number;
        passedScenariosReviewed?: number;
      };
      evidence: {
        sidecarAvailable?: boolean;
        sidecarRunId?: string;
        expectedRunId?: string;
        runInsightsCount?: number;
        agentRunInsightsCount?: number;
        reporterRunInsightsCount?: number;
        passedCount?: number;
      };
    };
  }> = [
    {
      name: 'not-applicable for plain runs',
      input: { qaDecision: 'APPROVE', pipelineContext: false, evidence: {} },
    },
    {
      name: 'unverifiable without declaration or agent insights',
      input: {
        qaDecision: 'APPROVE',
        pipelineContext: true,
        evidence: { runInsightsCount: 0, agentRunInsightsCount: 0, passedCount: 3 },
      },
    },
    {
      name: 'complete via sidecar telemetry',
      input: {
        qaDecision: 'APPROVE',
        pipelineContext: true,
        evidence: { runInsightsCount: 1, agentRunInsightsCount: 1, passedCount: 3 },
      },
    },
    {
      name: 'incomplete declaration',
      input: {
        qaDecision: 'APPROVE',
        pipelineContext: true,
        declaration: { completed: false },
        evidence: {
          sidecarAvailable: true,
          sidecarRunId: 'run-20260906-000000-001',
          expectedRunId: 'run-20260906-000000-001',
          runInsightsCount: 2,
          agentRunInsightsCount: 2,
          reporterRunInsightsCount: 1,
          passedCount: 3,
        },
      },
    },
    {
      name: 'evidence mismatch',
      input: {
        qaDecision: 'APPROVE',
        pipelineContext: true,
        declaration: { completed: true, runInsightsRecorded: 5, passedScenariosReviewed: 0 },
        evidence: {
          sidecarAvailable: true,
          sidecarRunId: 'run-20260906-000000-001',
          expectedRunId: 'run-20260906-000000-001',
          runInsightsCount: 2,
          agentRunInsightsCount: 2,
          reporterRunInsightsCount: 1,
          passedCount: 3,
        },
      },
    },
    {
      name: 'complete declaration with matching evidence',
      input: {
        qaDecision: 'APPROVE',
        pipelineContext: true,
        declaration: { completed: true, runInsightsRecorded: 2, passedScenariosReviewed: 2 },
        evidence: {
          sidecarAvailable: true,
          sidecarRunId: 'run-20260906-000000-001',
          expectedRunId: 'run-20260906-000000-001',
          runInsightsCount: 2,
          agentRunInsightsCount: 2,
          reporterRunInsightsCount: 1,
          passedCount: 3,
        },
      },
    },
  ];

  for (const tc of CASES) {
    test(`src and MCP twins agree: ${tc.name}`, () => {
      const srcResult = evaluateAnalysisGate(tc.input);
      const mcpResult = mcpEvaluateAnalysisGate(tc.input);
      expect(mcpResult.verdict).toBe(srcResult.verdict);
      expect(mcpResult.allowed).toBe(srcResult.allowed);
      expect(mcpResult.code).toBe(srcResult.code);
      expect(mcpResult.issues).toEqual(srcResult.issues);
    });
  }
});
