import * as fs from 'node:fs';
import * as path from 'node:path';
import { mcpWorkspace } from './workspace-paths';
import {
  SEED_REGISTRY_RELATIVE_PATH,
  parseSeedRegistry,
  type SeedRegistryFile,
} from './seed-registry-core';

/**
 * Seed registry LOADER — the per-project answer to "does `seed:<entity>.<state>`
 * exist, and what produces it?".
 *
 * The registry shape, the canonical path constant, and the registry→graph
 * conversion live in `seed-registry-core` (twin-synced from
 * `src/shared/mcp/seed-registry-core.ts`) so the MCP tooling and the Playwright
 * runtime cannot drift apart. This module only adds the disk read.
 *
 * The registry is a PER-PROJECT artifact (shipped as
 * `config/qa-kit.seeds.example.json` — copy and adapt). The framework ships NO
 * registry: an absent file means every seed behavior is inert, so existing QA
 * workspaces never get new noise. When present, `validate_plan` cross-checks
 * scenario `seed:` refs against it (PLAN_SEED_UNKNOWN) and `list_seeds`
 * surfaces it to the agent.
 */

export type { SeedProducerSpec, SeedRegistryEntry, SeedRegistryFile } from './seed-registry-core';
export {
  SEED_REGISTRY_RELATIVE_PATH,
  hasExecutableProducer,
  parseSeedRegistry,
  toSeedProducers,
} from './seed-registry-core';

export type SeedRegistryLoad =
  | { ok: true; registry: SeedRegistryFile; registryPath: string }
  | { ok: false; reason: 'missing' | 'invalid'; detail?: string; registryPath: string };

/** Collect every `seed:<name>` ref from text, without the prefix. */
export function extractSeedRefs(text: string): string[] {
  const out: string[] = [];
  for (const match of text.matchAll(/\bseed:\s*([a-z][\w.-]*)/gi)) {
    const name = match[1];
    if (name && !out.includes(name)) out.push(name);
  }
  return out;
}

/**
 * Load the seed registry from `<rootDir>/config/qa-kit.seeds.json`.
 * Tolerant by design: missing file → `missing`; unreadable/invalid → `invalid`.
 * Callers treat both as "no registry" — seed checks stay silent.
 */
export function loadSeedRegistry(rootDir: string = mcpWorkspace.rootDir): SeedRegistryLoad {
  const registryPath = path.join(rootDir, SEED_REGISTRY_RELATIVE_PATH);
  if (!fs.existsSync(registryPath)) {
    return { ok: false, reason: 'missing', registryPath };
  }
  try {
    const registry = parseSeedRegistry(JSON.parse(fs.readFileSync(registryPath, 'utf-8')));
    if (!registry) {
      return {
        ok: false,
        reason: 'invalid',
        detail: 'Expected { "schemaVersion": 1, "seeds": [{ "name": "..." }] }.',
        registryPath,
      };
    }
    return { ok: true, registry, registryPath };
  } catch (error) {
    return {
      ok: false,
      reason: 'invalid',
      detail: error instanceof Error ? error.message : 'unreadable JSON',
      registryPath,
    };
  }
}

/** Seed names declared by the registry (empty when no valid registry). */
export function knownSeedNames(registry: SeedRegistryFile | null): string[] {
  return registry ? registry.seeds.map((s) => s.name) : [];
}
