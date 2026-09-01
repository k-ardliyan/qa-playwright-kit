import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { streamTelemetryEvent, readTelemetryStream } from '../../support/streaming/live-telemetry';

test.describe('Live Telemetry JSONL Stream', () => {
  const tempStreamPath = path.resolve(
    process.cwd(),
    'artifacts',
    'test-results',
    '__test_telemetry.jsonl',
  );

  test.afterAll(() => {
    if (fs.existsSync(tempStreamPath)) {
      try {
        fs.unlinkSync(tempStreamPath);
      } catch {
        // ignore cleanup error
      }
    }
  });

  test('records and reads live telemetry stream line-by-line', () => {
    streamTelemetryEvent({ type: 'RUN_START', status: 'started' }, tempStreamPath);
    streamTelemetryEvent(
      { type: 'STEP_START', testId: 'T1', stepTitle: 'Open login page' },
      tempStreamPath,
    );
    streamTelemetryEvent(
      { type: 'STEP_END', testId: 'T1', stepTitle: 'Open login page', durationMs: 150 },
      tempStreamPath,
    );
    streamTelemetryEvent(
      { type: 'TEST_END', testId: 'T1', status: 'passed', durationMs: 200 },
      tempStreamPath,
    );

    const events = readTelemetryStream(tempStreamPath);
    expect(events.length).toBe(4);
    expect(events[0].type).toBe('RUN_START');
    expect(events[1].stepTitle).toBe('Open login page');
    expect(events[2].durationMs).toBe(150);
    expect(events[3].status).toBe('passed');
  });
});
