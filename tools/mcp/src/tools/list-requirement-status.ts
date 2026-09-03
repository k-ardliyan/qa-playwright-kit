/**
 * list_requirement_status — coverage map requirements → plan → tests → manual.
 *
 * Helps QA answer: which features have a plan, generated specs, and manual gaps.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { getRepoRoot, isPipelineRequirementRelativePath } from '../utils/safety';
import { mcpWorkspace } from '../utils/workspace-paths';

export interface CoverageStateBreakdown {
  design: 'planned' | 'unplanned';
  automation: 'automated' | 'manual' | 'mixed' | 'unautomated';
  execution: 'executed' | 'not-executed';
  verification: 'passed' | 'failed' | 'healed' | 'unverified';
}

export interface RequirementStatusRow {
  requirementPath: string;
  module: string;
  feature: string;
  planPath: string | null;
  hasPlan: boolean;
  testPaths: string[];
  hasTests: boolean;
  manualCount: number;
  lastStatus: string | null;
  coverageState: CoverageStateBreakdown;
}

export interface FeatureSummary {
  total: number;
  withPlan: number;
  withTests: number;
}

/** Opsi B: module contains nested features. */
export interface ModuleSummary {
  total: number;
  withPlan: number;
  withTests: number;
  features: Record<string, FeatureSummary>;
}

export interface ListRequirementStatusOutput {
  status: 'success' | 'error';
  requirements: RequirementStatusRow[];
  /** Aggregated counts per module. */
  byModule: Record<string, ModuleSummary>;
  message: string;
}

/**
 * Resolve module for a requirement file.
 * Priority: explicit `- **Module:** <name>` field → parent subfolder → 'general'.
 */
function resolveModuleFromRequirement(filePath: string): string {
  const repoRoot = getRepoRoot();
  try {
    const md = fs.readFileSync(path.join(repoRoot, filePath), 'utf-8');
    const explicit = md.match(/^\s*-\s+\*\*Module:\*\*\s*(.+)$/im);
    if (explicit) {
      const val = explicit[1]
        .trim()
        .toLowerCase()
        .replace(/[.,;]+$/, '');
      if (val.length > 0) return val;
    }
  } catch {
    // non-fatal
  }
  // Subfolder: requirements/<folder>/file.md → folder
  const normalized = filePath.replace(/\\/g, '/');
  const match = normalized.match(/^requirements\/([^/]+)\/.+\.md$/i);
  if (match) {
    const folder = match[1].toLowerCase();
    if (!folder.startsWith('_') && folder !== 'readme') return folder;
  }
  return '-';
}

/**
 * Resolve feature for a requirement file.
 * Priority: explicit `- **Feature:** <name>` field → filename stem → 'general'.
 */
function resolveFeatureFromRequirement(filePath: string): string {
  const repoRoot = getRepoRoot();
  try {
    const md = fs.readFileSync(path.join(repoRoot, filePath), 'utf-8');
    const explicit = md.match(/^\s*-\s+\*\*Feature:\*\*\s*(.+)$/im);
    if (explicit) {
      const val = explicit[1]
        .trim()
        .toLowerCase()
        .replace(/[.,;]+$/, '')
        .replace(/\s+/g, '-');
      if (val.length > 0) return val;
    }
  } catch {
    // non-fatal
  }
  // Filename stem: requirements/auth/login.md → 'login'
  const normalized = filePath.replace(/\\/g, '/');
  const filename = normalized.split('/').pop() ?? '';
  const stem = filename.replace(/\.md$/i, '').toLowerCase().replace(/\s+/g, '-');
  if (stem.length > 0 && !stem.startsWith('_') && stem !== 'readme') return stem;
  return '-';
}

function listFilesRecursive(dirPath: string, extension: string): string[] {
  if (!fs.existsSync(dirPath)) return [];
  const repoRoot = getRepoRoot();
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && full.endsWith(extension)) {
        files.push(path.relative(repoRoot, full).replace(/\\/g, '/'));
      }
    }
  };
  walk(dirPath);
  return files.sort((a, b) => a.localeCompare(b));
}

/** requirements/auth/login.md → auth/login (handles both / and \ separators) */
function requirementStem(reqRel: string): string {
  return reqRel
    .replace(/\\/g, '/') // normalise backslash first
    .replace(/^requirements\//, '')
    .replace(/\.md$/i, '');
}

function expectedPlanPath(stem: string): string {
  return `specs/${stem}-test-plan.md`;
}

function countManualScenarios(markdown: string): number {
  const matches = markdown.match(/^###\s+.+\(@manual\)/gim);
  return matches?.length ?? 0;
}

function loadLastStatusByFile(): Map<string, string> {
  const map = new Map<string, string>();
  const canonicalPath = path.join(mcpWorkspace.reportsDir, 'test-summary.json');
  const summaryPath = fs.existsSync(canonicalPath) ? canonicalPath : null;
  if (!summaryPath) return map;
  try {
    const raw = JSON.parse(fs.readFileSync(summaryPath, 'utf-8')) as {
      testCases?: Array<{ title?: string; status?: string; filePath?: string }>;
    };
    for (const tc of raw.testCases ?? []) {
      const file = (tc.filePath ?? '').replace(/\\/g, '/');
      if (!file || !tc.status) continue;
      // Prefer worst status if multiple cases per file
      const prev = map.get(file);
      if (!prev || prev === 'passed' || tc.status === 'failed' || tc.status === 'timedOut') {
        map.set(file, tc.status);
      }
    }
  } catch {
    // ignore corrupt summary
  }
  return map;
}

function lastStatusForTests(testPaths: string[], statusByFile: Map<string, string>): string | null {
  if (testPaths.length === 0) return null;
  const statuses = testPaths.map((p) => statusByFile.get(p)).filter(Boolean) as string[];
  if (statuses.length === 0) return null;
  if (statuses.some((s) => s === 'failed' || s === 'timedOut' || s === 'interrupted')) {
    return 'failed';
  }
  if (statuses.every((s) => s === 'passed')) return 'passed';
  if (statuses.some((s) => s === 'skipped')) return 'skipped';
  return statuses[0] ?? null;
}

export function listRequirementStatus(): ListRequirementStatusOutput {
  const allReq = listFilesRecursive(mcpWorkspace.requirementsDir, '.md').filter((r) =>
    isPipelineRequirementRelativePath(r),
  );
  const allSpecs = new Set(listFilesRecursive(mcpWorkspace.specsDir, '.md'));
  const allTests = listFilesRecursive(mcpWorkspace.testsDir, '.spec.ts');
  const statusByFile = loadLastStatusByFile();

  const rows: RequirementStatusRow[] = allReq.map((requirementPath) => {
    const stem = requirementStem(requirementPath);
    const planCandidates = [expectedPlanPath(stem)];
    const planPath = planCandidates.find((p) => allSpecs.has(p)) ?? null;
    const hasPlan = planPath !== null;
    const baseName = path.posix.basename(stem);
    const dir = path.posix.dirname(stem);
    const testPaths = allTests.filter((t) => {
      const rel = t.replace(/^(tests)\//, '').replace(/\.spec\.ts$/, '');
      // Mirror: requirements/auth/foo → tests/auth/foo*.spec.ts
      if (dir === '.') {
        return rel === baseName || rel.startsWith(`${baseName}-`);
      }
      return (
        rel === stem ||
        rel.startsWith(`${stem}-`) ||
        rel.startsWith(`${dir}/${baseName}-`) ||
        rel === baseName ||
        rel.startsWith(`${baseName}-`)
      );
    });

    let manualCount = 0;
    try {
      const md = fs.readFileSync(path.join(mcpWorkspace.rootDir, requirementPath), 'utf-8');
      manualCount = countManualScenarios(md);
    } catch {
      // ignore
    }

    const module = resolveModuleFromRequirement(requirementPath);
    const feature = resolveFeatureFromRequirement(requirementPath);
    const hasTests = testPaths.length > 0;
    const lastStatus = lastStatusForTests(testPaths, statusByFile);

    const design: 'planned' | 'unplanned' = hasPlan ? 'planned' : 'unplanned';
    const automation: 'automated' | 'manual' | 'mixed' | 'unautomated' =
      hasTests && manualCount > 0
        ? 'mixed'
        : hasTests
          ? 'automated'
          : manualCount > 0
            ? 'manual'
            : 'unautomated';
    const execution: 'executed' | 'not-executed' =
      lastStatus !== null ? 'executed' : 'not-executed';
    const verification: 'passed' | 'failed' | 'healed' | 'unverified' =
      lastStatus === 'passed'
        ? 'passed'
        : lastStatus === 'failed'
          ? 'failed'
          : lastStatus === 'healed'
            ? 'healed'
            : 'unverified';

    return {
      requirementPath,
      module,
      feature,
      planPath,
      hasPlan,
      testPaths,
      hasTests,
      manualCount,
      lastStatus,
      coverageState: {
        design,
        automation,
        execution,
        verification,
      },
    };
  });

  const planned = rows.filter((r) => r.hasPlan).length;
  const tested = rows.filter((r) => r.hasTests).length;

  // Build byModule aggregation (Opsi B: nested features)
  const byModule: Record<string, ModuleSummary> = {};
  for (const row of rows) {
    const m = row.module;
    const f = row.feature;
    if (!byModule[m]) byModule[m] = { total: 0, withPlan: 0, withTests: 0, features: {} };
    byModule[m].total += 1;
    if (row.hasPlan) byModule[m].withPlan += 1;
    if (row.hasTests) byModule[m].withTests += 1;
    if (!byModule[m].features[f]) byModule[m].features[f] = { total: 0, withPlan: 0, withTests: 0 };
    byModule[m].features[f].total += 1;
    if (row.hasPlan) byModule[m].features[f].withPlan += 1;
    if (row.hasTests) byModule[m].features[f].withTests += 1;
  }

  return {
    status: 'success',
    requirements: rows,
    byModule,
    message: `${rows.length} requirement(s): ${planned} with plan, ${tested} with tests. Modules: ${Object.keys(byModule).join(', ') || 'none'}.`,
  };
}
