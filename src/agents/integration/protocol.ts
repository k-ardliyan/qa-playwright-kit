/**
 * LEGACY — superseded oleh src/agents/integration (WorkflowController, commit 0d3baaa)
 * dan tools/mcp. Konsumen hanya test (property/unit). JANGAN diperluas; keputusan hapus
 * menunggu tanpa regresi.
 *
 * Universal Agent Protocol — Barrel Entry Point
 *
 * Defines the JSON-based interface contract for all AI client interactions
 * with the QA Playwright Kit pipeline.
 *
 * @module agents/integration/protocol
 */

import type { CapabilityManifest } from './manifest';
import type { PhaseExecutor } from './orchestrator';

export type { CapabilityManifest, PhaseExecutor };

export * from './protocol-validation';
export * from './protocol-handlers';
