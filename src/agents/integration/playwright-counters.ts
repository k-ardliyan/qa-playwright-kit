/** Parse Playwright's JSON reporter into current-run counters. */
export interface PlaywrightRunCounters {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  timedOut: number;
  interrupted: number;
  resultsJsonPath: string;
}

export interface ParsePlaywrightJsonOptions {
  /** When true (default: true), tests inside auth.setup.ts suites are excluded from feature counters. */
  ignoreSetup?: boolean;
}

export function parsePlaywrightJsonReport(
  value: unknown,
  resultsJsonPath: string,
  options?: ParsePlaywrightJsonOptions,
): PlaywrightRunCounters {
  const ignoreSetup = options?.ignoreSetup ?? true;
  const counters = {
    total: 0,
    passed: 0,
    failed: 0,
    skipped: 0,
    timedOut: 0,
    interrupted: 0,
    resultsJsonPath,
  };
  const isSetupSuite = (suite: Record<string, unknown>): boolean => {
    const title = typeof suite.title === 'string' ? suite.title : '';
    const file = typeof suite.file === 'string' ? suite.file : '';
    return /auth\.setup\.ts$/i.test(title) || /auth\.setup\.ts$/i.test(file);
  };

  const visitSuite = (suite: unknown): void => {
    if (!suite || typeof suite !== 'object') return;
    const record = suite as Record<string, unknown>;
    if (ignoreSetup && isSetupSuite(record)) {
      return;
    }
    if (Array.isArray(record.specs)) {
      for (const spec of record.specs) {
        if (!spec || typeof spec !== 'object') continue;
        const tests = (spec as Record<string, unknown>).tests;
        if (!Array.isArray(tests)) continue;
        for (const test of tests) {
          if (!test || typeof test !== 'object') continue;
          const t = test as Record<string, unknown>;
          const testStatus = t.status;
          const lastResult =
            Array.isArray(t.results) && t.results.length > 0
              ? (t.results[t.results.length - 1] as Record<string, unknown>)
              : undefined;
          const outcomeStatus = lastResult?.status ?? testStatus;

          counters.total += 1;
          if (outcomeStatus === 'passed' || testStatus === 'expected') counters.passed += 1;
          else if (outcomeStatus === 'skipped' || testStatus === 'skipped') counters.skipped += 1;
          else if (outcomeStatus === 'timedOut') counters.timedOut += 1;
          else if (outcomeStatus === 'interrupted') counters.interrupted += 1;
          else counters.failed += 1;
        }
      }
    }
    if (Array.isArray(record.suites)) {
      for (const child of record.suites) visitSuite(child);
    }
  };
  const root = value as Record<string, unknown>;
  if (Array.isArray(root.suites)) {
    for (const suite of root.suites) visitSuite(suite);
  }
  return counters;
}
