/// <reference types="node" />

// Feature: playwright-ai-agent-framework, Property 1: Test Failure Data Retrieval
// Feature: playwright-ai-agent-framework, Property 11: Requirements to Test Data Transformation

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import fc from 'fast-check';
import { getTestFailures, type TestFailure } from '../../../tools/mcp/src/tools/get-test-failures';
import { findRepoRoot, resolveAllowedPath } from '../../../tools/mcp/src/utils/safety';

function normalizeFailure(item: TestFailure): TestFailure {
  const normalized: TestFailure = {
    testTitle: item.testTitle,
    filePath: item.filePath,
    errorMessage: item.errorMessage,
    duration: item.duration,
  };

  if (typeof item.lineNumber === 'number') {
    normalized.lineNumber = item.lineNumber;
  }

  if (typeof item.stackTrace === 'string') {
    normalized.stackTrace = item.stackTrace;
  }

  return normalized;
}

function createTempResultsDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'playwright-failures-'));
}

function writeFailureFile(resultsDir: string, failures: TestFailure[]): void {
  const payload = { failures: failures.map(normalizeFailure) };
  const filePath = path.join(resultsDir, 'results.json');
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8');
}

function cleanupDir(resultsDir: string): void {
  fs.rmSync(resultsDir, { recursive: true, force: true });
}

const failureArbitrary = fc.record({
  testTitle: fc.string({ minLength: 1, maxLength: 60 }),
  filePath: fc.string({ minLength: 1, maxLength: 80 }),
  errorMessage: fc.string({ minLength: 1, maxLength: 120 }),
  duration: fc.integer({ min: 0, max: 180000 }),
  lineNumber: fc.option(fc.integer({ min: 1, max: 1000 }), { nil: undefined }),
  stackTrace: fc.option(fc.string({ minLength: 1, maxLength: 220 }), { nil: undefined }),
});

async function property1DataRetrieval(): Promise<void> {
  await fc.assert(
    fc.asyncProperty(fc.array(failureArbitrary, { minLength: 1, maxLength: 8 }), async (rows) => {
      const failures = rows.map(normalizeFailure);
      const resultsDir = createTempResultsDir();

      try {
        writeFailureFile(resultsDir, failures);

        const output = getTestFailures(resultsDir);
        assert.equal(output.status, failures.length > 0 ? 'failure' : 'success');
        assert.equal(output.failures.length, failures.length);

        output.failures.forEach((item, index) => {
          assert.equal(item.testTitle, failures[index].testTitle);
          assert.equal(item.filePath, failures[index].filePath);
          assert.equal(item.errorMessage, failures[index].errorMessage);
          assert.equal(item.duration, failures[index].duration);
        });
      } finally {
        cleanupDir(resultsDir);
      }
    }),
    { numRuns: 18 },
  );

  console.log('✓ Property 1 passed: get_test_failures data retrieval');
}

async function property11DataPreservation(): Promise<void> {
  await fc.assert(
    fc.asyncProperty(fc.array(failureArbitrary, { minLength: 1, maxLength: 8 }), async (rows) => {
      const failures = rows.map(normalizeFailure);
      const resultsDir = createTempResultsDir();

      try {
        writeFailureFile(resultsDir, failures);
        const output = getTestFailures(resultsDir);

        assert.equal(output.status, failures.length > 0 ? 'failure' : 'success');
        assert.deepEqual(output.failures, failures);
      } finally {
        cleanupDir(resultsDir);
      }
    }),
    { numRuns: 18 },
  );

  console.log('✓ Property 11 passed: get_test_failures data preservation');
}

function writePlaywrightRetryFixture(resultsDir: string): void {
  const payload = {
    suites: [
      {
        title: 'Retry Suite',
        specs: [
          {
            title: 'flaky test',
            file: 'src/tests/example.spec.ts',
            tests: [
              {
                title: 'should pass on retry',
                location: { file: 'src/tests/example.spec.ts', line: 10 },
                results: [
                  {
                    status: 'failed',
                    retry: 0,
                    duration: 100,
                    error: { message: 'First attempt failed' },
                  },
                  {
                    status: 'passed',
                    retry: 1,
                    duration: 50,
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  };
  fs.writeFileSync(path.join(resultsDir, 'results.json'), JSON.stringify(payload, null, 2), 'utf8');
}

function runRetryRegression(): void {
  const resultsDir = createTempResultsDir();
  try {
    writePlaywrightRetryFixture(resultsDir);
    const output = getTestFailures(resultsDir);
    assert.equal(output.status, 'success', 'retried-then-passed should not be a failure');
    assert.equal(output.failures.length, 0, 'no failures when last attempt passed');
  } finally {
    cleanupDir(resultsDir);
  }
  console.log('✓ Retry regression passed: retried-then-passed tests are not reported as failures');
}

function runAbsolutePathFromMcpServerCwd(): void {
  const repoRoot = findRepoRoot(__dirname);
  const mcpServerDir = path.join(repoRoot, 'tools/mcp');
  const resultsDir = path.join(repoRoot, 'artifacts', 'test-results', `property-cwd-${Date.now()}`);
  const previousCwd = process.cwd();

  fs.mkdirSync(resultsDir, { recursive: true });
  writeFailureFile(resultsDir, [
    {
      testTitle: 'cwd isolation check',
      filePath: 'src/tests/example.spec.ts',
      errorMessage: 'expected failure',
      duration: 42,
    },
  ]);

  try {
    process.chdir(mcpServerDir);
    const relative = path.relative(repoRoot, resultsDir).replace(/\\/g, '/');
    const resolved = resolveAllowedPath(relative, 'test-results', { mustExist: true });
    assert.equal(resolved.ok, true, 'resolveAllowedPath must succeed from mcp-server cwd');
    if (!resolved.ok) return;

    const output = getTestFailures(resolved.absolutePath);
    assert.equal(output.status, 'failure');
    assert.equal(output.failures.length, 1);
    assert.equal(output.failures[0].testTitle, 'cwd isolation check');
  } finally {
    process.chdir(previousCwd);
    fs.rmSync(resultsDir, { recursive: true, force: true });
  }
  console.log('✓ CWD regression passed: absolutePath works when cwd is mcp-server/');
}

function runConfigMappedJsonPriority(): void {
  const repoRoot = findRepoRoot(__dirname);
  const resultsDir = path.join(repoRoot, 'artifacts', 'test-results');
  const stalePath = path.join(resultsDir, 'results.json');
  const adapterPath = path.join(resultsDir, 'adapter-results.json');
  const previousConfig = process.env.PLAYWRIGHT_CONFIG;
  const previousResultsJson = process.env.PLAYWRIGHT_RESULTS_JSON;
  const previousAdapterConfig = process.env.PLAYWRIGHT_ADAPTER_CONFIG;
  const previousAdapterResultsJson = process.env.PLAYWRIGHT_ADAPTER_RESULTS_JSON;

  fs.mkdirSync(resultsDir, { recursive: true });

  const stalePayload = {
    failures: [
      {
        testTitle: 'stale template failure',
        filePath: 'src/tests/stale.spec.ts',
        errorMessage: 'from results.json',
        duration: 1,
      },
    ],
  };
  const adapterPayload = {
    failures: [
      {
        testTitle: 'adapter profile failure',
        filePath: 'tests/ui/smoke/smoke.spec.ts',
        errorMessage: 'from adapter-results.json',
        duration: 2,
      },
    ],
  };

  fs.writeFileSync(stalePath, JSON.stringify(stalePayload, null, 2), 'utf8');
  fs.writeFileSync(adapterPath, JSON.stringify(adapterPayload, null, 2), 'utf8');

  process.env.PLAYWRIGHT_CONFIG = 'packages/my-adapter/playwright.config.ts';
  process.env.PLAYWRIGHT_ADAPTER_CONFIG = 'packages/my-adapter/playwright.config.ts';
  process.env.PLAYWRIGHT_ADAPTER_RESULTS_JSON = 'artifacts/test-results/adapter-results.json';
  delete process.env.PLAYWRIGHT_RESULTS_JSON;

  try {
    const output = getTestFailures(resultsDir);
    assert.equal(output.status, 'failure');
    assert.equal(output.failures.length, 1);
    assert.equal(output.failures[0].testTitle, 'adapter profile failure');
    assert.ok(
      output.sourceFile?.replace(/\\/g, '/').endsWith('adapter-results.json'),
      `expected adapter JSON, got ${output.sourceFile}`,
    );
  } finally {
    if (previousConfig === undefined) {
      delete process.env.PLAYWRIGHT_CONFIG;
    } else {
      process.env.PLAYWRIGHT_CONFIG = previousConfig;
    }
    if (previousResultsJson === undefined) {
      delete process.env.PLAYWRIGHT_RESULTS_JSON;
    } else {
      process.env.PLAYWRIGHT_RESULTS_JSON = previousResultsJson;
    }
    if (previousAdapterConfig === undefined) {
      delete process.env.PLAYWRIGHT_ADAPTER_CONFIG;
    } else {
      process.env.PLAYWRIGHT_ADAPTER_CONFIG = previousAdapterConfig;
    }
    if (previousAdapterResultsJson === undefined) {
      delete process.env.PLAYWRIGHT_ADAPTER_RESULTS_JSON;
    } else {
      process.env.PLAYWRIGHT_ADAPTER_RESULTS_JSON = previousAdapterResultsJson;
    }
    fs.rmSync(stalePath, { force: true });
    fs.rmSync(adapterPath, { force: true });
  }

  console.log(
    '✓ Config-mapped JSON priority: adapter profile picks adapter JSON over stale results.json',
  );
}

async function main(): Promise<void> {
  runRetryRegression();
  runAbsolutePathFromMcpServerCwd();
  runConfigMappedJsonPriority();
  await property1DataRetrieval();
  await property11DataPreservation();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
