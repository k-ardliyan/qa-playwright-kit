/**
 * Single source of truth for all MCP tools exposed by `qa-playwright-kit`.
 *
 * `dispatchTool` (MCP boundary), the HTTP router in `index.ts`, and the
 * `MCP_TOOL_DEFINITIONS` list all derive from this registry. Adding a tool
 * is a single edit here; no other place needs to be kept in sync.
 */

import { healthCheck } from './health-check';
import { getTestFailures } from './get-test-failures';
import { getTestSummary } from './get-test-summary';
import { listArtifacts } from './list-artifacts';
import { normalizeRequirements } from './normalize-requirements';
import { parseRequirementScenarios } from './parse-requirement-scenarios';
import { validateGeneratedTests } from './validate-generated-tests';
import { validateRequirement } from './validate-requirement';
import { discoverPages } from './discover-pages';
import { snapshotPage } from './snapshot-page';
import { archiveReport } from './archive-report';
import { generatePageObject } from './generate-page-object';
import { inspectFile } from './inspect-file';
import { extractPdfTextTool } from './extract-pdf-text';
import { readExcelSummaryTool } from './read-excel-summary';
import { listTestFixtures } from './list-test-fixtures';
import { listRequirementStatus } from './list-requirement-status';
import { compileRequirement } from './compile-requirement';
import { compileTestPlan } from './compile-test-plan';
import { validatePlan } from './validate-plan';
import { traceRequirement } from './trace-requirement';
import { synthesizeRequirement } from './synthesize-requirement';
import { pipelineStatus } from './pipeline-status';
import { resolveAllowedPath } from '../utils/safety';

export interface JsonSchemaObject {
  type: 'object';
  properties: Record<string, unknown>;
  required?: string[];
}

export type ToolStability = 'stable' | 'experimental' | 'deprecated' | 'compat';

export type ToolProfile =
  | 'planner'
  | 'generator'
  | 'healer'
  | 'reporter'
  | 'discovery'
  | 'admin'
  | 'author'
  | 'debug'
  | 'auth'
  | 'visual'
  | 'artifact'
  | 'minimal'
  | 'all';

export type IntentProfile = ToolProfile;

export interface ToolEntry {
  name: string;
  description: string;
  inputSchema: JsonSchemaObject;
  /** Returns the raw payload. Wrap errors via `createToolError` or the `status` field. */
  handler: (args: Record<string, unknown> | undefined) => unknown;
  /** Optional override; default checks `payload.status === 'error'`. */
  isError?: (payload: unknown) => boolean;
  /** Profiles where this tool is active. Defaults to all if omitted. */
  profiles?: ToolProfile[];
  stability?: ToolStability;
  replacement?: string;
  readOnly?: boolean;
}

let activeMcpProfileOverride: ToolProfile | undefined;

export function setActiveMcpProfile(profile?: ToolProfile | string): void {
  if (!profile || profile === 'all') {
    activeMcpProfileOverride = undefined;
    return;
  }
  if (!KNOWN_PROFILES.includes(profile as ToolProfile)) {
    throw new Error(
      `[mcp-profile] Invalid profile "${profile}". Allowed profiles: ${KNOWN_PROFILES.join(', ')}`,
    );
  }
  activeMcpProfileOverride = profile as ToolProfile;
}

export function getActiveMcpProfile(): ToolProfile {
  if (activeMcpProfileOverride) {
    return activeMcpProfileOverride;
  }
  const envVal = process.env.MCP_PROFILE?.trim();
  if (!envVal || envVal === 'all') {
    return 'all';
  }
  if (!KNOWN_PROFILES.includes(envVal as ToolProfile)) {
    throw new Error(
      `[mcp-profile] Unknown MCP_PROFILE='${envVal}'. Allowed profiles: ${KNOWN_PROFILES.join(', ')}`,
    );
  }
  return envVal as ToolProfile;
}

export function getToolsForProfile(profile: ToolProfile | string = 'all'): ToolEntry[] {
  if (profile === 'all') return TOOL_REGISTRY;
  if (!KNOWN_PROFILES.includes(profile as ToolProfile)) {
    throw new Error(
      `[mcp-profile] Unknown profile "${profile}". Allowed profiles: ${KNOWN_PROFILES.join(', ')}`,
    );
  }
  return TOOL_REGISTRY.filter((t) => !t.profiles || t.profiles.includes(profile as ToolProfile));
}

export function isToolAllowedForProfile(
  name: string,
  profile: ToolProfile | string = getActiveMcpProfile(),
): boolean {
  if (profile === 'all') return TOOL_MAP.has(name);
  const entry = TOOL_MAP.get(name);
  if (!entry) return false;
  if (!entry.profiles) return true;
  return entry.profiles.includes(profile as ToolProfile);
}

function isStatusError(payload: unknown): boolean {
  if (typeof payload !== 'object' || payload === null) return false;
  const status = (payload as { status?: unknown }).status;
  return status === 'error' || status === 'warning';
}

const GET_TEST_FAILURES_INPUT: JsonSchemaObject = {
  type: 'object',
  properties: {
    resultsDir: {
      type: 'string',
      description:
        'Path to test-results directory (repo-relative or absolute, must stay inside the repo). Defaults to artifacts/test-results/.',
    },
  },
};

const REQUIREMENTS_TEXT_OR_PATH: JsonSchemaObject = {
  type: 'object',
  properties: {
    requirementsText: { type: 'string' },
    requirementPath: {
      type: 'string',
      description:
        'Repo-relative path under requirements/ — top-level requirements/<name>.md or nested requirements/<domain>/<name>.md.',
    },
  },
};

export const TOOL_REGISTRY: ToolEntry[] = [
  {
    name: 'health_check',
    description:
      'Verify Node, Playwright packages, MCP build, environment files, `.auth/{APP_ENV}/` storage state, and test result artifacts before running the agent pipeline.',
    inputSchema: { type: 'object', properties: {} },
    stability: 'stable',
    readOnly: true,
    profiles: ['admin', 'planner', 'all'],
    handler: () => healthCheck(),
  },
  {
    name: 'pipeline_status',
    description:
      'One-call pipeline orientation: reads pipeline-state.json, the last test-summary.json, and .auth/{APP_ENV}/ — reports current phase, resume safety (requirement staleness, missing artifacts), last run pass/fail, and ready auth roles. Call before deciding to resume or start a fresh run.',
    inputSchema: { type: 'object', properties: {} },
    stability: 'stable',
    readOnly: true,
    profiles: ['admin', 'planner', 'reporter', 'author', 'all'],
    handler: () => pipelineStatus(),
  },
  {
    name: 'get_test_failures',
    description:
      "Get Playwright test failures from the caller's resultsDir (or artifacts/test-results/ by default). Includes trace and screenshot paths when available.",
    inputSchema: GET_TEST_FAILURES_INPUT,
    stability: 'stable',
    readOnly: true,
    profiles: ['healer', 'reporter', 'debug', 'all'],
    handler: (args) => {
      const raw = typeof args?.resultsDir === 'string' ? args.resultsDir : undefined;
      if (raw !== undefined) {
        const resolved = resolveAllowedPath(raw, 'test-results', { mustExist: false });
        if (!resolved.ok) {
          return { status: 'error', error: resolved.error };
        }
        return getTestFailures(resolved.absolutePath);
      }
      return getTestFailures();
    },
  },
  {
    name: 'get_test_summary',
    description:
      'Read machine-readable pass/fail summary from artifacts/reports/test-summary.json.',
    inputSchema: { type: 'object', properties: {} },
    stability: 'stable',
    readOnly: true,
    profiles: ['reporter', 'debug', 'all'],
    handler: () => getTestSummary(),
  },
  {
    name: 'list_artifacts',
    description: 'List requirement, spec, and generated test files under allowed project paths.',
    inputSchema: { type: 'object', properties: {} },
    stability: 'stable',
    readOnly: true,
    profiles: ['reporter', 'author', 'debug', 'all'],
    handler: () => listArtifacts(),
  },
  {
    name: 'list_requirement_status',
    description:
      'Coverage map: each pipeline requirement with hasPlan, hasTests, manual scenario count, and last run status from test-summary when available.',
    inputSchema: { type: 'object', properties: {} },
    stability: 'stable',
    readOnly: true,
    profiles: ['planner', 'reporter', 'author', 'all'],
    handler: () => listRequirementStatus(),
  },
  {
    name: 'compile_requirement',
    description:
      'Compile requirement markdown into canonical RequirementContractV1 (qa.requirement/v1) with typed diagnostics, deterministic sourceHash, acceptance criteria, scenarios, actor and access matrix.',
    inputSchema: REQUIREMENTS_TEXT_OR_PATH,
    stability: 'stable',
    readOnly: true,
    profiles: ['planner', 'generator', 'author', 'all'],
    handler: (args) => {
      const requirementsText =
        typeof args?.requirementsText === 'string' ? args.requirementsText : undefined;
      const requirementPath =
        typeof args?.requirementPath === 'string' ? args.requirementPath : undefined;
      return compileRequirement({ requirementsText, requirementPath });
    },
  },
  {
    name: 'normalize_requirements',
    description:
      'Parse requirement markdown into structured contract with acceptance criteria and optional test scenarios.',
    inputSchema: REQUIREMENTS_TEXT_OR_PATH,
    stability: 'compat',
    replacement: 'compile_requirement',
    readOnly: true,
    profiles: ['planner', 'author', 'all'],
    handler: (args) => {
      const requirementsText =
        typeof args?.requirementsText === 'string' ? args.requirementsText : undefined;
      const requirementPath =
        typeof args?.requirementPath === 'string' ? args.requirementPath : undefined;
      return normalizeRequirements({ requirementsText, requirementPath });
    },
  },
  {
    name: 'parse_requirement_scenarios',
    description:
      'Extract ### scenarios with Langkah/Hasil sections from requirement markdown (Indonesian or English).',
    inputSchema: REQUIREMENTS_TEXT_OR_PATH,
    stability: 'compat',
    replacement: 'compile_requirement',
    readOnly: true,
    profiles: ['planner', 'author', 'all'],
    handler: (args) => {
      const requirementsText =
        typeof args?.requirementsText === 'string' ? args.requirementsText : undefined;
      const requirementPath =
        typeof args?.requirementPath === 'string' ? args.requirementPath : undefined;
      return parseRequirementScenarios({ requirementsText, requirementPath });
    },
  },
  {
    name: 'validate_generated_tests',
    description:
      'Validate generated .spec.ts files for base.fixture import, test.describe, and test.step rules.',
    inputSchema: {
      type: 'object',
      properties: {
        filePath: {
          type: 'string',
          description:
            'Optional single file under PLAYWRIGHT_TEST_ROOT (default tests/) or PLAYWRIGHT_ADAPTER_TEST_ROOT (default adapter-tests/ when no adapter is configured). Validates all specs when omitted.',
        },
      },
    },
    stability: 'stable',
    readOnly: true,
    profiles: ['generator', 'healer', 'author', 'debug', 'all'],
    handler: (args) => {
      const filePath = typeof args?.filePath === 'string' ? args.filePath : undefined;
      return validateGeneratedTests(filePath);
    },
  },
  {
    name: 'validate_requirement',
    description:
      'Validate requirement markdown structure before Planner runs. Checks title, scenarios, observable results, and @manual conventions.',
    inputSchema: REQUIREMENTS_TEXT_OR_PATH,
    stability: 'compat',
    replacement: 'compile_requirement',
    readOnly: true,
    profiles: ['planner', 'author', 'all'],
    handler: (args) => {
      const requirementsText =
        typeof args?.requirementsText === 'string' ? args.requirementsText : undefined;
      const requirementPath =
        typeof args?.requirementPath === 'string' ? args.requirementPath : undefined;
      return validateRequirement({ requirementsText, requirementPath });
    },
  },
  {
    name: 'validate_plan',
    description:
      'Validate a TestPlanContractV1 (qa.test-plan/v1) against its source requirement contract. Checks scenario coverage, AC coverage, role/auth drift, assertion provenance, and ephemeral browser references.',
    inputSchema: {
      type: 'object',
      properties: {
        testPlan: { type: 'object', description: 'TestPlanContractV1 JSON payload.' },
        testPlanPath: {
          type: 'string',
          description: 'Path to test plan file under specs/ (markdown or JSON).',
        },
        requirement: { type: 'object', description: 'Optional RequirementContractV1 payload.' },
        requirementPath: { type: 'string', description: 'Optional path under requirements/.' },
      },
    },
    stability: 'stable',
    readOnly: true,
    profiles: ['planner', 'author', 'all'],
    handler: (args) => validatePlan(args),
  },
  {
    name: 'compile_test_plan',
    description:
      'Compile Markdown test plan (specs/*.md) into canonical TestPlanContractV1 (qa.test-plan/v1) with typed assertion provenance, scenario metadata, and coverage gaps.',
    inputSchema: {
      type: 'object',
      properties: {
        testPlanPath: {
          type: 'string',
          description: 'Repo-relative path under specs/ (e.g. specs/feature.plan.md).',
        },
        testPlanText: {
          type: 'string',
          description: 'Optional raw markdown test plan content.',
        },
        requirementPath: {
          type: 'string',
          description: 'Optional path to source requirement under requirements/.',
        },
      },
    },
    stability: 'stable',
    readOnly: true,
    profiles: ['planner', 'generator', 'author', 'all'],
    handler: (args) => {
      const testPlanPath = typeof args?.testPlanPath === 'string' ? args.testPlanPath : undefined;
      const testPlanText = typeof args?.testPlanText === 'string' ? args.testPlanText : undefined;
      const requirementPath =
        typeof args?.requirementPath === 'string' ? args.requirementPath : undefined;
      return compileTestPlan({ testPlanPath, testPlanText, requirementPath });
    },
  },
  {
    name: 'trace_requirement',
    description:
      'Build end-to-end TraceabilityContractV1 (qa.traceability/v1) graph linking Requirement -> Acceptance Criteria -> Scenarios -> Test Specs -> Execution Evidence.',
    inputSchema: {
      type: 'object',
      properties: {
        requirementPath: {
          type: 'string',
          description: 'Repo-relative path to requirement file.',
        },
        requirementsText: {
          type: 'string',
          description: 'Optional raw markdown requirement content.',
        },
        summaryPath: {
          type: 'string',
          description: 'Optional path to test-summary.json under artifacts/reports/.',
        },
      },
    },
    stability: 'stable',
    readOnly: true,
    profiles: ['planner', 'healer', 'reporter', 'author', 'debug', 'all'],
    handler: (args) => traceRequirement(args),
  },
  {
    name: 'snapshot_page',
    description:
      'Navigate to URL, capture ARIA snapshot, and persist a structured selector catalog under artifacts/selector-catalog/<feature>/<page>.{aria.yml,json}. Returns a compact summary (path, elementCount, hash, semanticSummary) for AI agents — read the JSON file for selector details.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Absolute http/https URL to navigate to.' },
        featureName: {
          type: 'string',
          description: 'Lowercase feature slug, e.g. "login". Becomes the catalog subfolder.',
        },
        pageName: {
          type: 'string',
          description: 'Lowercase page slug, e.g. "login-form". Becomes the catalog filename.',
        },
        role: {
          type: 'string',
          description:
            'Optional role auth context (e.g. "finance", "user"). Injects .auth/{APP_ENV}/{role}.json storageState.',
        },
        exploreModals: {
          type: 'boolean',
          description: 'Explore and capture dialog/modal/drawer triggers safely (default false).',
        },
        waitForSelector: {
          type: 'string',
          description: 'Optional CSS selector to wait for before capturing the snapshot.',
        },
        include: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional CSS scope — restricts snapshot to first matching subtree.',
        },
        maxElements: {
          type: 'number',
          description: 'Hard cap on captured interactive elements (default 500).',
        },
        force: {
          type: 'boolean',
          description: 'Re-capture and overwrite existing catalog (default false).',
        },
        waitUntil: {
          type: 'string',
          enum: ['networkidle', 'domcontentloaded', 'load'],
          description: 'page.goto waitUntil strategy.',
        },
        navigationTimeoutMs: {
          type: 'number',
          description: 'Per-page navigation timeout in ms (default 30000).',
        },
      },
      required: ['url', 'featureName', 'pageName'],
    },
    stability: 'stable',
    readOnly: false,
    profiles: ['discovery', 'planner', 'generator', 'healer', 'author', 'visual', 'all'],
    handler: (args) => snapshotPage(args),
  },
  {
    name: 'synthesize_requirement',
    description:
      'Synthesize a compliant requirement markdown file from selector-catalog semantic extractions (tables, forms, stat cards, modals) with active test scenarios and backlog suggestions.',
    inputSchema: {
      type: 'object',
      properties: {
        featureName: {
          type: 'string',
          description: 'Lowercase feature slug matching the selector-catalog folder.',
        },
        moduleName: {
          type: 'string',
          description: 'Target application module name (e.g. "invoice", "auth").',
        },
        title: {
          type: 'string',
          description: 'Human-friendly requirement title.',
        },
        entryUrl: {
          type: 'string',
          description: 'Starting page URL path for metadata.',
        },
        role: {
          type: 'string',
          description: 'Primary role associated with this requirement.',
        },
        catalogDirOverride: {
          type: 'string',
          description: 'Optional custom selector catalog directory path override.',
        },
        outputPath: {
          type: 'string',
          description: 'Optional output path (defaults to requirements/<featureName>.md).',
        },
      },
      required: ['featureName'],
    },
    stability: 'stable',
    readOnly: false,
    profiles: ['discovery', 'planner', 'author', 'all'],
    handler: (args) => synthesizeRequirement(args),
  },
  {
    name: 'discover_pages',
    description:
      'BFS auto-crawl a public site from a single entry point. For each unique same-origin URL: persist ARIA + selector catalog and append to page-map.json. Respects robots.txt, applies politeness delay, and supports checkpoint/resume.',
    inputSchema: {
      type: 'object',
      properties: {
        rootUrl: {
          type: 'string',
          description: 'Absolute http/https starting URL. Only same-origin links are followed.',
        },
        featureName: {
          type: 'string',
          description: 'Lowercase feature slug; catalog subfolder + page-map.json location.',
        },
        role: {
          type: 'string',
          description:
            'Optional role name to use authenticated session state (.auth/{APP_ENV}/{role}.json).',
        },
        maxDepth: { type: 'number', description: 'BFS depth limit (default 2).' },
        maxPages: { type: 'number', description: 'Total pages cap (default 25).' },
        excludePatterns: {
          type: 'array',
          items: { type: 'string' },
          description: 'Regex patterns — any matching URL/path is skipped.',
        },
        respectRobots: {
          type: 'boolean',
          description: 'Honor robots.txt Disallow + Crawl-delay (default true).',
        },
        requestDelayMs: {
          type: 'number',
          description: 'Politeness delay between requests in ms (default 200).',
        },
        waitUntil: {
          type: 'string',
          enum: ['networkidle', 'domcontentloaded', 'load'],
        },
        force: {
          type: 'boolean',
          description: 'Re-capture pages even if catalog is fresh.',
        },
      },
      required: ['rootUrl', 'featureName'],
    },
    stability: 'stable',
    readOnly: false,
    profiles: ['discovery', 'planner', 'author', 'minimal', 'all'],
    handler: (args) => discoverPages(args),
  },
  {
    name: 'archive_report',
    description:
      'Archive a pipeline report (Markdown + optional JSON) to artifacts/reports/archive/<runId>/. Requires an explicit QA decision and never overwrites an existing archive. Call this after the Reporter produces the final pipeline report and QA decides.',
    inputSchema: {
      type: 'object',
      properties: {
        runId: {
          type: 'string',
          description: 'The pipeline run ID (alphanumeric, hyphens, underscores only).',
        },
        reportPath: {
          type: 'string',
          description: 'Repo-relative path to the Markdown pipeline report file.',
        },
        jsonReportPath: {
          type: 'string',
          description: 'Optional repo-relative path to the JSON pipeline report file.',
        },
        qaDecision: {
          type: 'string',
          enum: [
            'APPROVE',
            'FILE_BUG',
            'REVISE_REQUIREMENT',
            'FIX_TEST',
            'FIX_ENV',
            'MARK_BLOCKED',
          ],
          description: 'Explicit QA decision; archiving does not imply APPROVE.',
        },
        qaNotes: { type: 'string', description: 'Optional QA notes.' },
      },
      required: ['runId', 'reportPath', 'qaDecision'],
    },
    stability: 'stable',
    readOnly: false,
    profiles: ['reporter', 'author', 'debug', 'all'],
    handler: (args) =>
      archiveReport(
        args as {
          runId: string;
          reportPath: string;
          jsonReportPath?: string;
          qaDecision:
            'APPROVE' | 'FILE_BUG' | 'REVISE_REQUIREMENT' | 'FIX_TEST' | 'FIX_ENV' | 'MARK_BLOCKED';
          qaNotes?: string;
        },
      ),
  },
  {
    name: 'generate_page_object',
    description:
      'Generate TypeScript POM scaffold from selector catalog JSON. Never overwrites existing files unless force=true. Returns scaffold with grouped locators, TODO markers for business methods, and warnings for fragile selectors.',
    inputSchema: {
      type: 'object',
      properties: {
        featureName: {
          type: 'string',
          description: 'Feature name (folder in artifacts/selector-catalog/).',
        },
        pageName: {
          type: 'string',
          description: 'Page name (JSON file in artifacts/selector-catalog/<feature>/).',
        },
        className: {
          type: 'string',
          description: 'Optional class name (default: PascalCase of pageName).',
        },
        outputPath: {
          type: 'string',
          description: 'Optional output path (default: tests/pages/<ClassName>.ts).',
        },
        force: {
          type: 'boolean',
          description: 'Overwrite existing file (default: false).',
        },
      },
      required: ['featureName', 'pageName'],
    },
    stability: 'experimental',
    readOnly: false,
    profiles: ['generator', 'author', 'all'],
    handler: (args) => generatePageObject(args),
  },
  {
    name: 'inspect_file',
    description:
      'Inspect a file under tests/data/ or artifacts/test-results/ (kind, size, magic bytes). Envelope only — no domain field schema.',
    inputSchema: {
      type: 'object',
      properties: {
        filePath: {
          type: 'string',
          description: 'Repo-relative path under tests/data/ or artifacts/test-results/.',
        },
      },
      required: ['filePath'],
    },
    stability: 'stable',
    readOnly: true,
    profiles: ['generator', 'debug', 'artifact', 'all'],
    handler: (args) => inspectFile(args),
  },
  {
    name: 'extract_pdf_text',
    description:
      'Extract plain text from a PDF under tests/data/ or artifacts/test-results/. Returns raw text only — match against scenario expected tokens from the requirement; does not define business fields (no title/code/name schema).',
    inputSchema: {
      type: 'object',
      properties: {
        filePath: {
          type: 'string',
          description: 'Repo-relative path to a PDF under tests/data/ or artifacts/test-results/.',
        },
        maxChars: {
          type: 'number',
          description: 'Optional max characters to return (truncates text).',
        },
      },
      required: ['filePath'],
    },
    stability: 'stable',
    readOnly: true,
    profiles: ['debug', 'artifact', 'all'],
    handler: (args) => extractPdfTextTool(args),
  },
  {
    name: 'read_excel_summary',
    description:
      'Read xlsx sheet names, header row, and sample rows under tests/data/ or artifacts/test-results/. Structure dump only — expected headers come from the scenario, not a fixed domain schema.',
    inputSchema: {
      type: 'object',
      properties: {
        filePath: {
          type: 'string',
          description:
            'Repo-relative path to an xlsx file under tests/data/ or artifacts/test-results/.',
        },
        sheet: {
          description: 'Optional sheet name or 0-based index.',
        },
        maxRows: {
          type: 'number',
          description: 'Max data rows to return after the header (default 20).',
        },
      },
      required: ['filePath'],
    },
    stability: 'stable',
    readOnly: true,
    profiles: ['debug', 'artifact', 'all'],
    handler: (args) => readExcelSummaryTool(args),
  },
  {
    name: 'list_test_fixtures',
    description:
      'List files under tests/data/ for upload Input Data paths (fixture-first; no headed OS file picker).',
    inputSchema: {
      type: 'object',
      properties: {
        subdir: {
          type: 'string',
          description: 'Optional relative subdir under tests/data/ (e.g. pdf, excel).',
        },
      },
    },
    stability: 'stable',
    readOnly: true,
    profiles: ['generator', 'author', 'debug', 'all'],
    handler: (args) => listTestFixtures(args),
  },
];

const TOOL_MAP: Map<string, ToolEntry> = new Map(TOOL_REGISTRY.map((t) => [t.name, t]));

export function getToolEntry(name: string): ToolEntry | undefined {
  return TOOL_MAP.get(name);
}

export function isToolError(name: string, payload: unknown): boolean {
  const entry = TOOL_MAP.get(name);
  if (entry?.isError) return entry.isError(payload);
  return isStatusError(payload);
}

export const MCP_TOOL_DEFINITIONS = TOOL_REGISTRY.map((t) => ({
  name: t.name,
  description: t.description,
  inputSchema: t.inputSchema,
}));

export const TOOL_ROUTES: Record<string, string> = Object.fromEntries(
  TOOL_REGISTRY.map((t) => [`/tools/${t.name}`, t.name]),
);

export const KNOWN_PROFILES: readonly ToolProfile[] = [
  'planner',
  'generator',
  'healer',
  'reporter',
  'discovery',
  'admin',
  'author',
  'debug',
  'auth',
  'visual',
  'artifact',
  'minimal',
  'all',
] as const;

export const CRITICAL_PROFILES: readonly ToolProfile[] = [
  'planner',
  'generator',
  'healer',
  'reporter',
] as const;

export interface ProfileRegistryValidationResult {
  ok: boolean;
  toolCount: number;
  criticalProfilesCovered: boolean;
  errors: string[];
  warnings: string[];
}

export function validateProfileRegistry(): ProfileRegistryValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // 1. Tool entry schema and stability integrity
  for (const tool of TOOL_REGISTRY) {
    if (!tool.name || tool.name.trim() === '') {
      errors.push('Found tool with empty name.');
    }
    if (!tool.handler) {
      errors.push(`Tool ${tool.name} is missing an execution handler.`);
    }
    if (tool.stability === 'deprecated' && !tool.replacement) {
      errors.push(`Deprecated tool ${tool.name} must specify a replacement tool.`);
    }

    if (tool.profiles) {
      for (const p of tool.profiles) {
        if (!KNOWN_PROFILES.includes(p)) {
          errors.push(`Tool ${tool.name} specifies unknown profile: "${String(p)}".`);
        }
      }
    }
  }

  // 2. Critical profiles must have at least one tool mapped
  for (const criticalProfile of CRITICAL_PROFILES) {
    const tools = getToolsForProfile(criticalProfile);
    if (tools.length === 0) {
      errors.push(`Critical profile "${criticalProfile}" has no active tools mapped.`);
    }
  }

  return {
    ok: errors.length === 0,
    toolCount: TOOL_REGISTRY.length,
    criticalProfilesCovered: CRITICAL_PROFILES.every((p) => getToolsForProfile(p).length > 0),
    errors,
    warnings,
  };
}
