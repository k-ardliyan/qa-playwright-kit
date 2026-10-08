/**
 * Runtime seed-config loader — bridges the project seed registry into the
 * Playwright process.
 *
 * The seed-graph runtime (`seed-graph.ts`) deliberately takes its graph as a
 * parameter so it stays pure and testable. This module is the piece that reads
 * the project's registry off disk and converts it into that graph, so a spec
 * does not have to hand-copy endpoints.
 *
 * The registry shape and the registry→graph conversion live in
 * `@/shared/mcp/seed-registry-core` — the same module the MCP package
 * twin-syncs — so the two sides cannot drift apart.
 *
 * Safety: the registry path is resolved through the workspace registry, not a
 * hardcoded absolute path, and producers are API-only (no shell, no eval).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { workspace } from '@/shared/workspace-paths';
import {
  SEED_REGISTRY_RELATIVE_PATH,
  parseSeedRegistry,
  toSeedProducers,
} from '@/shared/mcp/seed-registry-core';
import type { SeedGraph } from './seed-graph';

export { SEED_REGISTRY_RELATIVE_PATH };

/**
 * Convert a parsed registry document into producer specs.
 *
 * Accepts arbitrary JSON (that is what a file read produces) and validates it
 * through the shared parser, so the runtime and the MCP tooling agree on what
 * counts as a registry and which entries are executable. A prose-only or
 * malformed registry yields an empty graph rather than a crash.
 */
export function toSeedGraph(registry: unknown): SeedGraph {
  return { producers: toSeedProducers(parseSeedRegistry(registry)) };
}

/**
 * Read the project seed registry from the workspace root and return its graph.
 *
 * Missing, unreadable, or malformed registries all yield an EMPTY graph rather
 * than throwing: most workspaces have not declared seeds yet, and a spec that
 * needs one still fails loudly at `materializeSeeds` with a name-specific
 * message. Failing at import time would break every unrelated spec.
 */
export function loadSeedGraph(rootDir: string = workspace.rootDir): SeedGraph {
  const registryPath = path.join(rootDir, SEED_REGISTRY_RELATIVE_PATH);
  if (!fs.existsSync(registryPath)) return { producers: [] };
  try {
    return toSeedGraph(JSON.parse(fs.readFileSync(registryPath, 'utf-8')));
  } catch {
    return { producers: [] };
  }
}
