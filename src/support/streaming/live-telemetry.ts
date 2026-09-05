import * as fs from 'fs';
import * as path from 'path';

export interface LiveTelemetryEvent {
  type: 'RUN_START' | 'TEST_START' | 'STEP_START' | 'STEP_END' | 'TEST_END' | 'RUN_END';
  testId?: string;
  testTitle?: string;
  stepTitle?: string;
  stepSubtitle?: string;
  status?: string;
  durationMs?: number;
  error?: string;
  timestamp: string;
}

const DEFAULT_STREAM_PATH = path.resolve(
  process.cwd(),
  'artifacts',
  'test-results',
  'live-stream.jsonl',
);

/**
 * Appends a telemetry event synchronously to an NDJSON/JSONL file.
 * This guarantees write-ahead logging even during sudden CI container aborts / OOM.
 */
export function streamTelemetryEvent(
  event: Omit<LiveTelemetryEvent, 'timestamp'>,
  customPath?: string,
): void {
  try {
    const filePath = customPath || DEFAULT_STREAM_PATH;
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const payload: LiveTelemetryEvent = {
      ...event,
      timestamp: new Date().toISOString(),
    };

    fs.appendFileSync(filePath, JSON.stringify(payload) + '\n', 'utf-8');
  } catch {
    // Non-blocking write fallback
  }
}

/**
 * Reads and parses recorded telemetry stream lines into structured events.
 */
export function readTelemetryStream(customPath?: string): LiveTelemetryEvent[] {
  const filePath = customPath || DEFAULT_STREAM_PATH;
  if (!fs.existsSync(filePath)) return [];

  const raw = fs.readFileSync(filePath, 'utf-8');
  return raw
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      try {
        return JSON.parse(line) as LiveTelemetryEvent;
      } catch {
        return null;
      }
    })
    .filter((event): event is LiveTelemetryEvent => event !== null);
}
