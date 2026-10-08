import type { PlaywrightTestConfig, Project } from '@playwright/test';
import { devices } from '@playwright/test';

/**
 * Shared Playwright execution policy for template core and Reference Adapter.
 * Forks merge this file from upstream, then override testDir / projects / reporter paths locally.
 *
 * Call buildPlaywrightSharedDefaults() only after loadEnvironment() in each config entry file.
 */

function warnConfig(message: string): void {
  console.warn(`[playwright.config] ${message}`);
}

/** Parse SLOW_MO from process.env. CI always returns 0. */
export function resolveSlowMo(): number {
  if (process.env.CI) {
    return 0;
  }

  const raw = process.env.SLOW_MO?.trim();
  if (raw === undefined || raw === '') {
    return 0;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    warnConfig(`Invalid SLOW_MO='${raw}'. Falling back to 0.`);
    return 0;
  }

  return parsed;
}

/** Parse HEADLESS from process.env (default true). */
export function resolveHeadless(): boolean {
  const raw = process.env.HEADLESS?.trim();
  if (raw === undefined || raw === '') {
    return true;
  }

  const normalized = raw.toLowerCase();
  if (normalized === 'true' || normalized === '1' || normalized === 'yes') {
    return true;
  }
  if (normalized === 'false' || normalized === '0' || normalized === 'no') {
    return false;
  }

  warnConfig(`Invalid HEADLESS='${raw}'. Falling back to true.`);
  return true;
}

/**
 * Desktop viewport for every project — Full HD (1920×1080) by default, the most
 * common desktop resolution (~28%, StatCounter 2026) so wide dashboards/tables
 * render as real users see them; also the least-clipping baseline. Override per
 * machine/env with `QA_VIEWPORT=WIDTHxHEIGHT` (e.g. `QA_VIEWPORT=1600x900`);
 * invalid values warn and fall back to the FHD default.
 */
export const DEFAULT_VIEWPORT = { width: 1920, height: 1080 } as const;

export function resolveViewport(): { width: number; height: number } {
  const raw = process.env.QA_VIEWPORT?.trim();
  if (!raw) return { ...DEFAULT_VIEWPORT };
  const m = /^(\d+)x(\d+)$/i.exec(raw);
  if (!m) {
    warnConfig(`Invalid QA_VIEWPORT='${raw}'. Expected WIDTHxHEIGHT. Falling back to default.`);
    return { ...DEFAULT_VIEWPORT };
  }
  const width = Number.parseInt(m[1], 10);
  const height = Number.parseInt(m[2], 10);
  if (width < 320 || height < 240) {
    warnConfig(`QA_VIEWPORT='${raw}' too small. Falling back to default.`);
    return { ...DEFAULT_VIEWPORT };
  }
  return { width, height };
}

/**
 * Desktop viewport override to spread AFTER a `devices[...]` spread — device
 * descriptors carry their own 1280×720 viewport, so a bare shared default would
 * be clobbered. Mobile configs must NOT use this (they need the device viewport).
 */
export function desktopViewportUse(): { viewport: { width: number; height: number } } {
  return { viewport: resolveViewport() };
}

export function buildPlaywrightSharedDefaults(): Partial<PlaywrightTestConfig> {
  return {
    fullyParallel: true,
    retries: process.env.CI ? 2 : 0,
    retryStrategy: 'isolated',
    workers: process.env.CI ? 1 : undefined,
    timeout: 30_000,
    expect: {
      timeout: 10_000,
    },
    use: {
      baseURL: process.env.BASE_URL || 'http://localhost:3000',
      headless: resolveHeadless(),
      viewport: resolveViewport(),
      launchOptions: {
        slowMo: resolveSlowMo(),
      },
      trace: {
        mode: 'on-first-retry',
        snapshots: {
          dom: true,
          aria: true,
          screen: true,
        },
      },
      screenshot: 'only-on-failure',
      video: 'retain-on-failure',
    },
  };
}

export function createFrameworkReporters(options: {
  jsonOutput: string;
  htmlFolder: string;
  customReporterPath: string;
  /**
   * When true (typically CI + shard), append Playwright `blob` reporter so
   * shards can be merged with `npx playwright merge-reports`.
   * Default false keeps the stable 4-reporter tuple for local/property tests.
   */
  includeBlob?: boolean;
  /** Blob output directory (default: `blob-report`). */
  blobOutputDir?: string;
}): PlaywrightTestConfig['reporter'] {
  const reporters: NonNullable<PlaywrightTestConfig['reporter']> = [
    ['list'],
    ['json', { outputFile: options.jsonOutput }],
    ['html', { outputFolder: options.htmlFolder, open: 'never' }],
    [options.customReporterPath],
  ];

  if (options.includeBlob) {
    reporters.push(['blob', { outputDir: options.blobOutputDir ?? 'artifacts/blob-report' }]);
  }

  return reporters;
}

/**
 * Browser target type supported by the multi-browser executor.
 */
export type ConfigBrowserTarget = 'chromium' | 'firefox' | 'webkit';

/**
 * Options for building multi-browser project definitions.
 */
export interface MultiBrowserProjectOptions {
  /** Test directory for all browser projects */
  testDir?: string;
  /** Test match pattern */
  testMatch?: string;
  /** Test ignore patterns */
  testIgnore?: string[];
  /** Storage state to apply to all browser projects */
  storageState?: { cookies: unknown[]; origins: unknown[] };
}

/**
 * Builds a Firefox project definition compatible with Playwright config.
 *
 * @param options - Project customization options
 * @returns A Playwright project definition for Firefox
 */
export function buildFirefoxProject(options?: MultiBrowserProjectOptions): Project {
  return {
    name: 'firefox',
    use: {
      ...devices['Desktop Firefox'],
      ...desktopViewportUse(),
      ...(options?.storageState ? { storageState: options.storageState } : {}),
    },
    ...(options?.testDir ? { testDir: options.testDir } : {}),
    ...(options?.testMatch ? { testMatch: options.testMatch } : {}),
    ...(options?.testIgnore ? { testIgnore: options.testIgnore } : {}),
  };
}

/**
 * Builds a WebKit project definition compatible with Playwright config.
 *
 * @param options - Project customization options
 * @returns A Playwright project definition for WebKit
 */
export function buildWebkitProject(options?: MultiBrowserProjectOptions): Project {
  return {
    name: 'webkit',
    use: {
      ...devices['Desktop Safari'],
      ...desktopViewportUse(),
      ...(options?.storageState ? { storageState: options.storageState } : {}),
    },
    ...(options?.testDir ? { testDir: options.testDir } : {}),
    ...(options?.testMatch ? { testMatch: options.testMatch } : {}),
    ...(options?.testIgnore ? { testIgnore: options.testIgnore } : {}),
  };
}

/**
 * Builds all multi-browser project definitions (chromium, firefox, webkit).
 * Each project uses the standard device emulation from Playwright's device list.
 *
 * @param options - Shared project customization options applied to all browsers
 * @returns Array of Playwright project definitions for chromium, firefox, and webkit
 */
export function buildMultiBrowserProjects(options?: MultiBrowserProjectOptions): Project[] {
  const storageState = options?.storageState ?? { cookies: [], origins: [] };
  const commonProps = {
    ...(options?.testDir ? { testDir: options.testDir } : {}),
    ...(options?.testMatch ? { testMatch: options.testMatch } : {}),
    ...(options?.testIgnore ? { testIgnore: options.testIgnore } : {}),
  };

  return [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        ...desktopViewportUse(),
        storageState,
      },
      ...commonProps,
    },
    buildFirefoxProject({ ...options, storageState }),
    buildWebkitProject({ ...options, storageState }),
  ];
}
