import type { TestResult } from '@playwright/test/reporter';

export type ReportStatus = TestResult['status'] | 'healed' | 'not-generated';

export type TestScope = 'demo' | 'fixture' | 'unscoped';

export type StepStatus = 'passed' | 'failed';

export type AttachmentKind = 'screenshot' | 'video' | 'trace' | 'other';

export type Priority = 'high' | 'medium' | 'low';

export type AffectedLayer = 'FE' | 'BE' | 'DB' | 'API';

export type ReportMode = 'general' | 'role-aware';

/** Shared result counts used by role and module breakdowns. */
export interface ResultBreakdown {
  passing: number;
  failing: number;
  skipped: number;
}

/** Module breakdown keeps feature-level counts for existing consumers. */
export interface ModuleBreakdown extends ResultBreakdown {
  features: Record<string, ResultBreakdown>;
}

/** Suggested or annotated root cause class for QA exit decisions. */
export type FailureSource = 'app' | 'test' | 'requirement' | 'env' | 'ai_generation' | 'unknown';

export interface CollectedAttachment {
  name: string;
  contentType?: string;
  relativePath: string;
  kind: AttachmentKind;
  /** Byte size on disk — evidence weight is a QA signal. */
  size?: number;
  /** Inline text head for text-ish attachments (JSON/log/network captures). */
  preview?: string;
  /** True when the preview was cut at the cap and is not the whole file. */
  previewTruncated?: boolean;
  /** Attempt identity keeps evidence distinct when retries reuse filenames. */
  attempt?: number;
  retry?: number;
}

export interface CollectedError {
  message: string;
  stack?: string;
  errorContext?: string;
}

/** Source location of a step in its spec/fixture file (1-based). */
export interface StepLocation {
  /** Workspace-relative path with forward slashes. */
  file: string;
  line: number;
  column: number;
}

/** A short source window around a step's location, for the code peek. */
export interface StepSnippet {
  /** 1-based line number of the first entry in `lines`. */
  startLine: number;
  /** 1-based line the step executed on; always inside the window. */
  highlightLine: number;
  lines: string[];
}

export interface CollectedStep {
  title: string;
  status: StepStatus;
  duration: number;
  errorMessage?: string;
  subtitle?: string;
  params?: Record<string, unknown>;
  /** Where the step is defined in source, when Playwright reports it. */
  location?: StepLocation;
  /** Source window around `location`, baked by the reporter. */
  snippet?: StepSnippet;
  steps: CollectedStep[];
}

export interface CollectedTestData {
  /** Stable Playwright logical test key; attempts for this key are aggregated. */
  logicalKey?: string;
  title: string;
  fullTitle: string;
  filePath: string;
  status: ReportStatus;
  duration: number;
  errorMessage: string;
  errors: CollectedError[];
  steps: CollectedStep[];
  attachments: CollectedAttachment[];
  /** Number of completed retries for this logical test. */
  retry: number;
  /** Number of Playwright attempts represented by this logical test. */
  attempts?: number;
  /** Playwright worker that ran the test (parity with the built-in report). */
  workerIndex?: number;
  /** True when expected/actual metadata was not supplied by the test. */
  metadataIncomplete?: boolean;
  // === Table view metadata ===
  testId: string;
  scenarioId: string;
  /** Linked requirement ref for Express Mode. Not the run-level requirementId. */
  reqRef?: string;
  /** Execution track ('strict' | 'express'). */
  track?: 'strict' | 'express';
  role: string;
  /** Module this test belongs to — from requirement metadata or folder. */
  module: string;
  /** Feature within the module — from requirement metadata or filename. */
  feature: string;
  priority: Priority;
  inputData: Record<string, string>;
  expectedResult: string;
  actualResult: string;
  affectedLayer: AffectedLayer[];
  /** Present on unhealthy tests; optional on passed/skipped. */
  failureSource?: FailureSource;
  /** QA free-text note for this row — merged from the test-notes sidecar. */
  qaNotes?: string;
  /** AI note for this row — agent narrative + deterministic auto analysis. */
  aiNotes?: string;
  /** Mirror of flat summary metadata — useful for evidence fallback. */
  attachmentCount?: number;
  hasTrace?: boolean;
}

/**
 * Flat record per test case — stored in test-summary.json and exposed
 * via the get_test_summary MCP tool for the Reporter Agent.
 */
export interface CollectedTestCase {
  /** Stable Playwright logical test key; attempts for this key are aggregated. */
  logicalKey?: string;
  testId: string;
  scenarioId: string;
  /** Linked requirement ref for Express Mode. Not the run-level requirementId. */
  reqRef?: string;
  /** Execution track ('strict' | 'express'). */
  track?: 'strict' | 'express';
  title: string;
  /** Spec file that produced this row — dashboard scope badge + evidence drill-down (serve mode). */
  filePath?: string;
  role: string;
  /** Module this test belongs to — from requirement metadata or folder. */
  module: string;
  /** Feature within the module — from requirement metadata or filename. */
  feature: string;
  status: string;
  priority: Priority;
  duration: number;
  inputData: Record<string, string>;
  expectedResult: string;
  actualResult: string;
  affectedLayer: AffectedLayer[];
  attachmentCount: number;
  hasTrace: boolean;
  failureSource?: FailureSource;
  /** QA free-text note for this row — merged from the test-notes sidecar. */
  qaNotes?: string;
  /** AI note for this row — agent narrative + deterministic auto analysis. */
  aiNotes?: string;
  /** Richer runtime data for detail inspection (accordion/exports). Optional — populated
   *  by the custom reporter so the dashboard can render error/step/evidence. */
  errorMessage?: string;
  errors?: CollectedError[];
  steps?: CollectedStep[];
  attachments?: CollectedAttachment[];
  /** Number of completed retries for this logical test. */
  retry?: number;
  /** Number of Playwright attempts represented by this logical test. */
  attempts?: number;
  /** Playwright worker that ran the test (parity with the built-in report). */
  workerIndex?: number;
  /** True when expected/actual metadata was not supplied by the test. */
  metadataIncomplete?: boolean;
}

/**
 * Groups CollectedTestData by role for role-aware table rendering.
 */
export interface RoleGroup {
  role: string;
  tests: CollectedTestData[];
}

/** Safe run context — never embed secrets. */
export interface RunMeta {
  appEnv: string;
  runId?: string;
  requirementPath?: string;
  ci: boolean;
  totalDurationMs: number;
  generatedAt: string;
}

export interface TestSummary {
  /** Run identity duplicated from runMeta for consumers that read flat summary fields. */
  runId?: string;
  /** Source requirement duplicated from runMeta for archive/provenance consumers. */
  requirementPath?: string;
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  passRate: number;
  timestamp: string;
  // === Role-aware extensions ===
  reportMode: ReportMode;
  rolesInScope: string[];
  testCases: CollectedTestCase[];
  /** Explicit breakdowns built from the same logical test cases as totals. */
  summaryByRole?: Record<string, ResultBreakdown>;
  summaryByModule?: Record<string, ModuleBreakdown>;
  /** Deterministic cross-scenario AI insights (baked by the reporter onEnd). */
  aiInsights?: string[];
  /** Canonical archive/Analyze verdict persisted by archive paths. */
  analysisVerdict?: string;
  analysisVerified?: boolean;
  analysisIssues?: string[];
  runMeta: RunMeta;
}

export interface ExecutionReportOptions {
  /** Whether a latest test run exists (for Save to History action). */
  hasLatestRun?: boolean;
  /** Whether the latest run has already been archived by QA. */
  latestRunArchived?: boolean;
  /** When true, served via dashboard-server.ts (localhost API mode). */
  serveMode?: boolean;
}

export interface GlobalDashboardOptions {
  /** When true, served via dashboard-server.ts. */
  serveMode?: boolean;
}
