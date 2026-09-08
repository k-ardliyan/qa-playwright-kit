import * as fs from 'node:fs';
import { assertRequirementsTextSize, resolveAllowedPath } from '../utils/safety';
import {
  REQUIREMENT_SCHEMA_V1,
  type RequirementContractV1,
  type Diagnostic,
  createDiagnostic,
  computeSourceHash,
  type McpResult,
  failureResult,
} from '../contracts';
import {
  readString,
  parseTitleAndId,
  parseMetadata,
  parseAccessMatrix,
  parseAcceptanceCriteria,
  parseScenarios,
} from './parsers/requirement-parsers';

export interface CompileRequirementArgs {
  requirementsText?: unknown;
  requirementPath?: unknown;
}

export type CompileRequirementOutput = McpResult<RequirementContractV1 | undefined>;

export function compileRequirementFromText(
  requirementsText: string,
  sourcePath?: string,
): CompileRequirementOutput {
  const sizeError = assertRequirementsTextSize(requirementsText);
  if (sizeError) {
    return failureResult([
      createDiagnostic(sizeError.code, 'error', sizeError.message, { path: sourcePath }),
    ]);
  }

  const lines = requirementsText.split('\n');
  const { title, id } = parseTitleAndId(lines);
  const metadata = parseMetadata(requirementsText, lines, sourcePath);
  const sourceHash = computeSourceHash(requirementsText);

  const { matrix, diagnostics: matrixDiags } = parseAccessMatrix(requirementsText, metadata.roles);
  const { criteria, diagnostics: acDiags } = parseAcceptanceCriteria(requirementsText);
  const declaredAcIds = new Set(criteria.map((c) => c.id));

  const { scenarios, diagnostics: scenarioDiags } = parseScenarios(requirementsText, declaredAcIds);

  const allDiagnostics: Diagnostic[] = [...matrixDiags, ...acDiags, ...scenarioDiags];

  // Validation rules
  // 1. Check duplicate AC IDs
  const seenAc = new Set<string>();
  for (const ac of criteria) {
    if (seenAc.has(ac.id)) {
      allDiagnostics.push(
        createDiagnostic(
          'REQ_DUPLICATE_AC_ID',
          'error',
          `Duplicate Acceptance Criterion ID "${ac.id}".`,
        ),
      );
    }
    seenAc.add(ac.id);
  }

  // 2. Check duplicate Scenario IDs
  const seenSc = new Set<string>();
  for (const sc of scenarios) {
    if (seenSc.has(sc.id)) {
      allDiagnostics.push(
        createDiagnostic(
          'REQ_DUPLICATE_SCENARIO_ID',
          'error',
          `Duplicate Scenario ID "${sc.id}".`,
          {
            scenarioId: sc.id,
          },
        ),
      );
    }
    seenSc.add(sc.id);
  }

  // 3. Check duplicate Test IDs
  const seenTest = new Set<string>();
  for (const sc of scenarios) {
    if (sc.testId) {
      if (seenTest.has(sc.testId)) {
        allDiagnostics.push(
          createDiagnostic('REQ_DUPLICATE_TEST_ID', 'error', `Duplicate Test ID "${sc.testId}".`, {
            testId: sc.testId,
            scenarioId: sc.id,
          }),
        );
      }
      seenTest.add(sc.testId);
    }
  }

  // 4. Check scenarios exist
  if (scenarios.length === 0) {
    allDiagnostics.push(
      createDiagnostic(
        'REQ_EMPTY_SCENARIOS',
        'error',
        'Requirement contains no test scenarios (### SC-XX).',
      ),
    );
  }

  const hasErrors = allDiagnostics.some((d) => d.severity === 'error');

  const contract: RequirementContractV1 = {
    schemaVersion: REQUIREMENT_SCHEMA_V1,
    requirementId: id,
    title,
    sourcePath,
    sourceHash,
    module: metadata.module,
    feature: metadata.feature,
    priority: metadata.priority,
    risk: metadata.risk,
    tags: metadata.tags,
    auth: {
      state: metadata.authState,
      defaultRole: metadata.defaultRole,
    },
    roles: metadata.roles,
    accessMatrix: matrix,
    startPage: metadata.startPage,
    environmentScope: metadata.environmentScope,
    dataScope: metadata.dataScope,
    acceptanceCriteria: criteria,
    scenarios,
    diagnostics: allDiagnostics,
  };

  if (hasErrors) {
    return {
      schemaVersion: 'qa.mcp-result/v1',
      status: 'error',
      data: contract,
      diagnostics: allDiagnostics,
      provenance: { sourcePath, sourceHash },
      message: `Requirement compilation failed with ${allDiagnostics.filter((d) => d.severity === 'error').length} error(s).`,
    };
  }

  if (allDiagnostics.some((d) => d.severity === 'warning')) {
    return {
      schemaVersion: 'qa.mcp-result/v1',
      status: 'warning',
      data: contract,
      diagnostics: allDiagnostics,
      provenance: { sourcePath, sourceHash },
      message: `Requirement compiled successfully with ${allDiagnostics.filter((d) => d.severity === 'warning').length} warning(s).`,
    };
  }

  return {
    schemaVersion: 'qa.mcp-result/v1',
    status: 'success',
    data: contract,
    diagnostics: allDiagnostics,
    provenance: { sourcePath, sourceHash },
    message: `Requirement compiled successfully (${scenarios.length} scenarios, ${criteria.length} ACs).`,
  };
}

export function compileRequirement(
  args: CompileRequirementArgs | undefined,
): CompileRequirementOutput {
  if (!args || typeof args !== 'object') {
    return failureResult([
      createDiagnostic('INVALID_INPUT', 'error', 'Arguments must be an object.'),
    ]);
  }

  const requirementsText = readString(args.requirementsText);
  const requirementPath = readString(args.requirementPath);

  if (!requirementsText && !requirementPath) {
    return failureResult([
      createDiagnostic(
        'INVALID_INPUT',
        'error',
        'Either `requirementPath` or `requirementsText` is required.',
      ),
    ]);
  }

  if (requirementsText) {
    return compileRequirementFromText(requirementsText, requirementPath ?? undefined);
  }

  if (requirementPath) {
    const resolved = resolveAllowedPath(requirementPath, 'requirements', { mustExist: true });
    if (!resolved.ok) {
      return failureResult([
        createDiagnostic(resolved.error.code, 'error', resolved.error.message, {
          path: requirementPath,
        }),
      ]);
    }

    try {
      const text = fs.readFileSync(resolved.absolutePath, 'utf-8');
      return compileRequirementFromText(text, resolved.relativePath);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return failureResult([
        createDiagnostic('TOOL_INTERNAL', 'error', `Failed to read file: ${msg}`, {
          path: requirementPath,
        }),
      ]);
    }
  }

  return failureResult([
    createDiagnostic('INVALID_INPUT', 'error', 'Invalid compilation request.'),
  ]);
}

export * from './parsers/requirement-parsers';
