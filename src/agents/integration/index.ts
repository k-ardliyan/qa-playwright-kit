/**
 * Agent AI Integration Layer — Barrel Export
 *
 * Universal interface between the QA Playwright Kit pipeline
 * and multiple AI coding assistants.
 *
 * @module agents/integration
 */

// Shared type definitions
export type {
  PipelinePhase,
  ProtocolError,
  PhaseResult,
  OrchestrationModeDescriptor,
} from './types';

// Pipeline Event Hook System
export type { EventType, PipelineEvent, HookCallback, HookRegistry } from './hooks';
export { PipelineHookRegistry, fileLoggerHook } from './hooks';

// Pipeline State Manager
export type { PipelineState } from './state';
export { saveState, loadState, archiveState, resumeState, markCompleted } from './state';

// Capability Manifest Generator
export type {
  CapabilityManifest,
  PhaseCapability,
  ToolDescriptor,
  JsonSchemaObject,
  Prerequisites,
} from './manifest';
export { generateManifest, writeManifest, MANIFEST_VERSION, MANIFEST_FILENAME } from './manifest';

// Cross-Platform MCP Config Generator
export type {
  McpServerDefinition,
  Platform,
  ConfigGeneratorOptions,
  DriftResult,
} from './mcp-config-generator';
export {
  readSourceConfig,
  computeSourceHash,
  transformCopilot,
  transformClaude,
  transformCursor,
  transformKiro,
  getOutputPath,
  generateConfig,
  detectDrift,
  ALL_PLATFORMS,
} from './mcp-config-generator';

// Agent Instruction Validator
export type {
  ValidationResult,
  ValidationError,
  ValidationWarning,
  ValidatorOptions,
} from './validator';
export {
  validateAgents,
  validateAgentFile,
  fixAgentFile,
  getExitCode,
  getValidServerNames,
  getValidToolNames,
  extractToolNamesFromRegistry,
} from './validator';

// Protocol Handler
export type {
  AgentProtocolRequest,
  AgentProtocolResponse,
  ProtocolAction,
  ValidationResult as ProtocolValidationResult,
} from './protocol';
export {
  validateRequest,
  createSuccessResponse,
  createErrorResponse,
  createInProgressResponse,
  handleProtocolRequest,
  VALID_ACTIONS,
  VALID_PHASES,
} from './protocol';

// Orchestrator Engine
export type { OrchestratorConfig, PhaseExecutor } from './orchestrator';
export { Orchestrator } from './orchestrator';
