/**
 * LEGACY — superseded oleh src/agents/integration (WorkflowController, commit 0d3baaa)
 * dan tools/mcp. Konsumen hanya test (property/unit). JANGAN diperluas; keputusan hapus
 * menunggu tanpa regresi.
 *
 * Universal Agent Protocol — Action Handlers and Protocol Request Router
 *
 * @module agents/integration/protocol-handlers
 */

import { generateManifest } from './manifest';
import { Orchestrator, OrchestratorConfig, PhaseExecutor } from './orchestrator';
import { PipelineHookRegistry } from './hooks';
import { loadState, resumeState } from './state';
import {
  WorkflowController,
  type WorkflowAdapters,
  type WorkflowResponse,
} from './workflow-controller';
import {
  type AgentProtocolRequest,
  type AgentProtocolResponse,
  createSuccessResponse,
  createErrorResponse,
  validateRequest,
} from './protocol-validation';

/**
 * Handle a `query` action by returning the capability manifest.
 */
export async function handleQuery(): Promise<AgentProtocolResponse> {
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
export async function handleInvoke(
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
export async function handleResume(
  req: AgentProtocolRequest,
  executor: PhaseExecutor,
): Promise<AgentProtocolResponse> {
  const resumeResult = resumeState(req.options?.runId);

  if ('error' in resumeResult) {
    return createErrorResponse([
      {
        code: resumeResult.code ?? 'NO_RESUMABLE_RUN',
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
  const result = await orchestrator.runPhase(
    resumePhase,
    orchestrator.getResumePhaseInput(resumePhase),
  );

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
 * Handle a `run` action by driving the native semantic workflow.
 *
 * The semantic path requires a WorkflowAdapters implementation; without one
 * the request fails closed with an actionable error rather than silently
 * falling back to an unenforced prompt flow.
 */
export async function handleRun(
  req: AgentProtocolRequest,
  adapters?: WorkflowAdapters,
): Promise<WorkflowResponse> {
  const requestedRunId = req.options?.runId;
  const requirementPath = req.requirementPath!;
  const orchestrationMode = req.options?.orchestrationMode ?? 'manual';

  if (!adapters) {
    return {
      status: 'error',
      runId: requestedRunId ?? '',
      workflowStage: null,
      workflowStatus: 'blocked',
      phase: 'all',
      errors: [
        {
          code: 'WORKFLOW_ADAPTERS_REQUIRED',
          message:
            "Action 'run' requires the native workflow adapters. The MCP runtime must wire snapshot_page/discover_pages/compile/validate/generate/execute adapters before semantic runs are available.",
          retryable: false,
        },
      ],
      nextRequiredAction: 'Wire the WorkflowAdapters implementation into the MCP runtime.',
    };
  }

  let initialState: import('./state').PipelineState | undefined;
  if (req.options?.resume === true) {
    try {
      // Load first so the explicit runId is bound to the same persisted run
      // before resumeState performs freshness and artifact invalidation.
      const loaded = loadState();
      if (!loaded) {
        return {
          status: 'error',
          runId: requestedRunId ?? '',
          workflowStage: null,
          workflowStatus: 'blocked',
          phase: 'all',
          errors: [
            {
              code: 'NO_RESUMABLE_RUN',
              message: 'No resumable pipeline run found.',
              retryable: false,
            },
          ],
        };
      }
      if (requestedRunId !== loaded.runId) {
        return {
          status: 'error',
          runId: requestedRunId ?? '',
          workflowStage: null,
          workflowStatus: 'blocked',
          phase: 'all',
          errors: [
            {
              code: 'RUN_ID_MISMATCH',
              message: `Requested runId '${requestedRunId}' does not match the resumable run '${loaded.runId}'.`,
              retryable: false,
            },
          ],
        };
      }
      const resumed = resumeState(requestedRunId);
      if ('error' in resumed) {
        return {
          status: 'error',
          runId: requestedRunId ?? '',
          workflowStage: null,
          workflowStatus: 'blocked',
          phase: 'all',
          errors: [
            {
              code: resumed.code ?? 'NO_RESUMABLE_RUN',
              message: resumed.error,
              retryable: false,
            },
          ],
        };
      }
      if (
        resumed.state.requirementPath.replace(/\\/g, '/') !== requirementPath.replace(/\\/g, '/')
      ) {
        return {
          status: 'error',
          runId: resumed.state.runId,
          workflowStage: null,
          workflowStatus: 'blocked',
          phase: 'all',
          errors: [
            {
              code: 'RESUME_REQUIREMENT_MISMATCH',
              message: 'The requested requirementPath does not match the persisted semantic run.',
              retryable: false,
            },
          ],
        };
      }
      if (resumed.state.workflow?.mode !== 'semantic-v1') {
        return {
          status: 'error',
          runId: resumed.state.runId,
          workflowStage: null,
          workflowStatus: 'blocked',
          phase: 'all',
          errors: [
            {
              code: 'RESUME_NOT_SEMANTIC',
              message: 'Persisted state is not a native semantic run (qa.workflow/v1).',
              retryable: false,
            },
          ],
        };
      }
      initialState = resumed.state;
    } catch (error) {
      return {
        status: 'error',
        runId: requestedRunId ?? '',
        workflowStage: null,
        workflowStatus: 'blocked',
        phase: 'all',
        errors: [
          {
            code: 'RESUME_STATE_ERROR',
            message: error instanceof Error ? error.message : String(error),
            retryable: false,
          },
        ],
      };
    }
  }

  const controller = new WorkflowController(
    {
      orchestrationMode,
      requirementPath,
      ...(requestedRunId !== undefined ? { runId: requestedRunId } : {}),
    },
    adapters,
    initialState,
  );

  const input = {
    requirementPath,
    orchestrationMode,
    roleFilter: req.options?.roleFilter,
    ...(req.options?.resume === true ? { resume: true } : {}),
  };
  if (req.stage) return controller.runStage(req.stage, input);
  return controller.run(input);
}

/**
 * Handle an `incoming` protocol request by routing to the appropriate handler.
 *
 * - `query` → returns the capability manifest
 * - `invoke` → creates an Orchestrator and runs the specified phase (manual) or full pipeline (automatic)
 * - `resume` → loads state and resumes the pipeline from last checkpoint
 * - `run` → native semantic workflow (Explore → Model → Challenge → Generate → Validate)
 *
 * @param request - Raw request object (validated internally)
 * @param executor - PhaseExecutor for the physical compatibility path
 * @param adapters - WorkflowAdapters for the native semantic path (required for action `run`)
 * @returns The protocol response
 */
export async function handleProtocolRequest(
  request: unknown,
  executor: PhaseExecutor,
): Promise<AgentProtocolResponse>;
export async function handleProtocolRequest(
  request: unknown,
  executor: PhaseExecutor,
  adapters: WorkflowAdapters,
): Promise<AgentProtocolResponse | WorkflowResponse>;
export async function handleProtocolRequest(
  request: unknown,
  executor: PhaseExecutor,
  adapters?: WorkflowAdapters,
): Promise<AgentProtocolResponse | WorkflowResponse> {
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
    case 'run':
      return handleRun(req, adapters);
  }
}
