/**
 * Shared path resolution for file-inspect MCP tools.
 * Allowed roots: tests/data/ and artifacts/test-results/ (read-only).
 */

import { createToolError, resolveAllowedPath, type ToolError } from '../../utils/safety';

export type FileInspectKind = 'test-data' | 'test-results';

export function resolveFileInspectPath(
  inputPath: string,
  options: { mustExist?: boolean } = {},
):
  | { ok: true; absolutePath: string; relativePath: string; kind: FileInspectKind }
  | { ok: false; error: ToolError } {
  const normalizedInput = (inputPath ?? '').replace(/\\/g, '/').trim();
  const testData = resolveAllowedPath(normalizedInput, 'test-data', {
    mustExist: options.mustExist ?? true,
    readOnly: true,
  });
  const testResults = resolveAllowedPath(normalizedInput, 'test-results', {
    mustExist: options.mustExist ?? true,
    readOnly: true,
  });
  const resolved = testData.ok ? testData : testResults;

  if (!resolved.ok) {
    return { ok: false, error: resolved.error };
  }

  return {
    ok: true,
    absolutePath: resolved.absolutePath,
    relativePath: resolved.relativePath,
    kind: testData.ok ? 'test-data' : 'test-results',
  };
}

export function toolErrorPayload(error: ToolError) {
  return createToolError(error.code, error.message);
}
