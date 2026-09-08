/**
 * LEGACY — superseded oleh src/agents/integration (WorkflowController, commit 0d3baaa)
 * dan tools/mcp. Konsumen hanya test (property/unit). JANGAN diperluas; keputusan hapus
 * menunggu tanpa regresi.
 *
 * Universal Agent Protocol — Request/Response validation and response creators.
 *
 * @module agents/integration/protocol-validation
 */

import * as path from 'node:path';
import {
  WORKFLOW_STAGES,
  type PipelinePhase,
  type ProtocolError,
  type PhaseResult,
  type WorkflowStage,
} from './types';
import type { CapabilityManifest } from './manifest';

/**
 * Valid protocol actions.
 */
export const VALID_ACTIONS = ['invoke', 'query', 'resume', 'run'] as const;
export type ProtocolAction = (typeof VALID_ACTIONS)[number];

/**
 * Valid pipeline phases.
 */
export const VALID_PHASES: PipelinePhase[] = ['plan', 'generate', 'execute', 'heal', 'report'];
export const VALID_WORKFLOWS = ['semantic-v1', 'physical-compat'] as const;
export const VALID_ORCHESTRATION_MODES = ['manual', 'automatic'] as const;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function isSafeRequirementPath(value: unknown): value is string {
  if (!isNonEmptyString(value) || value.includes('\0')) return false;
  const normalized = value.replace(/\\/g, '/');
  return (
    !path.isAbsolute(value) &&
    !path.win32.isAbsolute(value) &&
    normalized.startsWith('requirements/') &&
    normalized.endsWith('.md') &&
    !normalized.split('/').some((segment) => segment === '..')
  );
}

export function isSafeRunId(value: unknown): value is string {
  return (
    isNonEmptyString(value) && value.length <= 128 && /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(value)
  );
}

/**
 * Protocol request sent by any AI client to interact with the pipeline.
 */
export interface AgentProtocolRequest {
  action: ProtocolAction;
  phase?: PipelinePhase;
  /** Semantic stage for action `run` (manual mode). Omit to run all stages. */
  stage?: WorkflowStage;
  workflow?: 'semantic-v1' | 'physical-compat';
  requirementPath?: string;
  options?: {
    orchestrationMode?: 'manual' | 'automatic';
    resume?: boolean;
    runId?: string;
    dryRun?: boolean;
    roleFilter?: string[];
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
  | { valid: true; request: AgentProtocolRequest }
  | { valid: false; error: AgentProtocolResponse };

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

/**
 * Validates an incoming protocol request.
 *
 * Checks:
 * 1. Request is a non-null object
 * 2. `action` is one of 'invoke', 'query', 'resume', 'run'
 * 3. Incompatible field guards (action 'run' vs phase, 'resume' vs options, etc.)
 * 4. Conditional validation per action
 *
 * @param request - The raw request object to validate
 * @returns ValidationResult with either the validated request or an error response
 */
export function validateRequest(request: unknown): ValidationResult {
  // Check request is a non-null object
  if (!isRecord(request)) {
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

  const req = request;
  const errors: ProtocolError[] = [];
  const options = req.options;

  if (req.options !== undefined && !isRecord(req.options)) {
    errors.push({
      code: 'SCHEMA_VIOLATION',
      message: "Field 'options' must be an object.",
      retryable: false,
    });
  }
  if (
    req.workflow !== undefined &&
    !VALID_WORKFLOWS.includes(req.workflow as (typeof VALID_WORKFLOWS)[number])
  ) {
    errors.push({
      code: 'INVALID_WORKFLOW',
      message: `Unrecognized workflow: '${String(req.workflow)}'. Valid workflows are: ${VALID_WORKFLOWS.join(', ')}.`,
      retryable: false,
    });
  }
  if (req.requirementPath !== undefined && !isSafeRequirementPath(req.requirementPath)) {
    errors.push({
      code: 'INVALID_REQUIREMENT_PATH',
      message: 'requirementPath must be a non-empty requirements/*.md path without traversal.',
      retryable: false,
    });
  }
  if (
    req.stage !== undefined &&
    (!isNonEmptyString(req.stage) || !(WORKFLOW_STAGES as readonly string[]).includes(req.stage))
  ) {
    errors.push({
      code: 'INVALID_STAGE',
      message: `Unrecognized stage: '${String(req.stage)}'. Valid stages are: ${WORKFLOW_STAGES.join(', ')}.`,
      retryable: false,
    });
  }
  if (isRecord(options)) {
    if (
      options.orchestrationMode !== undefined &&
      !VALID_ORCHESTRATION_MODES.includes(
        options.orchestrationMode as (typeof VALID_ORCHESTRATION_MODES)[number],
      )
    ) {
      errors.push({
        code: 'INVALID_ORCHESTRATION_MODE',
        message: 'options.orchestrationMode must be manual or automatic.',
        retryable: false,
      });
    }
    for (const key of ['resume', 'dryRun'] as const) {
      if (options[key] !== undefined && typeof options[key] !== 'boolean') {
        errors.push({
          code: 'SCHEMA_VIOLATION',
          message: `options.${key} must be a boolean.`,
          retryable: false,
        });
      }
    }
    if (options.runId !== undefined && !isSafeRunId(options.runId)) {
      errors.push({
        code: 'INVALID_RUN_ID',
        message: 'options.runId must be a safe non-empty identifier.',
        retryable: false,
      });
    }
    if (
      options.roleFilter !== undefined &&
      (!Array.isArray(options.roleFilter) ||
        options.roleFilter.length === 0 ||
        !options.roleFilter.every(isNonEmptyString))
    ) {
      errors.push({
        code: 'SCHEMA_VIOLATION',
        message: 'options.roleFilter must be a non-empty array of non-empty strings.',
        retryable: false,
      });
    }
  }
  if (errors.length > 0) return { valid: false, error: createErrorResponse(errors) };

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

  if (typedAction === 'run' && req.phase !== undefined) {
    errors.push({
      code: 'INCOMPATIBLE_FIELD',
      message: "Action 'run' accepts semantic 'stage', not physical 'phase'.",
      retryable: false,
    });
  }
  if (typedAction !== 'run' && req.stage !== undefined) {
    errors.push({
      code: 'INCOMPATIBLE_FIELD',
      message: `Action '${typedAction}' accepts no semantic 'stage' field.`,
      retryable: false,
    });
  }
  if (typedAction === 'invoke' && req.workflow === 'semantic-v1') {
    errors.push({
      code: 'INCOMPATIBLE_WORKFLOW',
      message: "Physical action 'invoke' cannot use workflow 'semantic-v1'.",
      retryable: false,
    });
  }
  if (typedAction === 'run' && req.workflow === 'physical-compat') {
    errors.push({
      code: 'INCOMPATIBLE_WORKFLOW',
      message: "Semantic action 'run' cannot use workflow 'physical-compat'.",
      retryable: false,
    });
  }
  if (
    typedAction === 'query' &&
    (req.phase !== undefined ||
      req.stage !== undefined ||
      req.workflow !== undefined ||
      req.requirementPath !== undefined ||
      req.options !== undefined)
  ) {
    errors.push({
      code: 'INCOMPATIBLE_FIELD',
      message: "Action 'query' does not accept pipeline fields or options.",
      retryable: false,
    });
  }
  if (
    typedAction === 'resume' &&
    (req.phase !== undefined ||
      req.stage !== undefined ||
      req.workflow !== undefined ||
      req.requirementPath !== undefined)
  ) {
    errors.push({
      code: 'INCOMPATIBLE_FIELD',
      message:
        "Action 'resume' only accepts options.runId; do not provide phase, stage, workflow, or requirementPath.",
      retryable: false,
    });
  }
  if (typedAction === 'resume' && isRecord(options)) {
    for (const key of ['orchestrationMode', 'resume', 'dryRun', 'roleFilter'] as const) {
      if (options[key] !== undefined) {
        errors.push({
          code: 'INCOMPATIBLE_FIELD',
          message: `Action 'resume' does not accept options.${key}; persisted run settings are authoritative.`,
          retryable: false,
        });
      }
    }
  }
  if (typedAction === 'invoke' && isRecord(options)) {
    if (options.resume !== undefined || options.runId !== undefined) {
      errors.push({
        code: 'INCOMPATIBLE_FIELD',
        message:
          "Physical action 'invoke' cannot use options.resume or options.runId; use action 'resume'.",
        retryable: false,
      });
    }
  }
  if (typedAction === 'run' && isRecord(options) && options.dryRun !== undefined) {
    errors.push({
      code: 'INCOMPATIBLE_FIELD',
      message: "Semantic action 'run' does not support options.dryRun.",
      retryable: false,
    });
  }

  if (errors.length > 0) return { valid: false, error: createErrorResponse(errors) };

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

    if (!isNonEmptyString(req.requirementPath)) {
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

  // Conditional validation for 'run' action (native semantic workflow)
  if (typedAction === 'run') {
    const errors: ProtocolError[] = [];

    if (!isNonEmptyString(req.requirementPath)) {
      errors.push({
        code: 'SCHEMA_VIOLATION',
        message: "Action 'run' requires a 'requirementPath' field.",
        retryable: false,
      });
    }

    if (req.stage !== undefined) {
      const validStages = WORKFLOW_STAGES;
      if (
        typeof req.stage !== 'string' ||
        !(validStages as readonly string[]).includes(req.stage)
      ) {
        errors.push({
          code: 'INVALID_STAGE',
          message: `Unrecognized stage: '${String(req.stage)}'. Valid stages are: ${validStages.join(', ')}.`,
          retryable: false,
        });
      }
    }

    if (errors.length > 0) {
      return { valid: false, error: createErrorResponse(errors) };
    }
  }

  // Conditional validation for 'resume' action
  if (typedAction === 'resume' && (!isRecord(options) || !isSafeRunId(options.runId))) {
    return {
      valid: false,
      error: createErrorResponse([
        {
          code: 'SCHEMA_VIOLATION',
          message: "Action 'resume' requires a safe 'options.runId' field.",
          retryable: false,
        },
      ]),
    };
  }

  // Build validated request with defaults applied
  const validatedOptions = isRecord(options) ? options : {};
  const validatedRequest: AgentProtocolRequest = {
    action: typedAction,
    ...(req.phase !== undefined && { phase: req.phase as PipelinePhase }),
    ...(req.stage !== undefined && { stage: req.stage as WorkflowStage }),
    ...(req.workflow !== undefined && {
      workflow: req.workflow as 'semantic-v1' | 'physical-compat',
    }),
    ...(req.requirementPath !== undefined && { requirementPath: req.requirementPath as string }),
    options: {
      orchestrationMode: (validatedOptions.orchestrationMode as 'manual' | 'automatic') ?? 'manual',
      ...(validatedOptions.resume !== undefined && { resume: validatedOptions.resume as boolean }),
      ...(validatedOptions.runId !== undefined && { runId: validatedOptions.runId as string }),
      ...(validatedOptions.dryRun !== undefined && { dryRun: validatedOptions.dryRun as boolean }),
      ...(validatedOptions.roleFilter !== undefined && {
        roleFilter: validatedOptions.roleFilter as string[],
      }),
    },
  };

  return { valid: true, request: validatedRequest };
}
