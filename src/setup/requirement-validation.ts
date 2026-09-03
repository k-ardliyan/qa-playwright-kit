/**
 * Requirement gate used by setup without coupling startup to the MCP package.
 *
 * The canonical compiler lives in tools/mcp. Load its source only when the
 * setup wizard needs the gate; setup startup therefore does not require the
 * MCP server package or its transport dependencies.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';

export interface RequirementDiagnostic {
  code?: string;
  severity: string;
  message: string;
}

export interface RequirementValidationResult {
  valid: boolean;
  status: 'success' | 'warning' | 'error';
  message: string;
  diagnostics: RequirementDiagnostic[];
}

type CanonicalCompilerResult = {
  status: 'success' | 'warning' | 'error';
  message?: string;
  diagnostics?: RequirementDiagnostic[];
};

type CanonicalCompilerModule = {
  compileRequirementFromText: (
    requirementsText: string,
    sourcePath?: string,
  ) => CanonicalCompilerResult;
};

/** Compile a requirement through the canonical contract compiler. */
export async function validateRequirementFile(
  repoRoot: string,
  relativePath: string,
): Promise<RequirementValidationResult> {
  const absolutePath = path.resolve(repoRoot, relativePath);
  if (!fs.existsSync(absolutePath)) {
    return {
      valid: false,
      status: 'error',
      message: `Requirement file not found: ${relativePath}`,
      diagnostics: [],
    };
  }

  try {
    const compilerPath = path.resolve(
      repoRoot,
      'tools',
      'mcp',
      'src',
      'tools',
      'compile-requirement.ts',
    );
    const compiler = (await import(pathToFileURL(compilerPath).href)) as CanonicalCompilerModule;
    const result = compiler.compileRequirementFromText(
      fs.readFileSync(absolutePath, 'utf-8'),
      relativePath.replace(/\\/g, '/'),
    );
    const diagnostics = result.diagnostics ?? [];
    return {
      valid: result.status !== 'error',
      status: result.status,
      message: result.message ?? `Requirement compilation ${result.status}.`,
      diagnostics,
    };
  } catch (error: unknown) {
    return {
      valid: false,
      status: 'error',
      message: `Requirement compilation could not run: ${error instanceof Error ? error.message : String(error)}`,
      diagnostics: [],
    };
  }
}

export function formatRequirementValidationFailure(result: RequirementValidationResult): string {
  const errors = result.diagnostics
    .filter((diagnostic) => diagnostic.severity === 'error')
    .map((diagnostic) => `${diagnostic.code ? `${diagnostic.code}: ` : ''}${diagnostic.message}`);
  return [result.message, ...errors].join(' ');
}
