import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  getAdapterTestRoot,
  getPlaywrightTestRoot,
  isUnderAllowedTestRoot,
} from './playwright-paths';

import { mcpWorkspace, findRepoRoot as resolveRepoRoot } from './workspace-paths';

export const MAX_REQUIREMENTS_TEXT_BYTES = 256 * 1024;

export type AllowedPathKind =
  | 'requirements'
  | 'specs'
  | 'tests'
  | 'reports'
  | 'test-results'
  | 'environments'
  | 'selector-catalog'
  | 'pages'
  | 'test-data';

const READ_ONLY_KINDS = new Set<AllowedPathKind>(['environments', 'test-results', 'reports']);

function getAllowedPrefixes(): Record<Exclude<AllowedPathKind, 'tests'>, string[]> {
  return {
    requirements: [mcpWorkspace.requirementsRel],
    specs: [mcpWorkspace.specsRel],
    reports: [mcpWorkspace.reportsRel],
    'test-results': [mcpWorkspace.testResultsRel],
    environments: [mcpWorkspace.environmentsRel],
    'selector-catalog': [mcpWorkspace.selectorCatalogRel],
    pages: [mcpWorkspace.pagesRel],
    'test-data': [mcpWorkspace.testDataRel],
  };
}

function getTestsPrefix(): string {
  return mcpWorkspace.testsRel || getPlaywrightTestRoot();
}

export interface ToolError {
  code: string;
  message: string;
}

export function createToolError(
  code: string,
  message: string,
): { status: 'error'; error: ToolError } {
  return { status: 'error', error: { code, message } };
}

export function findRepoRoot(start: string = __dirname): string {
  return resolveRepoRoot(start);
}

export function getRepoRoot(): string {
  return mcpWorkspace.rootDir;
}

/**
 * Valid target for a requirement file under `requirements/`.
 * Default: allows examples and nested domain paths; still blocks _TEMPLATE, README.
 * Pass `{ blockExamples: true }` for the pipeline-tooling view that excludes
 * example-* files (matches the previous isPipelineRequirementRelativePath).
 */
export function isValidRequirementRelativePath(
  relativePath: string,
  opts: { blockExamples?: boolean } = {},
): boolean {
  const normalized = relativePath.replace(/\\/g, '/');
  // Allow: requirements/<name>.md OR requirements/<domain>/<name>.md OR tests/fixtures/requirements/<name>.md
  const match = normalized.match(
    /^(?:requirements|tests\/fixtures\/requirements)\/([\w-]+(\/[\w-]+)*)\.md$/,
  );
  if (!match) {
    return false;
  }

  // basename is the last path segment (the filename without .md)
  const basename = match[1].split('/').pop()!;
  if (basename.startsWith('_')) {
    return false;
  }
  if (basename.toLowerCase() === 'readme') {
    return false;
  }
  if (opts.blockExamples && basename.startsWith('example-')) {
    return false;
  }

  return true;
}

/** Feature requirement files only — excludes meta (_TEMPLATE, README) and examples. */
export function isPipelineRequirementRelativePath(relativePath: string): boolean {
  return isValidRequirementRelativePath(relativePath, { blockExamples: true });
}

export function assertRequirementsTextSize(text: string): ToolError | null {
  const bytes = Buffer.byteLength(text, 'utf8');
  if (bytes > MAX_REQUIREMENTS_TEXT_BYTES) {
    return {
      code: 'INPUT_TOO_LARGE',
      message: `requirementsText exceeds ${MAX_REQUIREMENTS_TEXT_BYTES} bytes (${bytes} bytes).`,
    };
  }
  return null;
}

export function resolveAllowedPath(
  inputPath: string,
  kind: AllowedPathKind,
  options: { mustExist?: boolean; readOnly?: boolean } = {},
): { ok: true; absolutePath: string; relativePath: string } | { ok: false; error: ToolError } {
  const repoRoot = getRepoRoot();
  const prefixes =
    kind === 'selector-catalog'
      ? [mcpWorkspace.selectorCatalogRel, 'selector-catalog']
      : kind === 'tests'
        ? [getTestsPrefix()]
        : getAllowedPrefixes()[kind as Exclude<AllowedPathKind, 'tests'>] || [];
  const normalizedInput = inputPath.replace(/\\/g, '/').trim();

  if (!normalizedInput || normalizedInput.includes('\0')) {
    return {
      ok: false,
      error: { code: 'INVALID_PATH', message: 'Path must be a non-empty string.' },
    };
  }

  if (path.isAbsolute(normalizedInput)) {
    const absolute = path.resolve(normalizedInput);
    const relative = path.relative(repoRoot, absolute);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      return {
        ok: false,
        error: {
          code: 'PATH_NOT_ALLOWED',
          message: 'Absolute paths must stay inside the repository root.',
        },
      };
    }
  }

  const candidate = path.resolve(repoRoot, normalizedInput);
  const relative = path.relative(repoRoot, candidate).replace(/\\/g, '/');

  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    return {
      ok: false,
      error: { code: 'PATH_TRAVERSAL', message: 'Path traversal is not allowed.' },
    };
  }

  if (kind === 'tests') {
    if (!isUnderAllowedTestRoot(relative)) {
      return {
        ok: false,
        error: {
          code: 'PATH_NOT_ALLOWED',
          message: `Path must be under '${getTestsPrefix()}/' or '${getAdapterTestRoot()}/'. Received: '${relative}'.`,
        },
      };
    }
  } else {
    const matchesPrefix = prefixes.some((p) => relative === p || relative.startsWith(`${p}/`));
    if (!matchesPrefix) {
      return {
        ok: false,
        error: {
          code: 'PATH_NOT_ALLOWED',
          message: `Path must be under '${prefixes[0]}/'. Received: '${relative}'.`,
        },
      };
    }
  }

  const readOnly = options.readOnly ?? READ_ONLY_KINDS.has(kind);
  if (readOnly && options.mustExist === false) {
    // read-only kinds can still be listed without write
  }

  if (kind === 'requirements') {
    if (!isValidRequirementRelativePath(relative)) {
      return {
        ok: false,
        error: {
          code: 'PATH_NOT_ALLOWED',
          message: `Path must be a feature file at requirements/<name>.md or requirements/<domain>/<name>.md (not _TEMPLATE or README). Received: '${relative}'.`,
        },
      };
    }
  }

  if (options.mustExist && !fs.existsSync(candidate)) {
    return {
      ok: false,
      error: { code: 'NOT_FOUND', message: `Path does not exist: ${relative}` },
    };
  }

  return { ok: true, absolutePath: candidate, relativePath: relative };
}
