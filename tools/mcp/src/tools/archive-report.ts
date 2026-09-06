import * as fs from 'node:fs';
import * as path from 'node:path';
import { getRepoRoot, resolveAllowedPath } from '../utils/safety';
import { mcpWorkspace } from '../utils/workspace-paths';
import {
  mcpCountAgentRunInsights,
  mcpCountReporterRunInsights,
  mcpEvaluateAnalysisGate,
  mcpIsPipelineContext,
} from '../utils/analysis-gate';
import { acquireLatestNotesLock, archiveNotesSnapshot } from '../utils/test-notes';

export interface ArchiveReportInput {
  runId: string;
  reportPath: string;
  jsonReportPath?: string;
  qaDecision:
    | 'APPROVE'
    | 'FILE_BUG'
    | 'REVISE_REQUIREMENT'
    | 'FIX_TEST'
    | 'FIX_ENV'
    | 'MARK_BLOCKED';
  qaNotes?: string;
}

export interface ArchiveReportOutput {
  status: 'success' | 'error';
  code?: string;
  archivePath?: string;
  archivedFiles?: string[];
  /** Canonical verdict from the unified Analyze gate. */
  analysisVerdict?: string;
  analysisComplete?: boolean;
  analysisVerified?: boolean;
  analysisIssues?: string[];
  notesArchived?: boolean;
  message: string;
}

/** Analysis block shape expected in a pipeline-report JSON. */
interface PipelineAnalysis {
  completed?: boolean;
  runInsightsRecorded?: number;
  passedScenariosReviewed?: number;
}

/**
 * Archive a pipeline report (Markdown + JSON summary + metadata + attachments) to artifacts/reports/archive/<runId>/.
 * Uses canonical schema (metadata.json + summary.json) matching custom-dashboard standards.
 * Requires an explicit QA decision and never overwrites an existing archive.
 * Analyze-phase gate: APPROVE requires proof of the Analyze sub-phase
 * (declaration complete + sidecar evidence consistent — same contract as
 * saveLatestRun via src/agents/reporter/analysis-gate.ts).
 */
export function archiveReport(input: ArchiveReportInput): ArchiveReportOutput {
  const { runId, reportPath, jsonReportPath, qaDecision, qaNotes = '' } = input;

  if (!qaDecision) {
    return { status: 'error', message: 'qaDecision is required; archiving never implies APPROVE.' };
  }

  if (!runId || typeof runId !== 'string' || runId.trim().length === 0) {
    return { status: 'error', message: 'runId is required and must be a non-empty string.' };
  }

  // Sanitise runId — only allow alphanumeric, hyphens, underscores
  if (!/^[a-zA-Z0-9_-]+$/.test(runId)) {
    return {
      status: 'error',
      message: `Invalid runId "${runId}". Only alphanumeric characters, hyphens, and underscores are allowed.`,
    };
  }

  const repoRoot = getRepoRoot();
  const archiveDir = path.join(mcpWorkspace.reportsDir, 'archive', runId);
  if (fs.existsSync(archiveDir)) {
    return {
      status: 'error',
      message: `Archive for run ${runId} already exists. Will not overwrite.`,
    };
  }

  // Resolve and validate report path — must be inside repo (relative-based so a
  // sibling directory named `qa-playwright-kit-evil` cannot pass startsWith()).
  const insideRepo = (candidate: string): boolean => {
    const rel = path.relative(repoRoot, candidate);
    return !rel.startsWith('..') && !path.isAbsolute(rel);
  };

  const resolvedReport = resolveAllowedPath(reportPath, 'reports', {
    mustExist: true,
    readOnly: true,
  });
  if (!resolvedReport.ok) {
    return { status: 'error', message: resolvedReport.error.message };
  }
  const absoluteReportPath = resolvedReport.absolutePath;

  if (!insideRepo(absoluteReportPath)) {
    return {
      status: 'error',
      message: `reportPath "${reportPath}" must be inside the repository root.`,
    };
  }

  if (!fs.existsSync(absoluteReportPath)) {
    return {
      status: 'error',
      message: `Report file not found: ${reportPath}`,
    };
  }

  let resolvedJsonPath: string | null = null;
  if (jsonReportPath) {
    const resolvedJson = resolveAllowedPath(jsonReportPath, 'reports', {
      mustExist: true,
      readOnly: true,
    });
    if (!resolvedJson.ok) {
      return { status: 'error', message: resolvedJson.error.message };
    }
    resolvedJsonPath = resolvedJson.absolutePath;
  }

  // ── Analyze-phase verdict — computed BEFORE any write ────────────────────
  // Target flow: read report JSON + summary + sidecar evidence, evaluate the
  // verdict, THEN either reject APPROVE (no partial archive on disk) or
  // archive with the verdict surfaced.
  let analysisComplete: boolean | undefined;
  let analysis: PipelineAnalysis | undefined;
  let summaryData: Record<string, unknown> = {};
  let latestNotesSnapshot: {
    runId?: string;
    runInsights?: Array<{ source?: string }>;
  } | null = null;

  if (!resolvedJsonPath) {
    const defaultSummary = path.join(mcpWorkspace.reportsDir, 'test-summary.json');
    if (fs.existsSync(defaultSummary)) {
      resolvedJsonPath = defaultSummary;
    }
  }
  if (resolvedJsonPath && resolvedJsonPath.endsWith('.json') && fs.existsSync(resolvedJsonPath)) {
    try {
      summaryData = JSON.parse(fs.readFileSync(resolvedJsonPath, 'utf-8')) as Record<
        string,
        unknown
      >;
      analysis = summaryData['analysis'] as PipelineAnalysis | undefined;
      if (analysis && typeof analysis === 'object') {
        analysisComplete = analysis.completed === true;
      }
    } catch {
      // Unreadable JSON — no analysis verdict
    }
  }

  // Sidecar evidence — acquire the source lock BEFORE reading. The lock stays
  // held through gate evaluation and archive sidecar carry, so evidence and
  // archived notes are the same snapshot.
  const latestLock = acquireLatestNotesLock();
  latestNotesSnapshot = latestLock.snapshot;
  let runInsightsCount: number | undefined;
  let agentRunInsightsCount: number | undefined;
  let reporterRunInsightsCount: number | undefined;
  if (latestNotesSnapshot && Array.isArray(latestNotesSnapshot.runInsights)) {
    runInsightsCount = latestNotesSnapshot.runInsights.length;
    agentRunInsightsCount = mcpCountAgentRunInsights(latestNotesSnapshot);
    reporterRunInsightsCount = mcpCountReporterRunInsights(latestNotesSnapshot);
  }

  const gate = mcpEvaluateAnalysisGate({
    qaDecision,
    pipelineContext: mcpIsPipelineContext(summaryData),
    declaration: analysis,
    evidence: {
      sidecarAvailable: latestNotesSnapshot !== null,
      sidecarRunId: latestNotesSnapshot?.runId,
      expectedRunId: runId,
      runInsightsCount,
      agentRunInsightsCount,
      reporterRunInsightsCount,
      passedCount: summaryData['passed'] as number | undefined,
    },
  });

  if (!gate.allowed) {
    latestLock.release();
    return {
      status: 'error',
      code: gate.code,
      message:
        `${gate.code}: ${gate.issues.join('; ')}. ` +
        'Run the Analyze sub-phase (record_ai_note scope=run) and rebuild the report, ' +
        'or choose a non-APPROVE decision.',
    };
  }

  try {
    fs.mkdirSync(archiveDir, { recursive: true });

    const archivedFiles: string[] = [];

    // 1. Copy Markdown report
    const mdDest = path.join(archiveDir, path.basename(absoluteReportPath));
    fs.copyFileSync(absoluteReportPath, mdDest);
    archivedFiles.push(path.relative(repoRoot, mdDest).replace(/\\/g, '/'));

    // 2. Write summary.json (copy from the resolved JSON — parsed pre-gate)
    if (resolvedJsonPath && fs.existsSync(resolvedJsonPath)) {
      const jsonDest = path.join(archiveDir, 'summary.json');
      fs.writeFileSync(jsonDest, JSON.stringify(summaryData, null, 2), 'utf-8');
      archivedFiles.push(path.relative(repoRoot, jsonDest).replace(/\\/g, '/'));
    }

    // 3. Write canonical metadata.json (schema v2)
    const runMeta = (summaryData.runMeta as Record<string, unknown> | undefined) || {};
    const metadata = {
      schemaVersion: 2,
      runId,
      displayName: `Pipeline Run ${runId}`,
      testSeriesId: (summaryData.requirementId as string) || 'pipeline',
      requirementId: (summaryData.requirementId as string) || '',
      requirementTitle: (summaryData.requirementTitle as string) || '',
      savedAt: new Date().toISOString(),
      ranAt: (summaryData.timestamp as string) || new Date().toISOString(),
      durationMs: (runMeta.totalDurationMs as number) || 0,
      appEnv: (runMeta.appEnv as string) || process.env.APP_ENV || 'local',
      baseUrl: process.env.BASE_URL,
      requirementPath: (summaryData.requirementPath as string) || reportPath,
      reportMode: (summaryData.reportMode as string) || 'general',
      qaDecision,
      qaNotes,
      triggeredBy: 'pipeline',
      triggerSource: 'mcp-tool',
      analysisVerdict: gate.verdict,
      analysisVerified: gate.analysisVerified,
      analysisIssues: gate.issues.length > 0 ? gate.issues : undefined,
      files: archivedFiles,
    };
    const metaDest = path.join(archiveDir, 'metadata.json');
    fs.writeFileSync(metaDest, JSON.stringify(metadata, null, 2), 'utf-8');
    archivedFiles.push(path.relative(repoRoot, metaDest).replace(/\\/g, '/'));

    // 3b. Carry the exact sidecar snapshot used by the gate. The destination
    // is written atomically under its lock; latest is reset only after the
    // archive sidecar is committed. A copy failure is fatal for APPROVE.
    if (latestNotesSnapshot) {
      const notesDest = path.join(archiveDir, 'test-notes.json');
      const destinationLock = `${notesDest}.lock`;
      try {
        if (fs.existsSync(notesDest)) throw new Error('archive notes destination already exists');
        fs.mkdirSync(destinationLock);
        if (fs.existsSync(notesDest)) throw new Error('archive notes destination already exists');
        const tmp = `${notesDest}.${process.pid}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify(latestNotesSnapshot, null, 2), 'utf-8');
        fs.renameSync(tmp, notesDest);
        archivedFiles.push(path.relative(repoRoot, notesDest).replace(/\\/g, '/'));
        fs.rmSync(path.join(mcpWorkspace.reportsDir, 'test-notes.json'), { force: true });
      } catch (err) {
        try {
          fs.rmSync(`${notesDest}.${process.pid}.tmp`, { force: true });
        } catch {
          // Best-effort temp cleanup
        }
        if (qaDecision === 'APPROVE') {
          return {
            status: 'error',
            code: 'NOTES_ARCHIVE_FAILED',
            message: `NOTES_ARCHIVE_FAILED: could not carry test-notes.json: ${err instanceof Error ? err.message : String(err)}`,
          };
        }
      } finally {
        try {
          fs.rmSync(destinationLock, { recursive: true, force: true });
        } catch {
          // Best-effort lock release
        }
      }
    }

    // 4. Snapshot attachments folder if exists
    const srcAttachments = path.join(mcpWorkspace.reportsDir, 'attachments');
    if (fs.existsSync(srcAttachments) && fs.statSync(srcAttachments).isDirectory()) {
      try {
        const destAttachments = path.join(archiveDir, 'attachments');
        fs.cpSync(srcAttachments, destAttachments, { recursive: true });
        archivedFiles.push(path.relative(repoRoot, destAttachments).replace(/\\/g, '/'));
      } catch {
        // Non-blocking attachment snapshot
      }
    }

    const archivePath = path.relative(repoRoot, archiveDir).replace(/\\/g, '/');

    const warnings: string[] = [];
    if (gate.verdict === 'incomplete') {
      warnings.push(
        'WARNING: pipeline report has no completed AI analysis (analysis.completed !== true).',
      );
    }
    if (gate.verdict === 'inconsistent') {
      warnings.push(
        `WARNING: analysis counts do not match archived evidence: ${gate.issues.join('; ')}.`,
      );
    }
    if (gate.verdict === 'unverifiable') {
      warnings.push(
        'WARNING: AI analysis could not be verified (no analysis block, no agent run insights).',
      );
    }
    const notesArchived = archivedFiles.some((file) => file.endsWith('/test-notes.json'));
    latestLock.release();
    return {
      status: 'success',
      archivePath,
      archivedFiles,
      analysisVerdict: gate.verdict,
      analysisComplete: analysisComplete ?? gate.verdict === 'complete',
      analysisVerified: gate.analysisVerified,
      analysisIssues: gate.issues.length > 0 ? gate.issues : undefined,
      notesArchived,
      message:
        `Report archived to ${archivePath} (${archivedFiles.length} item(s)).` +
        `${warnings.length > 0 ? ` ${warnings.join(' ')}` : ''}`,
    };
  } catch (error) {
    latestLock.release();
    const message = error instanceof Error ? error.message : 'Unknown error archiving report';
    return { status: 'error', message };
  }
}
