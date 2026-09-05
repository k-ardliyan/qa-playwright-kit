/**
 * Core type definitions for the Framework Robustness Improvement.
 *
 * This file contains all shared interfaces used across the robustness
 * improvement components: Planner, Generator, Healer, Executor, and Observability.
 *
 * NOTE: This is a minimal stub providing types required by schema files.
 * Task 1.1 will expand this with the full set of interfaces.
 */

// ─── Planner Types ────────────────────────────────────────────────────────────

export interface AmbiguityReport {
  /** The path of the requirement that was analyzed */
  requirementPath: string;
  /** List of detected ambiguities */
  ambiguities: AmbiguityItem[];
  /** Confidence score between 0.0 and 1.0 */
  confidence: number;
  /** Suggested interpretations/actions for each ambiguity */
  suggestedInterpretations: string[];
}

export interface AmbiguityItem {
  /** Section where the ambiguity was found */
  section: string;
  /** The ambiguous text */
  text: string;
  /** Classification of the ambiguity reason */
  reason: 'vague_assertion' | 'missing_precondition' | 'undefined_term' | 'conflicting_steps';
  /** Actionable suggestion to resolve the ambiguity */
  suggestion: string;
}

// ─── Browser & Execution Types ────────────────────────────────────────────────

export type BrowserTarget = 'chromium' | 'firefox' | 'webkit';

// ─── Failure Classification ────────────────────────────────────────────────────

/**
 * Categorization of generation errors into retryable and non-retryable types.
 * Used by the retry engine to determine appropriate recovery strategy.
 */
export type FailureClassification =
  | 'transient_network' // retryable
  | 'selector_not_found' // retryable with catalog refresh
  | 'app_unavailable' // retryable after delay
  | 'auth_required' // non-retryable, needs config
  | 'structural_error' // non-retryable, plan issue
  | 'timeout'; // retryable with extended timeout

// ─── Generator Types ──────────────────────────────────────────────────────────

export interface GenerationOptions {
  /** Maximum retries per scenario (default: 2) */
  maxRetriesPerScenario: number;
  /** Base delay between retries in milliseconds (default: 1000) */
  retryDelayMs: number;
  /** Whether to generate skeleton test on all retries exhausted (default: true) */
  fallbackToSkeleton: boolean;
  /** Whether to continue processing remaining scenarios on failure (default: true) */
  continueOnFailure: boolean;
  /** Whether selector catalog is required for generation (default: false) */
  selectorCatalogRequired: boolean;
  /** Timeout for live verification in milliseconds (default: 30000) */
  liveVerificationTimeout: number;
}

export interface GeneratedScenario {
  /** Unique identifier for the scenario */
  scenarioId: string;
  /** Path to the generated test file */
  filePath: string;
  /** Whether live verification passed */
  verified: boolean;
  /** Method used for verification */
  verificationMethod: 'cli' | 'mcp' | 'skeleton' | 'none';
}

export interface SkippedScenario {
  /** Unique identifier for the scenario */
  scenarioId: string;
  /** Human-readable reason why the scenario was skipped */
  reason: string;
  /** Failure classification category */
  classification: FailureClassification;
  /** Whether this scenario can be retried later */
  canRetryLater: boolean;
}

export interface RetriedScenario {
  /** Unique identifier for the scenario */
  scenarioId: string;
  /** The attempt number (1-based) */
  attempt: number;
  /** Error message from the failed attempt */
  error: string;
}

export interface GenerationMetrics {
  /** Total number of scenarios in the plan */
  totalScenarios: number;
  /** Number of successfully generated scenarios */
  generatedCount: number;
  /** Number of skipped scenarios */
  skippedCount: number;
  /** Number of retried attempts across all scenarios */
  retriedCount: number;
  /** Average generation time per scenario in milliseconds */
  averageGenerationTimeMs: number;
  /** Rate of successful verifications among generated scenarios (0.0–1.0) */
  verificationSuccessRate: number;
}

export interface PartialGenerationResult {
  /** Overall generation status */
  status: 'complete' | 'partial' | 'failed';
  /** Successfully generated scenarios */
  generated: GeneratedScenario[];
  /** Scenarios that could not be generated */
  skipped: SkippedScenario[];
  /** Scenarios that were retried (informational) */
  retried: RetriedScenario[];
  /** Aggregate metrics for the generation run */
  metrics: GenerationMetrics;
}

// ─── Healer Types ─────────────────────────────────────────────────────────────

export interface FailureSignature {
  /** Error category: timeout, locator, assertion, state */
  errorType: string;
  /** Regex-escaped key part of error message */
  errorPattern: string;
  /** Locator strategy used: getByRole, getByTestId, css */
  selectorType?: string;
  /** URL pattern where failure occurs */
  pageContext?: string;
}

export interface FixTemplate {
  /** Fix strategy to apply */
  strategy: 'replace_locator' | 'add_wait' | 'add_retry' | 'change_assertion' | 'add_state_setup';
  /** Code pattern to match in the source */
  beforePattern: string;
  /** Replacement template with {{placeholders}} */
  afterTemplate: string;
  /** Additional imports required for the fix */
  requiredImports?: string[];
}

// ─── Observability Types ───────────────────────────────────────────────────────

export type ErrorCategory =
  'infrastructure' | 'configuration' | 'application' | 'test_logic' | 'transient';

export type ErrorSeverity = 'critical' | 'high' | 'medium' | 'low';

export interface ClassifiedError {
  category: ErrorCategory;
  severity: ErrorSeverity;
  retryable: boolean;
  message: string;
  originalError: unknown;
  suggestedAction: string;
}

// ─── Plan Validation Types ──────────────────────────────────────────────────

export interface PlanValidationResult {
  /** Overall validation status */
  status: 'valid' | 'warnings' | 'invalid';
  /** Number of scenarios in the plan */
  scenarioCount: number;
  /** List of validation issues found */
  issues: PlanValidationIssue[];
  /** Acceptance criteria not covered by any scenario */
  coverageGaps: string[];
}

export interface PlanValidationIssue {
  /** ID of the scenario with the issue */
  scenarioId: string;
  /** Severity level: error blocks execution, warning is informational */
  severity: 'error' | 'warning';
  /** Rule identifier for the issue */
  rule: string;
  /** Human-readable description of the issue */
  message: string;
  /** Whether the issue can be automatically fixed */
  autoFixable: boolean;
}

// ─── Healer Prioritization Types ───────────────────────────────────────────────

/**
 * Root cause category for healer failure analysis.
 * Ordered by healability: locator (most healable) → product_bug (least healable).
 */
export type RootCauseCategory =
  'locator' | 'timing' | 'data_state' | 'network' | 'auth' | 'product_bug';

/**
 * A test failure consumed by healer, executor, and other agents.
 *
 * Core fields (testTitle, filePath, errorMessage) are always present.
 * Extended fields (duration, rootCause) are set when the healer performs
 * root-cause analysis for prioritization.
 */
export interface TestFailure {
  /** Title of the failing test */
  testTitle: string;
  /** Path to the test file */
  filePath: string;
  /** Error message from the failure */
  errorMessage: string;
  /** Duration of the test run in milliseconds */
  duration?: number;
  /** Root cause category for healability ranking */
  rootCause?: RootCauseCategory;
  /** Browser target where the failure occurred (set by executor) */
  browser?: BrowserTarget;
  /** Optional line number of the failure */
  lineNumber?: number;
  /** Optional stack trace */
  stackTrace?: string;
  /** Optional path to the trace file */
  tracePath?: string;
  /** Optional path to the screenshot */
  screenshotPath?: string;
  /** Optional diagnostic error context (e.g. receiver ARIA snapshot from Playwright v1.60+) */
  errorContext?: string;
}

/**
 * A failure with an assigned priority and metadata about the prioritization decision.
 */
export interface PrioritizedFailure {
  /** The original failure */
  failure: TestFailure;
  /** Priority rank: 1 = highest priority, N = lowest */
  priority: number;
  /** Human-readable reason for the priority assignment */
  reason: string;
  /** Estimated time to fix */
  estimatedFixTime: 'fast' | 'medium' | 'slow';
  /** Known pattern match, or null if no match found */
  knownPattern: HealPattern | null;
}

/**
 * Root cause analysis result from the healer diagnostic system.
 */
export interface RootCauseAnalysis {
  /** Root cause category */
  category: RootCauseCategory;
  /** Confidence in the analysis (0.0–1.0) */
  confidence: number;
  /** Evidence supporting the diagnosis */
  evidence: string[];
  /** Suggested fix strategy */
  suggestedFix: string;
  /** Whether this can be auto-healed */
  canAutoHeal: boolean;
}

// ─── Healer Types (continued) ──────────────────────────────────────────────────

export interface HealPattern {
  /** Unique identifier (UUID v4) */
  id: string;
  /** Failure signature used for pattern matching */
  signature: FailureSignature;
  /** Fix template to apply when matched */
  fix: FixTemplate;
  /** Confidence score (0.0–1.0) based on success/failure ratio */
  confidence: number;
  /** Number of times this pattern was applied successfully */
  successCount: number;
  /** Number of times this pattern was applied unsuccessfully */
  failureCount: number;
  /** ISO 8601 timestamp of pattern creation */
  createdAt: string;
  /** ISO 8601 timestamp of last successful application */
  lastApplied: string;
  /** ISO 8601 timestamp: auto-expires after 30 days of inactivity */
  expiresAt: string;
  /** Categorization tags (e.g., 'locator-drift', 'timing', 'state') */
  tags: string[];
  /** Metadata about pattern origin */
  metadata: {
    createdBy: 'healer' | 'manual';
    sourceFile?: string;
    originalError?: string;
  };
}

// ─── Pipeline Observability Types ──────────────────────────────────────────────

export interface PipelineEvent {
  /** ISO 8601 timestamp of the event */
  timestamp: string;
  /** Pipeline stage that emitted the event */
  stage: 'planner' | 'generator' | 'executor' | 'healer' | 'reporter';
  /** Type of event */
  type: 'start' | 'complete' | 'error' | 'retry' | 'skip';
  /** Additional event details */
  details: Record<string, unknown>;
  /** Duration in milliseconds (for complete/error events) */
  duration?: number;
}

export interface MetricPoint {
  /** Metric name (e.g., 'stage.duration', 'test.passRate') */
  name: string;
  /** Metric value */
  value: number;
  /** Unit of measurement */
  unit: 'ms' | 'count' | 'percent' | 'bytes';
  /** Key-value labels for metric dimensions */
  labels: Record<string, string>;
  /** ISO 8601 timestamp */
  timestamp: string;
}

export interface AgentHealthMetric {
  /** Agent success rate as percentage (0–100) */
  successRate: number;
  /** Average duration in milliseconds */
  averageDuration: number;
  /** Last error encountered */
  lastError?: ClassifiedError;
  /** ISO 8601 timestamp of last successful run */
  lastSuccessfulRun: string;
}

export interface HealthDashboard {
  /** Overall pipeline success rate (0–100) */
  pipelineSuccessRate: number;
  /** Average pipeline duration in milliseconds */
  averagePipelineDuration: number;
  /** Per-agent health metrics */
  agentHealth: Record<string, AgentHealthMetric>;
  /** Recent classified errors */
  recentFailures: ClassifiedError[];
  /** Trend data: run count, pass rate, duration for recent windows */
  trends: {
    last7Days: { runCount: number; averagePassRate: number; averageDuration: number };
    last30Days: { runCount: number; averagePassRate: number; averageDuration: number };
  };
}

// ─── Executor / Sharding Types ─────────────────────────────────────────────────

export interface ShardConfig {
  /** Total number of shards to distribute files across */
  totalShards: number;
  /** Strategy for distributing test files across shards */
  strategy: 'round-robin' | 'by-file' | 'by-duration';
  /** Maximum number of test files per shard (overflow creates additional shards) */
  maxTestsPerShard?: number;
}

export interface TestShard {
  /** Zero-based index of this shard */
  shardIndex: number;
  /** Total number of shards in the output */
  totalShards: number;
  /** Test file paths assigned to this shard */
  testFiles: string[];
  /** Estimated total duration in milliseconds (set for by-duration strategy) */
  estimatedDuration?: number;
}

// ─── Multi-Browser Executor Types ──────────────────────────────────────────────

/** Result entry for a single test in a shard execution */
export interface TestResultEntry {
  /** Test title or identifier */
  testTitle: string;
  /** File path where the test is defined */
  filePath: string;
  /** Whether the test passed */
  passed: boolean;
  /** Whether the test was skipped */
  skipped: boolean;
  /** Duration of the test run in milliseconds */
  duration: number;
  /** Error message if the test failed */
  errorMessage?: string;
}

/** Result from executing a single shard on a single browser */
export interface ShardResult {
  /** Zero-based shard index */
  shardIndex: number;
  /** Browser this shard was executed on */
  browser: BrowserTarget;
  /** Number of tests that passed */
  passed: number;
  /** Number of tests that failed */
  failed: number;
  /** Duration of the shard execution in milliseconds */
  duration: number;
  /** Individual test results within this shard */
  testResults: TestResultEntry[];
}

/** Aggregated result for a single browser across all shards */
export interface BrowserResult {
  /** Browser target */
  browser: BrowserTarget;
  /** Total passed tests */
  passed: number;
  /** Total failed tests */
  failed: number;
  /** Total skipped tests */
  skipped: number;
  /** List of test failures for this browser */
  failures: TestFailure[];
  /** Issues that only occur on this specific browser */
  browserSpecificIssues: string[];
}

/** Options for building a browser matrix */
export interface BrowserMatrixOptions {
  /** Which browsers to include */
  browsers: BrowserTarget[];
  /** Environments to test against */
  environments?: string[];
  /** Viewport configurations */
  viewports?: ViewportConfig[];
  /** Number of shards (auto-calculated if not provided) */
  shardCount?: number;
  /** Maximum parallel browser executions (default: 3) */
  maxParallelBrowsers?: number;
}

/** Viewport configuration */
export interface ViewportConfig {
  /** Width in pixels */
  width: number;
  /** Height in pixels */
  height: number;
  /** Label for the viewport */
  label?: string;
}

/** Browser matrix configuration */
export interface BrowserMatrix {
  /** Browsers to execute on */
  browsers: BrowserTarget[];
  /** Environments to test against */
  environments: string[];
  /** Maximum parallel browser executions */
  maxParallelBrowsers: number;
}

/** Full result of a matrix execution (browsers × shards) */
export interface MatrixExecutionResult {
  /** Overall execution status */
  status: 'success' | 'partial_failure' | 'failure';
  /** Per-browser aggregated results */
  browserResults: Map<BrowserTarget, BrowserResult>;
  /** Total execution duration in milliseconds */
  totalDuration: number;
  /** Raw shard results from all browser/shard combinations */
  shardResults: ShardResult[];
}

/** A cross-browser failure where a test fails on some browsers but passes on others */
export interface CrossBrowserFailure {
  /** Test title that exhibits cross-browser inconsistency */
  testTitle: string;
  /** Browsers on which the test failed */
  failedOn: BrowserTarget[];
  /** Browsers on which the test passed */
  passedOn: BrowserTarget[];
  /** Whether this is likely a browser-specific bug (fails on exactly one) */
  likelyBrowserBug: boolean;
}

/** Merged execution result combining all browser/shard results */
export interface MergedExecutionResult {
  /** Summary of execution across all browsers */
  summary: ExecutionSummary;
  /** Tests that fail on some browsers but pass on others (not all) */
  crossBrowserFailures: CrossBrowserFailure[];
  /** Tests that fail on exactly one browser — mapped by browser */
  browserSpecificFailures: Map<BrowserTarget, TestFailure[]>;
  /** Tests that fail on ALL browsers in the matrix */
  universalFailures: TestFailure[];
}

/** Summary of execution across all browsers */
export interface ExecutionSummary {
  /** Total tests executed */
  totalTests: number;
  /** Total passed */
  totalPassed: number;
  /** Total failed */
  totalFailed: number;
  /** Total skipped */
  totalSkipped: number;
  /** Browsers that were executed */
  browsersExecuted: BrowserTarget[];
  /** Browsers that failed to launch */
  browsersUnavailable: BrowserTarget[];
  /** Total duration */
  totalDuration: number;
}
