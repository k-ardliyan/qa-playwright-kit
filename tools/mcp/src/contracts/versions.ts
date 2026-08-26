/**
 * AUTO-SYNCED from src/contracts/versions.ts — do not edit by hand.
 * Run: npm run sync:mcp-generated  (also runs inside npm run mcp:build)
 */

/**
 * Canonical Schema Version Identifiers
 *
 * All contracts exchanged between human authoring, compiler gates,
 * AI agent orchestration, and reporting use these version tags.
 */

export const REQUIREMENT_SCHEMA_V1 = 'qa.requirement/v1' as const;
export type RequirementSchemaVersion = typeof REQUIREMENT_SCHEMA_V1;

export const TEST_PLAN_SCHEMA_V1 = 'qa.test-plan/v1' as const;
export type TestPlanSchemaVersion = typeof TEST_PLAN_SCHEMA_V1;

export const TRACEABILITY_SCHEMA_V1 = 'qa.traceability/v1' as const;
export type TraceabilitySchemaVersion = typeof TRACEABILITY_SCHEMA_V1;

export const MCP_RESULT_SCHEMA_V1 = 'qa.mcp-result/v1' as const;
export type McpResultSchemaVersion = typeof MCP_RESULT_SCHEMA_V1;

export const SELECTOR_CATALOG_SCHEMA_V1 = 'qa.selector-catalog/v1' as const;
export type SelectorCatalogSchemaVersion = typeof SELECTOR_CATALOG_SCHEMA_V1;
