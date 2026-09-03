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
 * Finds the repository root by walking up directories looking for
 * config/qa-kit.workspace.json, playwright.config.ts, or package.json.
 */
export function findRepoRoot(startDir: string = process.cwd()): string {
  let current = path.resolve(startDir);
  for (let i = 0; i < MAX_PARENT_HOPS; i++) {
    const manifestPath = path.join(current, MANIFEST_RELATIVE_PATH);
    const pkgPath = path.join(current, 'package.json');
    if (fs.existsSync(manifestPath) || fs.existsSync(pkgPath)) {
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
  private _manifest: WorkspaceManifest | null = null;

  constructor(rootDir?: string) {
    this._rootDir = rootDir ? path.resolve(rootDir) : findRepoRoot();
  }

  public get rootDir(): string {
    return this._rootDir;
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
      return DEFAULT_WORKSPACE_MANIFEST;
    }
    try {
      const raw = fs.readFileSync(manifestFile, 'utf-8');
      const parsed = JSON.parse(raw) as Partial<WorkspaceManifest>;
      if (!parsed.paths || typeof parsed.paths !== 'object') {
        return DEFAULT_WORKSPACE_MANIFEST;
      }
      return {
        schemaVersion: parsed.schemaVersion ?? DEFAULT_WORKSPACE_MANIFEST.schemaVersion,
        paths: {
          ...DEFAULT_WORKSPACE_MANIFEST.paths,
          ...parsed.paths,
        },
        ownership: {
          ...DEFAULT_WORKSPACE_MANIFEST.ownership,
          ...(parsed.ownership ?? {}),
        },
      };
    } catch {
      return DEFAULT_WORKSPACE_MANIFEST;
    }
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

export const workspace = new WorkspacePathRegistry();
