/**
 * Orchestrator Engine — Automatic Pipeline Execution
 *
 * Coordinates sequential phase execution in automatic mode.
 * Implements retry logic, error handling, dry run mode,
 * and manual single-phase execution.
 *
 * @module agents/integration/orchestrator
 */

import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { computeSourceHash } from '@/contracts';
import { PipelinePhase, ProtocolError, PhaseResult } from './types';
import { HookRegistry, PipelineEvent, EventType } from './hooks';
import { PipelineState, saveState } from './state';
import { AgentProtocolResponse, createSuccessResponse, createErrorResponse } from './protocol';

// Re-export PhaseResult from types for consumers importing from orchestrator
export type { PhaseResult } from './types';

/**
 * Ordered sequence of pipeline phases for automatic execution.
 */
const PHASE_SEQUENCE: PipelinePhase[] = ['plan', 'generate', 'execute', 'heal', 'report'];

/**
 * Stamp the source requirement hash at run start so resume staleness checks
 * work from the first resume (resumeState() only compares when a hash exists).
 * Missing/unreadable requirement files leave the hash unset — staleness stays
 * undetectable, matching the previous lenient behavior.
 */
function stampRequirementHash(requirementPath: string | undefined): string | undefined {
  if (!requirementPath) return undefined;
  const reqAbs = path.resolve(requirementPath);
  if (!fs.existsSync(reqAbs)) return undefined;
  try {
    return computeSourceHash(fs.readFileSync(reqAbs, 'utf-8'));
  } catch {
    return undefined;
  }
}

/**
 * Configuration for the orchestrator engine.
 */
export interface OrchestratorConfig {
  orchestrationMode: 'manual' | 'automatic';
  requirementPath: string;
  dryRun?: boolean;
  runId?: string; // provided for resume
}

/**
 * Dependency injection point for MCP tool calls.
 * Each phase is executed through this interface.
 */
export interface PhaseExecutor {
  execute(phase: PipelinePhase, input: unknown): Promise<PhaseResult>;
}

/**
 * Orchestrator Engine class.
 *
 * In automatic mode, executes all phases sequentially (plan → generate → execute → heal → report).
 * In manual mode, provides `runPhase()` for single-phase execution.
 *
 * Emits phase lifecycle events via the hook system and implements retry logic
 * for retryable errors with skip-to-report on non-retryable failures.
 */
export class Orchestrator {
  private state: PipelineState;

  constructor(
    private config: OrchestratorConfig,
    private executor: PhaseExecutor,
    private hooks: HookRegistry,
    initialState?: PipelineState,
  ) {
    const runId = config.runId || initialState?.runId || randomUUID();
    const now = new Date().toISOString();

    this.state = initialState
      ? {
          ...initialState,
          status: 'running',
          timestamp: now,
          errors: [...(initialState.errors || [])],
        }
      : {
          runId,
          status: 'running',
          currentPhase: null,
          completedPhases: [],
          artifacts: { plan: [], generate: [], execute: [], heal: [], report: [] },
          timestamp: now,
          startedAt: now,
          requirementPath: config.requirementPath,
          requirementHash: stampRequirementHash(config.requirementPath),
          orchestrationMode: config.orchestrationMode,
          errors: [],
        };
  }

  /**
   * Run the full pipeline in automatic mode.
   *
   * Executes all phases sequentially, emitting events for each transition.
   * If `dryRun` is enabled, simulates all phases without calling the executor.
   *
   * @returns The final AgentProtocolResponse with the report result.
   */
  async run(): Promise<AgentProtocolResponse> {
    if (this.config.dryRun) {
      return this.runDryRun();
    }

    let lastResult: PhaseResult | undefined;

    for (const phase of PHASE_SEQUENCE) {
      if (this.state.completedPhases.includes(phase)) {
        continue;
      }

      const input = this.getPhaseInput(phase, lastResult);

      // Emit phase:start event
      await this.emitEvent('phase:start', phase, { input });

      const startTime = Date.now();
      let result: PhaseResult;

      try {
        result = await this.executor.execute(phase, input);
      } catch (err) {
        // Unexpected error — treat as non-retryable
        const error: ProtocolError = {
          code: 'PHASE_EXECUTION_ERROR',
          message: err instanceof Error ? err.message : String(err),
          phase,
          retryable: false,
        };
        result = { phase, status: 'error', error };
      }

      if (result.status === 'success') {
        const duration = Date.now() - startTime;
        await this.emitEvent('phase:complete', phase, { output: result.output, duration });
        this.markPhaseCompleted(phase, result);
        lastResult = result;
        continue;
      }

      // Handle error
      const phaseError = result.error || {
        code: 'UNKNOWN_ERROR',
        message: `Phase '${phase}' failed without error details.`,
        phase,
        retryable: false,
      };

      await this.emitEvent('phase:error', phase, {
        errorMessage: phaseError.message,
        retryable: phaseError.retryable,
      });

      if (phaseError.retryable) {
        // Retry once
        const retryResult = await this.retryPhase(phase, input, startTime);

        if (retryResult.status === 'success') {
          const duration = Date.now() - startTime;
          await this.emitEvent('phase:complete', phase, { output: retryResult.output, duration });
          this.markPhaseCompleted(phase, retryResult);
          lastResult = retryResult;
          continue;
        }

        // Retry failed — record error and skip to report
        const retryError = retryResult.error || phaseError;
        this.state.errors.push(retryError);
        saveState(this.state);

        return this.skipToReport(retryError, lastResult);
      }

      // Non-retryable error — skip to report
      this.state.errors.push(phaseError);
      saveState(this.state);

      return this.skipToReport(phaseError, lastResult);
    }

    // All phases completed successfully
    this.state.status = 'completed';
    saveState(this.state);

    return createSuccessResponse('all', lastResult);
  }

  /**
   * Execute a single phase in manual mode.
   *
   * @param phase - The phase to execute
   * @param input - Input data for the phase
   * @returns The phase result
   */
  async runPhase(phase: PipelinePhase, input: unknown): Promise<PhaseResult> {
    await this.emitEvent('phase:start', phase, { input });

    const startTime = Date.now();
    let result: PhaseResult;

    try {
      result = await this.executor.execute(phase, input);
    } catch (err) {
      const error: ProtocolError = {
        code: 'PHASE_EXECUTION_ERROR',
        message: err instanceof Error ? err.message : String(err),
        phase,
        retryable: false,
      };
      result = { phase, status: 'error', error };
    }

    if (result.status === 'success') {
      const duration = Date.now() - startTime;
      await this.emitEvent('phase:complete', phase, { output: result.output, duration });
      this.markPhaseCompleted(phase, result);
    } else {
      const phaseError = result.error || {
        code: 'UNKNOWN_ERROR',
        message: `Phase '${phase}' failed.`,
        phase,
        retryable: false,
      };
      await this.emitEvent('phase:error', phase, {
        errorMessage: phaseError.message,
        retryable: phaseError.retryable,
      });
      this.state.errors.push(phaseError);
      saveState(this.state);
    }

    return result;
  }

  /**
   * Get the current pipeline state.
   */
  getState(): PipelineState {
    return this.state;
  }

  /**
   * Run in dry run mode: simulate all phase transitions without executing tools.
   */
  private async runDryRun(): Promise<AgentProtocolResponse> {
    const phasesExecuted: string[] = [];

    for (const phase of PHASE_SEQUENCE) {
      const input = { requirementPath: this.config.requirementPath, dryRun: true };

      // Emit phase:start event
      await this.emitEvent('phase:start', phase, { input });

      // Create mock result without calling executor
      const mockResult: PhaseResult = {
        phase,
        status: 'success',
        output: { dryRun: true, phase, message: `Phase '${phase}' would be executed.` },
        artifacts: [],
      };

      // Emit phase:complete event
      await this.emitEvent('phase:complete', phase, { output: mockResult.output, duration: 0 });

      this.markPhaseCompleted(phase, mockResult);
      phasesExecuted.push(phase);
    }

    this.state.status = 'completed';
    saveState(this.state);

    const dryRunReport: PhaseResult = {
      phase: 'report',
      status: 'success',
      output: {
        dryRun: true,
        phasesSimulated: phasesExecuted,
        requirementPath: this.config.requirementPath,
        message: 'Dry run completed. No MCP tools were invoked.',
      },
    };

    return createSuccessResponse('all', dryRunReport);
  }

  /**
   * Retry a phase once after a retryable error.
   */
  private async retryPhase(
    phase: PipelinePhase,
    input: unknown,
    _startTime: number,
  ): Promise<PhaseResult> {
    try {
      return await this.executor.execute(phase, input);
    } catch (err) {
      const error: ProtocolError = {
        code: 'PHASE_RETRY_FAILED',
        message: err instanceof Error ? err.message : String(err),
        phase,
        retryable: false,
      };
      return { phase, status: 'error', error };
    }
  }

  /**
   * Skip remaining phases and execute the report phase with failure details.
   */
  private async skipToReport(
    failureError: ProtocolError,
    lastResult: PhaseResult | undefined,
  ): Promise<AgentProtocolResponse> {
    const reportPhase: PipelinePhase = 'report';

    // If report phase is already completed (shouldn't happen normally), just return error
    if (this.state.completedPhases.includes(reportPhase)) {
      this.state.status = 'failed';
      saveState(this.state);
      return createErrorResponse([failureError], 'all');
    }

    const reportInput = {
      failureDetails: failureError,
      completedPhases: [...this.state.completedPhases],
      lastOutput: lastResult?.output,
    };

    // Emit phase:start for report
    await this.emitEvent('phase:start', reportPhase, { input: reportInput });

    const startTime = Date.now();
    let reportResult: PhaseResult;

    try {
      reportResult = await this.executor.execute(reportPhase, reportInput);
    } catch {
      // Report phase itself failed — return the original error
      this.state.status = 'failed';
      saveState(this.state);
      return createErrorResponse([failureError], 'all');
    }

    if (reportResult.status === 'success') {
      const duration = Date.now() - startTime;
      await this.emitEvent('phase:complete', reportPhase, {
        output: reportResult.output,
        duration,
      });
      this.markPhaseCompleted(reportPhase, reportResult);
    } else {
      await this.emitEvent('phase:error', reportPhase, {
        errorMessage: reportResult.error?.message || 'Report phase failed.',
        retryable: false,
      });
    }

    this.state.status = 'failed';
    saveState(this.state);

    return createSuccessResponse('all', reportResult);
  }

  /**
   * Mark a phase as completed in the pipeline state.
   */
  private markPhaseCompleted(phase: PipelinePhase, result: PhaseResult): void {
    this.state.currentPhase = phase;
    if (!this.state.completedPhases.includes(phase)) {
      this.state.completedPhases.push(phase);
    }
    if (result.artifacts) {
      this.state.artifacts[phase] = result.artifacts;
    }
    saveState(this.state);
  }

  /**
   * Get the input for a phase based on the previous phase result.
   */
  private getPhaseInput(phase: PipelinePhase, lastResult: PhaseResult | undefined): unknown {
    if (phase === 'plan') {
      return { requirementPath: this.config.requirementPath };
    }
    return lastResult?.output ?? {};
  }

  /**
   * Emit a pipeline event through the hook registry.
   */
  private async emitEvent(
    eventType: EventType,
    phase: PipelinePhase,
    data: {
      input?: unknown;
      output?: unknown;
      duration?: number;
      errorMessage?: string;
      retryable?: boolean;
    },
  ): Promise<void> {
    const event: PipelineEvent = {
      eventType,
      runId: this.state.runId,
      phase,
      timestamp: new Date().toISOString(),
      ...(data.input !== undefined && { input: data.input }),
      ...(data.output !== undefined && { output: data.output }),
      ...(data.duration !== undefined && { duration: data.duration }),
      ...(data.errorMessage !== undefined && { errorMessage: data.errorMessage }),
      ...(data.retryable !== undefined && { retryable: data.retryable }),
    };

    await this.hooks.emit(event);
  }
}
