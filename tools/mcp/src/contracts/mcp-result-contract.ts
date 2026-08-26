/**
 * AUTO-SYNCED from src/contracts/mcp-result-contract.ts — do not edit by hand.
 * Run: npm run sync:mcp-generated  (also runs inside npm run mcp:build)
 */

import { MCP_RESULT_SCHEMA_V1, type McpResultSchemaVersion } from './versions';
import { type Diagnostic } from './diagnostics';

export type McpStatus = 'success' | 'warning' | 'error';

export interface McpProvenance {
  sourcePath?: string;
  sourceHash?: string;
}

export interface McpArtifact {
  kind: string;
  path: string;
  hash?: string;
}

export interface McpNextAction {
  action: string;
  reason: string;
}

export interface McpResult<T = unknown> {
  schemaVersion: McpResultSchemaVersion;
  status: McpStatus;
  data?: T;
  diagnostics: Diagnostic[];
  provenance?: McpProvenance;
  artifacts?: McpArtifact[];
  nextActions?: McpNextAction[];
  message?: string;
}

export function successResult<T>(
  data: T,
  extra?: Partial<Omit<McpResult<T>, 'schemaVersion' | 'status' | 'data'>>,
): McpResult<T> {
  return {
    schemaVersion: MCP_RESULT_SCHEMA_V1,
    status: 'success',
    data,
    diagnostics: extra?.diagnostics ?? [],
    ...extra,
  };
}

export function warningResult<T>(
  data: T,
  diagnostics: Diagnostic[],
  extra?: Partial<Omit<McpResult<T>, 'schemaVersion' | 'status' | 'data' | 'diagnostics'>>,
): McpResult<T> {
  return {
    schemaVersion: MCP_RESULT_SCHEMA_V1,
    status: 'warning',
    data,
    diagnostics,
    ...extra,
  };
}

export function failureResult(
  diagnostics: Diagnostic[],
  extra?: Partial<Omit<McpResult<undefined>, 'schemaVersion' | 'status' | 'diagnostics'>>,
): McpResult<undefined> {
  return {
    schemaVersion: MCP_RESULT_SCHEMA_V1,
    status: 'error',
    diagnostics,
    ...extra,
  };
}
