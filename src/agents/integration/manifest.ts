/**
 * Capability Manifest Generator — Agent AI Integration Layer
 *
 * Generates `agent-manifest.json` at repository root describing every
 * pipeline phase, its required MCP tools, input/output contracts, and
 * supported orchestration modes.
 *
 * The manifest is derived from hardcoded phase definitions and a static
 * tool info map (matching the MCP tool registry).
 *
 * @module agents/integration/manifest
 */

import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { PipelinePhase, OrchestrationModeDescriptor } from './types';

// ─── Type Definitions ────────────────────────────────────────────────────────

/**
 * Simplified JSON Schema object type used for input/output schemas.
 */
export type JsonSchemaObject = Record<string, unknown>;

/**
 * Describes a single MCP tool available within a pipeline phase.
 */
export interface ToolDescriptor {
  server: string;
  name: string;
  description: string;
}

/**
 * Describes the capabilities of a single pipeline phase.
 */
export interface PhaseCapability {
  description: string;
  agentFile: string;
  mcpServers: string[];
  tools: ToolDescriptor[];
  inputSchema: JsonSchemaObject;
  outputSchema: JsonSchemaObject;
}

/**
 * Prerequisites required to run the pipeline.
 */
export interface Prerequisites {
  nodeVersion: string;
  requiredEnvVars: string[];
  dependencies: string[];
}

/**
 * The full capability manifest describing the pipeline.
 */
export interface CapabilityManifest {
  version: string;
  generatedAt: string;
  phases: Record<PipelinePhase, PhaseCapability>;
  orchestrationModes: OrchestrationModeDescriptor[];
  prerequisites: Prerequisites;
}

// ─── Static Tool Info ────────────────────────────────────────────────────────

/**
 * Static tool information matching the MCP tool registry.
 * Each entry contains the server, name, and description.
 */
const TOOL_INFO: Record<string, ToolDescriptor> = {
  health_check: {
    server: 'qa-playwright-kit',
    name: 'health_check',
    description:
      'Verify Node, Playwright packages, MCP build, environment files, `.auth/{APP_ENV}/` storage state, and test result artifacts before running the agent pipeline.',
  },
  compile_requirement: {
    server: 'qa-playwright-kit',
    name: 'compile_requirement',
    description:
      'Compile requirement markdown into typed RequirementContractV1 with access matrix, scenarios, and source hash.',
  },
  compile_test_plan: {
    server: 'qa-playwright-kit',
    name: 'compile_test_plan',
    description:
      'Compile Markdown test plan into canonical TestPlanContractV1 with assertion provenance and coverage references.',
  },
  validate_plan: {
    server: 'qa-playwright-kit',
    name: 'validate_plan',
    description:
      'Validate test plan contract against requirement contract and check for drift or uncovered ACs.',
  },
  trace_requirement: {
    server: 'qa-playwright-kit',
    name: 'trace_requirement',
    description:
      'Build end-to-end TraceabilityContractV1 graph and 4-dimensional coverage metrics.',
  },
  validate_requirement: {
    server: 'qa-playwright-kit',
    name: 'validate_requirement',
    description:
      'Validate requirement markdown structure before Planner runs. Checks title, scenarios, observable results, and @manual conventions.',
  },
  normalize_requirements: {
    server: 'qa-playwright-kit',
    name: 'normalize_requirements',
    description:
      'Parse requirement markdown into structured contract with acceptance criteria and optional test scenarios.',
  },
  parse_requirement_scenarios: {
    server: 'qa-playwright-kit',
    name: 'parse_requirement_scenarios',
    description:
      'Extract ### scenarios with Langkah/Hasil sections from requirement markdown (Indonesian or English).',
  },
  discover_pages: {
    server: 'qa-playwright-kit',
    name: 'discover_pages',
    description:
      'BFS auto-crawl a public site from a single entry point. For each unique same-origin URL: persist ARIA + selector catalog and append to page-map.json.',
  },
  snapshot_page: {
    server: 'qa-playwright-kit',
    name: 'snapshot_page',
    description:
      'Navigate to URL, capture ARIA snapshot, and persist a structured selector catalog under artifacts/selector-catalog/<feature>/<page>.{aria.yml,json}.',
  },
  validate_generated_tests: {
    server: 'qa-playwright-kit',
    name: 'validate_generated_tests',
    description:
      'Validate generated .spec.ts files for base.fixture import, test.describe, and test.step rules.',
  },
  get_test_failures: {
    server: 'qa-playwright-kit',
    name: 'get_test_failures',
    description:
      "Get Playwright test failures from the caller's resultsDir (or repo artifacts/test-results/ by default). Includes trace and screenshot paths when available.",
  },
  get_test_summary: {
    server: 'qa-playwright-kit',
    name: 'get_test_summary',
    description:
      'Read machine-readable pass/fail summary from artifacts/reports/test-summary.json.',
  },
  list_artifacts: {
    server: 'qa-playwright-kit',
    name: 'list_artifacts',
    description: 'List requirement, spec, and generated test files under allowed project paths.',
  },
  list_requirement_status: {
    server: 'qa-playwright-kit',
    name: 'list_requirement_status',
    description:
      'Coverage map: each pipeline requirement with hasPlan, hasTests, manual scenario count, and last run status from test-summary when available.',
  },
  generate_page_object: {
    server: 'qa-playwright-kit',
    name: 'generate_page_object',
    description:
      'Scaffold typed Page Object Model class in tests/pages/<PageName>.ts from selector catalog.',
  },
  list_test_fixtures: {
    server: 'qa-playwright-kit',
    name: 'list_test_fixtures',
    description:
      'List files under tests/data/ for upload Input Data paths (fixture-first; no headed OS file picker).',
  },
  inspect_file: {
    server: 'qa-playwright-kit',
    name: 'inspect_file',
    description:
      'Read envelope metadata (kind, size, magic signature) for files under tests/data/ or artifacts/test-results/.',
  },
  extract_pdf_text: {
    server: 'qa-playwright-kit',
    name: 'extract_pdf_text',
    description:
      'Extract raw text content from a PDF under tests/data/ or artifacts/test-results/.',
  },
  read_excel_summary: {
    server: 'qa-playwright-kit',
    name: 'read_excel_summary',
    description:
      'Read xlsx sheet names, header row, and sample rows under tests/data/ or artifacts/test-results/.',
  },
  archive_report: {
    server: 'qa-playwright-kit',
    name: 'archive_report',
    description: 'Archive pipeline run artifacts to artifacts/reports/archive/<runId>/.',
  },
};

// ─── Phase Definitions ───────────────────────────────────────────────────────

/**
 * Hardcoded phase metadata defining which tools and MCP servers each phase uses.
 */
const PHASE_DEFINITIONS: Record<
  PipelinePhase,
  {
    description: string;
    agentFile: string;
    mcpServers: string[];
    toolNames: string[];
  }
> = {
  plan: {
    description: 'Analyze requirements and produce a structured test plan',
    agentFile: '.github/agents/planner.agent.md',
    mcpServers: ['qa-playwright-kit'],
    toolNames: [
      'health_check',
      'compile_requirement',
      'compile_test_plan',
      'validate_plan',
      'validate_requirement',
      'normalize_requirements',
      'parse_requirement_scenarios',
      'list_requirement_status',
      'discover_pages',
      'snapshot_page',
    ],
  },
  generate: {
    description: 'Generate Playwright test specifications from the test plan',
    agentFile: '.github/agents/generator.agent.md',
    mcpServers: ['qa-playwright-kit', 'playwright'],
    toolNames: [
      'compile_requirement',
      'compile_test_plan',
      'validate_generated_tests',
      'snapshot_page',
      'generate_page_object',
      'list_test_fixtures',
      'inspect_file',
    ],
  },
  execute: {
    description: 'Run generated tests using the Playwright test runner',
    agentFile: '',
    mcpServers: ['playwright-test'],
    toolNames: [],
  },
  heal: {
    description: 'Diagnose and fix test failures using trace and screenshot data',
    agentFile: '.github/agents/healer.agent.md',
    mcpServers: ['qa-playwright-kit', 'playwright-test', 'playwright'],
    toolNames: ['get_test_failures', 'validate_generated_tests', 'snapshot_page', 'inspect_file'],
  },
  report: {
    description: 'Aggregate test results into a structured pipeline report',
    agentFile: '.github/agents/reporter.agent.md',
    mcpServers: ['qa-playwright-kit'],
    toolNames: [
      'trace_requirement',
      'get_test_summary',
      'get_test_failures',
      'list_artifacts',
      'list_requirement_status',
      'archive_report',
    ],
  },
};

// ─── Input/Output Schemas ────────────────────────────────────────────────────

/**
 * Input schemas for each pipeline phase.
 */
const INPUT_SCHEMAS: Record<PipelinePhase, JsonSchemaObject> = {
  plan: {
    type: 'object',
    properties: {
      requirementPath: { type: 'string', description: 'Path to requirement markdown file' },
    },
    required: ['requirementPath'],
  },
  generate: {
    type: 'object',
    properties: {
      testPlan: { type: 'string', description: 'Markdown table with scenario definitions' },
      requirementPath: { type: 'string', description: 'Original requirement file path' },
    },
    required: ['testPlan'],
  },
  execute: {
    type: 'object',
    properties: {
      testFiles: {
        type: 'array',
        items: { type: 'string' },
        description: 'Paths to generated spec files to execute',
      },
    },
    required: ['testFiles'],
  },
  heal: {
    type: 'object',
    properties: {
      failures: {
        type: 'array',
        items: { type: 'object' },
        description: 'Array of test failure objects from get_test_failures',
      },
    },
    required: ['failures'],
  },
  report: {
    type: 'object',
    properties: {
      runId: { type: 'string', description: 'Pipeline run identifier' },
      testSummary: { type: 'object', description: 'Test summary from get_test_summary' },
      failures: { type: 'array', description: 'Unresolved failures array' },
    },
    required: ['runId'],
  },
};

/**
 * Output schemas for each pipeline phase.
 */
const OUTPUT_SCHEMAS: Record<PipelinePhase, JsonSchemaObject> = {
  plan: {
    type: 'object',
    properties: {
      testPlan: { type: 'string', description: 'Markdown table of planned scenarios' },
      scenarioCount: { type: 'number', description: 'Number of scenarios planned' },
    },
    required: ['testPlan', 'scenarioCount'],
  },
  generate: {
    type: 'object',
    properties: {
      generatedFiles: {
        type: 'array',
        items: { type: 'string' },
        description: 'Paths to generated .spec.ts files',
      },
      testCount: { type: 'number', description: 'Number of tests generated' },
    },
    required: ['generatedFiles', 'testCount'],
  },
  execute: {
    type: 'object',
    properties: {
      passed: { type: 'number' },
      failed: { type: 'number' },
      skipped: { type: 'number' },
      duration: { type: 'number', description: 'Total duration in milliseconds' },
    },
    required: ['passed', 'failed', 'skipped', 'duration'],
  },
  heal: {
    type: 'object',
    properties: {
      healed: { type: 'number', description: 'Number of tests successfully healed' },
      unresolved: { type: 'number', description: 'Number of tests that could not be healed' },
      patches: {
        type: 'array',
        items: { type: 'string' },
        description: 'Paths to healer patch files',
      },
    },
    required: ['healed', 'unresolved'],
  },
  report: {
    type: 'object',
    properties: {
      reportPath: { type: 'string', description: 'Path to generated pipeline report' },
      summary: {
        type: 'object',
        properties: {
          scenariosPlanned: { type: 'number' },
          testsGenerated: { type: 'number' },
          testsPassing: { type: 'number' },
          testsFailing: { type: 'number' },
          testsHealed: { type: 'number' },
          testsSkipped: { type: 'number' },
        },
      },
    },
    required: ['reportPath', 'summary'],
  },
};

// ─── Manifest Constants ──────────────────────────────────────────────────────

/** Current manifest schema version. */
export const MANIFEST_VERSION = '1.0.0';

/** Output path relative to repository root. */
export const MANIFEST_FILENAME = 'agent-manifest.json';

// ─── Manifest Generator ──────────────────────────────────────────────────────

/**
 * Builds the full capability manifest from static phase definitions and tool info.
 *
 * @returns The complete CapabilityManifest object.
 */
export function generateManifest(): CapabilityManifest {
  const phases = {} as Record<PipelinePhase, PhaseCapability>;

  for (const [phase, def] of Object.entries(PHASE_DEFINITIONS) as [
    PipelinePhase,
    (typeof PHASE_DEFINITIONS)[PipelinePhase],
  ][]) {
    const tools: ToolDescriptor[] = def.toolNames
      .map((name) => TOOL_INFO[name])
      .filter((t): t is ToolDescriptor => t !== undefined);

    phases[phase] = {
      description: def.description,
      agentFile: def.agentFile,
      mcpServers: def.mcpServers,
      tools,
      inputSchema: INPUT_SCHEMAS[phase],
      outputSchema: OUTPUT_SCHEMAS[phase],
    };
  }

  const orchestrationModes: OrchestrationModeDescriptor[] = [
    {
      mode: 'manual',
      description:
        'Prompt-driven execution — one phase at a time with user confirmation between phases.',
    },
    {
      mode: 'automatic',
      description:
        'Full pipeline runs without user intervention. All phases execute sequentially with automatic retry on retryable failures.',
    },
  ];

  const prerequisites: Prerequisites = {
    nodeVersion: '>=20.19.0',
    requiredEnvVars: ['BASE_URL'],
    dependencies: ['@playwright/test', '@playwright/mcp', 'tsx'],
  };

  return {
    version: MANIFEST_VERSION,
    generatedAt: new Date().toISOString(),
    phases,
    orchestrationModes,
    prerequisites,
  };
}

/**
 * Writes the capability manifest to `agent-manifest.json` at the repository root.
 *
 * @param manifest - Optional pre-built manifest. If omitted, generates a fresh one.
 */
export function writeManifest(manifest?: CapabilityManifest): void {
  const data = manifest ?? generateManifest();
  const repoRoot = resolve(__dirname, '..', '..', '..');
  const outputPath = resolve(repoRoot, MANIFEST_FILENAME);
  writeFileSync(outputPath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
}
