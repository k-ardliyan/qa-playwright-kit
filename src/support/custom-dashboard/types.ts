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
  /** Attempt identity keeps evidence distinct when retries reuse filenames. */
  attempt?: number;
  retry?: number;
}

export interface CollectedError {
  message: string;
  stack?: string;
}

export interface CollectedStep {
  title: string;
  status: StepStatus;
  duration: number;
  errorMessage?: string;
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
  /** True when expected/actual metadata was not supplied by the test. */
  metadataIncomplete?: boolean;
  // === Table view metadata ===
  testId: string;
  scenarioId: string;
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
  title: string;
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
