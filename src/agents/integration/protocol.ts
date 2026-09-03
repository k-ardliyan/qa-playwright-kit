/**
 * Universal Agent Protocol — Request/Response types and validation
 *
 * Defines the JSON-based interface contract for all AI client interactions
 * with the QA Playwright Kit pipeline.
 *
 * @module agents/integration/protocol
 */

import type { PipelinePhase, ProtocolError, PhaseResult } from './types';
import type { CapabilityManifest } from './manifest';
import { generateManifest } from './manifest';
import { Orchestrator, OrchestratorConfig, PhaseExecutor } from './orchestrator';
import { PipelineHookRegistry } from './hooks';
import { resumeState } from './state';

export type { CapabilityManifest, PhaseExecutor };

/**
 * Valid protocol actions.
 */
export const VALID_ACTIONS = ['invoke', 'query', 'resume'] as const;
export type ProtocolAction = (typeof VALID_ACTIONS)[number];

/**
 * Valid pipeline phases.
 */
export const VALID_PHASES: PipelinePhase[] = ['plan', 'generate', 'execute', 'heal', 'report'];

/**
 * Protocol request sent by any AI client to interact with the pipeline.
 */
export interface AgentProtocolRequest {
  action: ProtocolAction;
  phase?: PipelinePhase;
  requirementPath?: string;
  options?: {
    orchestrationMode?: 'manual' | 'automatic';
    resume?: boolean;
    runId?: string;
    dryRun?: boolean;
  };
}

/**
 * Protocol response returned to the AI client.
 */
export interface AgentProtocolResponse {
  status: 'success' | 'error' | 'in-progress';
  phase: PipelinePhase | 'all';
  result?: PhaseResult;
  errors?: ProtocolError[];
  manifest?: CapabilityManifest;
}

/**
 * Validation result: either a validated request or an error response.
 */
export type ValidationResult =
  { valid: true; request: AgentProtocolRequest } | { valid: false; error: AgentProtocolResponse };

/**
 * Validates an incoming protocol request.
 *
 * Checks:
 * 1. Request is a non-null object
 * 2. `action` is one of 'invoke', 'query', 'resume'
 * 3. For 'invoke': `phase` and `requirementPath` are required
 * 4. For 'resume': `options.runId` is required
 * 5. `phase` (if provided) is a valid PipelinePhase
 * 6. Defaults `options.orchestrationMode` to 'manual' when omitted
 *
 * @param request - The raw request object to validate
 * @returns ValidationResult with either the validated request or an error response
 */
export function validateRequest(request: unknown): ValidationResult {
  // Check request is a non-null object
  if (request === null || typeof request !== 'object') {
    return {
      valid: false,
      error: createErrorResponse([
        {
          code: 'SCHEMA_VIOLATION',
          message: 'Request must be a non-null object.',
          retryable: false,
        },
      ]),
    };
  }

  const req = request as Record<string, unknown>;

  // Validate action field
  const action = req.action;
  if (!action || typeof action !== 'string' || !VALID_ACTIONS.includes(action as ProtocolAction)) {
    return {
      valid: false,
      error: createErrorResponse([
        {
          code: 'INVALID_ACTION',
          message: `Unrecognized action: '${String(action ?? '')}'. Valid actions are: ${VALID_ACTIONS.join(', ')}.`,
          retryable: false,
        },
      ]),
    };
  }

  const typedAction = action as ProtocolAction;

  // Validate phase if provided
  if (req.phase !== undefined) {
    if (typeof req.phase !== 'string' || !VALID_PHASES.includes(req.phase as PipelinePhase)) {
      return {
        valid: false,
        error: createErrorResponse([
          {
            code: 'INVALID_PHASE',
            message: `Unrecognized phase: '${String(req.phase)}'. Valid phases are: ${VALID_PHASES.join(', ')}.`,
            retryable: false,
          },
        ]),
      };
    }
  }

  // Conditional validation for 'invoke' action
  if (typedAction === 'invoke') {
    const errors: ProtocolError[] = [];

    if (!req.phase || typeof req.phase !== 'string') {
      errors.push({
        code: 'SCHEMA_VIOLATION',
        message: "Action 'invoke' requires a 'phase' field.",
        retryable: false,
      });
    }

    if (!req.requirementPath || typeof req.requirementPath !== 'string') {
      errors.push({
        code: 'SCHEMA_VIOLATION',
        message: "Action 'invoke' requires a 'requirementPath' field.",
        retryable: false,
      });
    }

    if (errors.length > 0) {
      return { valid: false, error: createErrorResponse(errors) };
    }
  }

  // Conditional validation for 'resume' action
  if (typedAction === 'resume') {
    const options = req.options as Record<string, unknown> | undefined;
    if (
      !options ||
      typeof options !== 'object' ||
      !options.runId ||
      typeof options.runId !== 'string'
    ) {
      return {
        valid: false,
        error: createErrorResponse([
          {
            code: 'SCHEMA_VIOLATION',
            message: "Action 'resume' requires 'options.runId' field.",
            retryable: false,
          },
        ]),
      };
    }
  }

  // Build validated request with defaults applied
  const options = (req.options as Record<string, unknown> | undefined) ?? {};
  const validatedRequest: AgentProtocolRequest = {
    action: typedAction,
    ...(req.phase !== undefined && { phase: req.phase as PipelinePhase }),
    ...(req.requirementPath !== undefined && { requirementPath: req.requirementPath as string }),
    options: {
      orchestrationMode: (options.orchestrationMode as 'manual' | 'automatic') ?? 'manual',
      ...(options.resume !== undefined && { resume: options.resume as boolean }),
      ...(options.runId !== undefined && { runId: options.runId as string }),
      ...(options.dryRun !== undefined && { dryRun: options.dryRun as boolean }),
    },
  };

  return { valid: true, request: validatedRequest };
}

/**
 * Creates a success response for a completed phase.
 */
export function createSuccessResponse(
  phase: PipelinePhase | 'all',
  result?: PhaseResult,
): AgentProtocolResponse {
  return {
    status: 'success',
    phase,
    ...(result !== undefined && { result }),
  };
}

/**
 * Creates an error response with one or more protocol errors.
 */
export function createErrorResponse(
  errors: ProtocolError[],
  phase?: PipelinePhase | 'all',
): AgentProtocolResponse {
  return {
    status: 'error',
    phase: phase ?? 'all',
    errors,
  };
}

/**
 * Creates an in-progress response for a currently executing phase.
 */
export function createInProgressResponse(phase: PipelinePhase | 'all'): AgentProtocolResponse {
  return {
    status: 'in-progress',
    phase,
  };
}

// ─── Protocol Handler Routing ────────────────────────────────────────────────

/**
 * Handle a `query` action by returning the capability manifest.
 */
async function handleQuery(): Promise<AgentProtocolResponse> {
  const manifest = generateManifest();
  return {
    ...createSuccessResponse('all'),
    manifest,
  };
}

/**
 * Handle an `invoke` action by creating an Orchestrator and running the pipeline.
 *
 * - In automatic mode: runs the full pipeline sequentially.
 * - In manual mode: runs the specified phase only.
 */
async function handleInvoke(
  req: AgentProtocolRequest,
  executor: PhaseExecutor,
): Promise<AgentProtocolResponse> {
  const hooks = new PipelineHookRegistry();

  const config: OrchestratorConfig = {
    orchestrationMode: req.options?.orchestrationMode ?? 'manual',
    requirementPath: req.requirementPath!,
    dryRun: req.options?.dryRun ?? false,
  };

  const orchestrator = new Orchestrator(config, executor, hooks);

  if (config.orchestrationMode === 'automatic') {
    return orchestrator.run();
  }

  // Manual mode: run a single phase
  const result = await orchestrator.runPhase(req.phase!, {
    requirementPath: req.requirementPath,
  });

  if (result.status === 'success') {
    return createSuccessResponse(req.phase!, result);
  }

  return createErrorResponse(
    [
      result.error || {
        code: 'PHASE_EXECUTION_ERROR',
        message: `Phase '${req.phase}' failed.`,
        phase: req.phase,
        retryable: false,
      },
    ],
    req.phase,
  );
}

/**
 * Handle a `resume` action by loading persisted state and resuming the pipeline.
 */
async function handleResume(
  req: AgentProtocolRequest,
  executor: PhaseExecutor,
): Promise<AgentProtocolResponse> {
  const resumeResult = resumeState();

  if ('error' in resumeResult) {
    return createErrorResponse([
      {
        code: 'NO_RESUMABLE_RUN',
        message: resumeResult.error,
        retryable: false,
      },
    ]);
  }

  const { state, resumePhase } = resumeResult;
  const hooks = new PipelineHookRegistry();

  const config: OrchestratorConfig = {
    orchestrationMode: state.orchestrationMode,
    requirementPath: state.requirementPath,
    runId: state.runId,
  };

  const orchestrator = new Orchestrator(config, executor, hooks, state);

  // Run from the resume point
  if (config.orchestrationMode === 'automatic') {
    return orchestrator.run();
  }

  // Manual mode: run the next phase
  const result = await orchestrator.runPhase(resumePhase, {
    requirementPath: state.requirementPath,
  });

  if (result.status === 'success') {
    return createSuccessResponse(resumePhase, result);
  }

  return createErrorResponse(
    [
      result.error || {
        code: 'PHASE_EXECUTION_ERROR',
        message: `Phase '${resumePhase}' failed.`,
        phase: resumePhase,
        retryable: false,
      },
    ],
    resumePhase,
  );
}

/**
 * Handle an incoming protocol request by routing to the appropriate handler.
 *
 * - `query` → returns the capability manifest
 * - `invoke` → creates an Orchestrator and runs the specified phase (manual) or full pipeline (automatic)
 * - `resume` → loads state and resumes the pipeline from last checkpoint
 *
 * @param request - Raw request object (validated internally)
 * @param executor - PhaseExecutor for MCP tool calls (dependency injection)
 * @returns The protocol response
 */
export async function handleProtocolRequest(
  request: unknown,
  executor: PhaseExecutor,
): Promise<AgentProtocolResponse> {
  // 1. Validate the request
  const validation = validateRequest(request);
  if (!validation.valid) {
    return validation.error;
  }
  const req = validation.request;

  // 2. Route based on action
  switch (req.action) {
    case 'query':
      return handleQuery();
    case 'invoke':
      return handleInvoke(req, executor);
    case 'resume':
      return handleResume(req, executor);
  }
}
