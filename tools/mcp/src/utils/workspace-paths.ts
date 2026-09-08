/**
 * AUTO-SYNCED from src/shared/workspace-paths.ts — do not edit by hand.
 * Run: npm run sync:mcp-generated  (also runs inside npm run mcp:build)
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

export interface WorkspaceManifestPaths {
  requirements: string;
  specs: string;
  tests: string;
  testData: string;
  pages: string;
  artifacts: string;
  reports: string;
  testResults: string;
  selectorCatalog: string;
  blobReport: string;
  environments: string;
}

export interface WorkspaceManifestOwnership {
  qa: string[];
  review: string[];
  generated: string[];
  protected: string[];
}

export interface WorkspaceManifest {
  schemaVersion: number;
  paths: WorkspaceManifestPaths;
  ownership: WorkspaceManifestOwnership;
}

export const DEFAULT_WORKSPACE_MANIFEST: WorkspaceManifest = {
  schemaVersion: 1,
  paths: {
    requirements: 'requirements',
    specs: 'specs',
    tests: 'tests',
    testData: 'tests/data',
    pages: 'tests/pages',
    artifacts: 'artifacts',
    reports: 'artifacts/reports',
    testResults: 'artifacts/test-results',
    selectorCatalog: 'artifacts/selector-catalog',
    blobReport: 'artifacts/blob-report',
    environments: 'config/environments',
  },
  ownership: {
    qa: ['requirements/**'],
    review: ['specs/**', 'tests/**'],
    generated: ['artifacts/**'],
    protected: ['src/**', 'tools/**', 'config/**', '.github/agents/**'],
  },
};

const MANIFEST_RELATIVE_PATH = path.join('config', 'qa-kit.workspace.json');
const MAX_PARENT_HOPS = 12;

/**
 * Manifest-presence policy. `strict` throws when the manifest is absent or
 * invalid (MCP server default); `compat` falls back to the default manifest
 * (framework default).
 */
export type WorkspaceManifestMode = 'strict' | 'compat';

/**
 * Finds the repository root by walking up directories looking for
 * config/qa-kit.workspace.json, package.json, or playwright.config.ts.
 */
export function findRepoRoot(startDir: string = process.cwd()): string {
  let current = path.resolve(startDir);
  for (let i = 0; i < MAX_PARENT_HOPS; i++) {
    const manifestPath = path.join(current, MANIFEST_RELATIVE_PATH);
    const pkgPath = path.join(current, 'package.json');
    const playwrightConfigPath = path.join(current, 'playwright.config.ts');
    if (
      fs.existsSync(manifestPath) ||
      fs.existsSync(pkgPath) ||
      fs.existsSync(playwrightConfigPath)
    ) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return path.resolve(startDir);
}

export class WorkspacePathRegistry {
  private readonly _rootDir: string;
  private readonly _mode: WorkspaceManifestMode;
  private _manifest: WorkspaceManifest | null = null;
  private _fallbackWarningEmitted = false;

  constructor(rootDir?: string, mode?: WorkspaceManifestMode) {
    this._rootDir = rootDir ? path.resolve(rootDir) : findRepoRoot();
    this._mode = mode ?? this.resolveMode();
  }

  public get rootDir(): string {
    return this._rootDir;
  }

  public get mode(): WorkspaceManifestMode {
    return this._mode;
  }

  /** Class default when neither the argument nor QA_WORKSPACE_MANIFEST_MODE is set. */
  protected defaultMode(): WorkspaceManifestMode {
    return 'compat';
  }

  private resolveMode(): WorkspaceManifestMode {
    const envMode = process.env.QA_WORKSPACE_MANIFEST_MODE?.toLowerCase();
    if (envMode === 'strict' || envMode === 'compat') return envMode;
    return this.defaultMode();
  }

  public get manifest(): WorkspaceManifest {
    if (!this._manifest) {
      this._manifest = this.loadManifest();
    }
    return this._manifest;
  }

  private loadManifest(): WorkspaceManifest {
    const manifestFile = path.join(this._rootDir, MANIFEST_RELATIVE_PATH);
    if (!fs.existsSync(manifestFile)) {
      if (this._mode === 'strict') {
        throw new Error(
          `WORKSPACE_MANIFEST_MISSING: Workspace manifest "${MANIFEST_RELATIVE_PATH}" is missing in root "${this._rootDir}".`,
        );
      }
      this.warnFallback('Manifest file does not exist');
      return DEFAULT_WORKSPACE_MANIFEST;
    }
    try {
      const raw = fs.readFileSync(manifestFile, 'utf-8');
      const parsed = JSON.parse(raw) as Partial<WorkspaceManifest>;
      if (!parsed.paths || typeof parsed.paths !== 'object') {
        if (this._mode === 'strict') {
          throw new Error(
            `WORKSPACE_MANIFEST_INVALID: Manifest "${MANIFEST_RELATIVE_PATH}" is missing valid paths configuration.`,
          );
        }
        this.warnFallback('Manifest paths object is invalid');
        return DEFAULT_WORKSPACE_MANIFEST;
      }

      const configuredPaths = parsed.paths as Partial<
        Record<keyof WorkspaceManifestPaths, unknown>
      >;
      const paths = Object.fromEntries(
        (Object.keys(DEFAULT_WORKSPACE_MANIFEST.paths) as Array<keyof WorkspaceManifestPaths>).map(
          (key) => [
            key,
            this.normalizeManifestPath(configuredPaths[key], DEFAULT_WORKSPACE_MANIFEST.paths[key]),
          ],
        ),
      ) as unknown as WorkspaceManifestPaths;

      return {
        schemaVersion: parsed.schemaVersion ?? DEFAULT_WORKSPACE_MANIFEST.schemaVersion,
        paths,
        ownership: {
          ...DEFAULT_WORKSPACE_MANIFEST.ownership,
          ...(parsed.ownership ?? {}),
        },
      };
    } catch (err) {
      if (this._mode === 'strict') {
        throw new Error(
          `WORKSPACE_MANIFEST_INVALID: Failed to parse "${MANIFEST_RELATIVE_PATH}": ${err instanceof Error ? err.message : String(err)}`,
          { cause: err },
        );
      }
      this.warnFallback(
        `Manifest parse error: ${err instanceof Error ? err.message : String(err)}`,
      );
      return DEFAULT_WORKSPACE_MANIFEST;
    }
  }

  private warnFallback(reason: string): void {
    if (!this._fallbackWarningEmitted) {
      this._fallbackWarningEmitted = true;
      if (process.env.NODE_ENV !== 'test') {
        process.stderr.write(
          `[WARN] WORKSPACE_MANIFEST_FALLBACK: Using default workspace manifest. Reason: ${reason}\n`,
        );
      }
    }
  }

  /**
   * Manifest paths are workspace-relative by contract. Invalid or escaping
   * values fall back individually instead of allowing a local config file to
   * redirect framework output outside the workspace.
   */
  private normalizeManifestPath(value: unknown, fallback: string): string {
    if (typeof value !== 'string' || value.trim() === '') return fallback;
    const candidate = value.trim().replace(/\\/g, '/');
    if (
      candidate.startsWith('/') ||
      /^[A-Za-z]:\//.test(candidate) ||
      candidate.startsWith('\\\\')
    ) {
      return fallback;
    }
    const resolved = path.resolve(this._rootDir, candidate);
    const relative = path.relative(this._rootDir, resolved);
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      return fallback;
    }
    return relative.replace(/\\/g, '/');
  }

  public toRelative(targetPath: string): string {
    const rootNormalized = this._rootDir.replace(/\\/g, '/').replace(/\/+$/, '');
    const targetNormalized = targetPath.replace(/\\/g, '/');

    if (targetNormalized === rootNormalized) {
      return '';
    }
    if (targetNormalized.startsWith(rootNormalized + '/')) {
      return targetNormalized.slice(rootNormalized.length + 1);
    }
    const abs = path.resolve(this._rootDir, targetNormalized);
    const absNormalized = abs.replace(/\\/g, '/');
    if (absNormalized.startsWith(rootNormalized + '/')) {
      return absNormalized.slice(rootNormalized.length + 1);
    }
    return path.relative(this._rootDir, abs).replace(/\\/g, '/');
  }

  public resolveAbsolute(...pathSegments: string[]): string {
    return path.resolve(this._rootDir, ...pathSegments);
  }

  // Relative path getters (normalized with forward slashes)
  public get requirementsRel(): string {
    return this.manifest.paths.requirements.replace(/\\/g, '/');
  }

  public get specsRel(): string {
    return this.manifest.paths.specs.replace(/\\/g, '/');
  }

  public get testsRel(): string {
    return this.manifest.paths.tests.replace(/\\/g, '/');
  }

  public get testDataRel(): string {
    return this.manifest.paths.testData.replace(/\\/g, '/');
  }

  public get pagesRel(): string {
    return (this.manifest.paths.pages || 'tests/pages').replace(/\\/g, '/');
  }

  public get artifactsRel(): string {
    return this.manifest.paths.artifacts.replace(/\\/g, '/');
  }

  public get reportsRel(): string {
    return this.manifest.paths.reports.replace(/\\/g, '/');
  }

  public get testResultsRel(): string {
    return this.manifest.paths.testResults.replace(/\\/g, '/');
  }

  public get selectorCatalogRel(): string {
    return this.manifest.paths.selectorCatalog.replace(/\\/g, '/');
  }

  public get blobReportRel(): string {
    return this.manifest.paths.blobReport.replace(/\\/g, '/');
  }

  public get environmentsRel(): string {
    return this.manifest.paths.environments.replace(/\\/g, '/');
  }

  // Absolute path getters
  public get requirementsDir(): string {
    return path.resolve(this._rootDir, this.manifest.paths.requirements);
  }

  public get specsDir(): string {
    return path.resolve(this._rootDir, this.manifest.paths.specs);
  }

  public get testsDir(): string {
    return path.resolve(this._rootDir, this.manifest.paths.tests);
  }

  public get testDataDir(): string {
    return path.resolve(this._rootDir, this.manifest.paths.testData);
  }

  public get pagesDir(): string {
    return path.resolve(this._rootDir, this.manifest.paths.pages || 'tests/pages');
  }

  public get artifactsDir(): string {
    return path.resolve(this._rootDir, this.manifest.paths.artifacts);
  }

  public get reportsDir(): string {
    return path.resolve(this._rootDir, this.manifest.paths.reports);
  }

  public get testResultsDir(): string {
    return path.resolve(this._rootDir, this.manifest.paths.testResults);
  }

  public get selectorCatalogDir(): string {
    return path.resolve(this._rootDir, this.manifest.paths.selectorCatalog);
  }

  public get blobReportDir(): string {
    return path.resolve(this._rootDir, this.manifest.paths.blobReport);
  }

  public get environmentsDir(): string {
    return path.resolve(this._rootDir, this.manifest.paths.environments);
  }

  public get ownership(): WorkspaceManifestOwnership {
    return this.manifest.ownership;
  }
}

/**
 * MCP server registry: strict manifest presence by default (the server is
 * launched inside the repository), overridable via `QA_WORKSPACE_MANIFEST_MODE`
 * or an explicit mode argument.
 */
export class McpWorkspacePathRegistry extends WorkspacePathRegistry {
  protected override defaultMode(): WorkspaceManifestMode {
    return 'strict';
  }
}

export const workspace = new WorkspacePathRegistry();

export const mcpWorkspace = new McpWorkspacePathRegistry();

/** Resolve report output while preserving the QA_REPORT_DIR test override. */
export function resolveWorkspaceReportDir(registry: WorkspacePathRegistry = workspace): string {
  const override = process.env['QA_REPORT_DIR'];
  return override ? path.resolve(override) : registry.reportsDir;
}

/** Resolve test-result output from the active workspace manifest. */
export function resolveWorkspaceTestResultsDir(
  registry: WorkspacePathRegistry = workspace,
): string {
  return registry.testResultsDir;
}
