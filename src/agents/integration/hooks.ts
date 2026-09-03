/**
 * Pipeline Event Hook System
 *
 * Provides an event emitter for pipeline lifecycle observability.
 * Hooks do not block pipeline execution — errors in hook callbacks
 * are logged but do not halt the pipeline.
 *
 * @module agents/integration/hooks
 */

import * as fs from 'fs';
import * as path from 'path';
import { PipelinePhase } from './types';

/**
 * Event types emitted during pipeline phase lifecycle.
 */
export type EventType = 'phase:start' | 'phase:complete' | 'phase:error';

/**
 * Structured event emitted at pipeline phase transitions.
 */
export interface PipelineEvent {
  eventType: EventType;
  runId: string;
  phase: PipelinePhase;
  timestamp: string;
  duration?: number; // ms, only on phase:complete
  input?: unknown; // only on phase:start
  output?: unknown; // only on phase:complete
  errorMessage?: string; // only on phase:error
  retryable?: boolean; // only on phase:error
}

/**
 * Callback function invoked when a matching event is emitted.
 */
export type HookCallback = (event: PipelineEvent) => void | Promise<void>;

/**
 * Registry interface for managing pipeline event hooks.
 */
export interface HookRegistry {
  registerHook(eventType: EventType, callback: HookCallback): void;
  removeHook(eventType: EventType, callback: HookCallback): void;
  emit(event: PipelineEvent): Promise<void>;
}

/**
 * Default output path for the file logger hook.
 * Lazily resolved so QA_REPORT_DIR overrides (test isolation) are honored.
 */
function eventsFilePath(): string {
  return process.env['QA_REPORT_DIR']
    ? path.resolve(process.env['QA_REPORT_DIR'], 'pipeline-events.jsonl')
    : path.resolve('reports/pipeline-events.jsonl');
}

/**
 * Built-in file logger hook that appends JSON lines to reports/pipeline-events.jsonl
 * (or `<QA_REPORT_DIR>/pipeline-events.jsonl` when that env var is set).
 *
 * Each event is serialized as a single JSON line and appended to the file.
 * The parent directory is created if it does not exist.
 */
export function fileLoggerHook(event: PipelineEvent): void {
  const eventsPath = eventsFilePath();
  const dir = path.dirname(eventsPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const line = JSON.stringify(event) + '\n';
  fs.appendFileSync(eventsPath, line, 'utf-8');
}

/**
 * Implementation of the HookRegistry interface.
 *
 * Stores registered hooks in a Map keyed by EventType.
 * The built-in fileLoggerHook is always active as a default —
 * it fires even when no custom hooks are registered for an event type.
 */
export class PipelineHookRegistry implements HookRegistry {
  private hooks: Map<EventType, HookCallback[]> = new Map();

  /**
   * Register a hook callback for a specific event type.
   */
  registerHook(eventType: EventType, callback: HookCallback): void {
    const existing = this.hooks.get(eventType) || [];
    existing.push(callback);
    this.hooks.set(eventType, existing);
  }

  /**
   * Remove a previously registered hook callback for a specific event type.
   * If the callback is not found, this is a no-op.
   */
  removeHook(eventType: EventType, callback: HookCallback): void {
    const existing = this.hooks.get(eventType);
    if (!existing) return;
    const index = existing.indexOf(callback);
    if (index !== -1) {
      existing.splice(index, 1);
    }
  }

  /**
   * Emit a pipeline event to all registered hooks for the event type.
   *
   * The built-in fileLoggerHook always fires first (default behavior).
   * Then all custom registered hooks are invoked.
   *
   * Error isolation: each hook callback is wrapped in a try/catch.
   * Errors are logged to console.error but never propagate to the caller.
   */
  async emit(event: PipelineEvent): Promise<void> {
    // Always fire the built-in file logger hook first
    try {
      await fileLoggerHook(event);
    } catch (err) {
      console.error(`[hook-error] ${event.eventType} (fileLoggerHook):`, err);
    }

    // Fire all custom registered hooks for this event type
    for (const callback of this.getHooks(event.eventType)) {
      try {
        await callback(event);
      } catch (err) {
        console.error(`[hook-error] ${event.eventType}:`, err);
      }
    }
  }

  /**
   * Get all registered hooks for a specific event type.
   */
  private getHooks(eventType: EventType): HookCallback[] {
    return this.hooks.get(eventType) || [];
  }
}
