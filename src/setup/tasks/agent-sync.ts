/**
 * Setup task — reconcile agent skills + MCP client configs with the repo.
 *
 * Extracted from wizard.ts (Fase 2 dekomposisi). Pure pass-through to
 * agent-sync; the orchestrator only renders the result.
 *
 * @module src/setup/tasks/agent-sync
 */

import { syncAgentSkillsAndMcp, type AgentSyncResult } from '../agent-sync';

/** Sync agent skills + MCP configs for the detected clients under repoRoot. */
export function syncAgentArtifacts(repoRoot: string): AgentSyncResult {
  return syncAgentSkillsAndMcp(repoRoot);
}
