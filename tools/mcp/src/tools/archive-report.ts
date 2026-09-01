import * as fs from 'node:fs';
import * as path from 'node:path';
import { getRepoRoot } from '../utils/safety';
import { mcpWorkspace } from '../utils/workspace-paths';

export interface ArchiveReportInput {
  runId: string;
  reportPath: string;
  jsonReportPath?: string;
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
 * Safe to call multiple times — overwrites if already exists.
 */
export function archiveReport(input: ArchiveReportInput): ArchiveReportOutput {
  const { runId, reportPath, jsonReportPath } = input;

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

  // Resolve and validate report path — must be inside repo
  const absoluteReportPath = path.resolve(repoRoot, reportPath);
  if (!absoluteReportPath.startsWith(repoRoot)) {
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

  try {
    fs.mkdirSync(archiveDir, { recursive: true });

    const archivedFiles: string[] = [];

    // 1. Copy Markdown report
    const mdDest = path.join(archiveDir, path.basename(absoluteReportPath));
    fs.copyFileSync(absoluteReportPath, mdDest);
    archivedFiles.push(path.relative(repoRoot, mdDest).replace(/\\/g, '/'));

    // 2. Resolve summary.json (from jsonReportPath or default artifacts/reports/test-summary.json)
    let summaryData: Record<string, unknown> = {};
    let resolvedJsonPath: string | null = null;

    if (jsonReportPath) {
      const candidate = path.resolve(repoRoot, jsonReportPath);
      if (candidate.startsWith(repoRoot) && fs.existsSync(candidate)) {
        resolvedJsonPath = candidate;
      }
    }

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
      qaDecision: 'APPROVE',
      qaNotes: 'Archived automatically by pipeline Reporter agent.',
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
