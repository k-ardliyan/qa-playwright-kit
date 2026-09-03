import * as fs from 'node:fs';
import * as path from 'node:path';
import { getRepoRoot, resolveAllowedPath } from '../utils/safety';
import { mcpWorkspace } from '../utils/workspace-paths';

export interface ArchiveReportInput {
  runId: string;
  reportPath: string;
  jsonReportPath?: string;
  qaDecision:
    'APPROVE' | 'FILE_BUG' | 'REVISE_REQUIREMENT' | 'FIX_TEST' | 'FIX_ENV' | 'MARK_BLOCKED';
  qaNotes?: string;
}

export interface ArchiveReportOutput {
  status: 'success' | 'error';
  archivePath?: string;
  archivedFiles?: string[];
  message: string;
}

/**
 * Archive a pipeline report (Markdown + JSON summary + metadata + attachments) to artifacts/reports/archive/<runId>/.
 * Uses canonical schema (metadata.json + summary.json) matching custom-dashboard standards.
 * Requires an explicit QA decision and never overwrites an existing archive.
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

  try {
    fs.mkdirSync(archiveDir, { recursive: true });

    const archivedFiles: string[] = [];

    // 1. Copy Markdown report
    const mdDest = path.join(archiveDir, path.basename(absoluteReportPath));
    fs.copyFileSync(absoluteReportPath, mdDest);
    archivedFiles.push(path.relative(repoRoot, mdDest).replace(/\\/g, '/'));

    // 2. Resolve summary.json (from jsonReportPath or default artifacts/reports/test-summary.json)
    let summaryData: Record<string, unknown> = {};

    if (!resolvedJsonPath) {
      const defaultSummary = path.join(mcpWorkspace.reportsDir, 'test-summary.json');
      if (fs.existsSync(defaultSummary)) {
        resolvedJsonPath = defaultSummary;
      }
    }

    if (resolvedJsonPath && fs.existsSync(resolvedJsonPath)) {
      try {
        summaryData = JSON.parse(fs.readFileSync(resolvedJsonPath, 'utf-8'));
        const jsonDest = path.join(archiveDir, 'summary.json');
        fs.writeFileSync(jsonDest, JSON.stringify(summaryData, null, 2), 'utf-8');
        archivedFiles.push(path.relative(repoRoot, jsonDest).replace(/\\/g, '/'));
      } catch {
        // Non-blocking parse error
      }
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
      files: archivedFiles,
    };
    const metaDest = path.join(archiveDir, 'metadata.json');
    fs.writeFileSync(metaDest, JSON.stringify(metadata, null, 2), 'utf-8');
    archivedFiles.push(path.relative(repoRoot, metaDest).replace(/\\/g, '/'));

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

    return {
      status: 'success',
      archivePath,
      archivedFiles,
      message: `Report archived to ${archivePath} (${archivedFiles.length} item(s)).`,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error archiving report';
    return { status: 'error', message };
  }
}
