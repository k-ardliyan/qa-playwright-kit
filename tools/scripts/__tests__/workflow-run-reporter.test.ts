/// <reference types="node" />

/**
 * Guard for the semantic Validate runner's reporter wiring.
 *
 * Regression this locks: `--reporter` is OVERWRITE, not append — passing it
 * twice (custom + json) silently dropped the CustomReporter, so semantic runs
 * never refreshed artifacts/reports/{custom-dashboard.html,test-summary.json}.
 * The JSON reporter must be attached with `--add-reporter=json`.
 */

import { test, expect } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';

const DRIVER_SOURCE = fs.readFileSync(path.resolve(__dirname, '..', 'workflow-run.ts'), 'utf-8');

test.describe('workflow-run reporter wiring', () => {
  test('uses --add-reporter for json so CustomReporter stays attached', () => {
    expect(DRIVER_SOURCE).toContain('--add-reporter=json');
    // A second `--reporter=` flag would overwrite the custom reporter.
    const reporterFlags = DRIVER_SOURCE.match(/['"`]--reporter=/g) ?? [];
    expect(reporterFlags).toHaveLength(1);
  });

  test('json output path is delivered through the documented env var', () => {
    expect(DRIVER_SOURCE).toContain('PLAYWRIGHT_JSON_OUTPUT_FILE');
  });
});
