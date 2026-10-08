/**
 * AUTO-SYNCED from src/shared/mcp/seed-registry-core.ts — do not edit by hand.
 * Run: npm run sync:mcp-generated  (also runs inside npm run mcp:build)
 */

/**
 * Seed registry contract — shared by the root workspace and the MCP package.
 *
 * Playwright-free pure helpers so this module can be twin-synced into
 * `tools/mcp/src/utils/` (see sync-mcp-generated.ts). It owns the registry
 * shape, the canonical path constant, and the registry→graph conversion, so
 * the MCP tooling and the Playwright runtime cannot drift apart.
 *
 * @module shared/mcp/seed-registry-core
 */
import * as path from 'node:path';

/** Canonical registry location, relative to the workspace root. */
export const SEED_REGISTRY_RELATIVE_PATH = path.join('config', 'qa-kit.seeds.json');

export interface SeedProducerSpec {
  name: string;
  endpoint: string;
  cleanupEndpoint: string;
  dependsOn?: string[];
  payload?: Record<string, unknown>;
  idField?: string;
}

export interface SeedRegistryEntry {
  /** Seed ref name WITHOUT the `seed:` prefix — e.g. `payroll.draft`. */
  name: string;
  /** How the seed is produced (API endpoint + state, DB fixture, UI path). */
  producer?: string;
  /** Optional fixture file backing the seed state. */
  fixture?: string;
  notes?: string;
  /**
   * Executable producer description. When present, the seed-graph runtime can
   * materialize this record and tear it down in reverse dependency order.
   * Producers are API-only by design: no shell/eval, no hand-read tokens.
   */
  create?: {
    /** POST endpoint that creates the record. */
    endpoint: string;
    /** DELETE endpoint with `{id}` placeholder. */
    cleanupEndpoint: string;
    /**
     * Parent seed names that must exist first. Child payloads reference parent
     * IDs with `{parent.<seed>.id}` so the runtime can substitute them.
     */
    dependsOn?: string[];
    /** JSON body to POST. */
    payload?: Record<string, unknown>;
    /** Response field holding the created ID. Default `id`. */
    idField?: string;
  };
  /** Entity this seed represents (`invoice`), used for relation coverage checks. */
  entity?: string;
}

export interface SeedRegistryFile {
  schemaVersion: number;
  seeds: SeedRegistryEntry[];
}

/** True when a seed declares an executable `create` producer (not just prose). */
export function hasExecutableProducer(entry: SeedRegistryEntry): boolean {
  return Boolean(entry.create?.endpoint && entry.create?.cleanupEndpoint);
}

/**
 * Validate a parsed registry document (arbitrary JSON from disk) into the typed
 * shape. Returns `null` when the document is not a registry at all.
 *
 * Both consumers need this: the MCP loader reports `invalid` to the agent, and
 * the Playwright runtime silently falls back to an empty graph. Sharing one
 * validator is what keeps the two sides agreeing on what counts as a registry.
 */
export function parseSeedRegistry(raw: unknown): SeedRegistryFile | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const candidate = raw as Partial<SeedRegistryFile>;
  if (!Array.isArray(candidate.seeds)) return null;
  if (
    candidate.seeds.some(
      (seed) =>
        typeof seed !== 'object' ||
        seed === null ||
        typeof seed.name !== 'string' ||
        !seed.name.trim(),
    )
  ) {
    return null;
  }
  return {
    schemaVersion: typeof candidate.schemaVersion === 'number' ? candidate.schemaVersion : 1,
    seeds: candidate.seeds.filter(
      (seed): seed is SeedRegistryEntry =>
        typeof seed === 'object' && seed !== null && typeof seed.name === 'string',
    ),
  };
}

/**
 * Convert registry seeds into producer specs for the seed-graph runtime.
 *
 * Entries without an executable `create` block are skipped: the registry still
 * documents them, but nothing can materialize them, so the runtime stays silent
 * about them rather than failing later with a worse error. Legacy prose-only
 * registries therefore yield an empty graph.
 */
export function toSeedProducers(registry: SeedRegistryFile | null): SeedProducerSpec[] {
  if (!registry) return [];
  return registry.seeds.filter(hasExecutableProducer).map((entry) => ({
    name: entry.name,
    endpoint: entry.create!.endpoint,
    cleanupEndpoint: entry.create!.cleanupEndpoint,
    ...(entry.create!.dependsOn ? { dependsOn: entry.create!.dependsOn } : {}),
    ...(entry.create!.payload ? { payload: entry.create!.payload } : {}),
    ...(entry.create!.idField ? { idField: entry.create!.idField } : {}),
  }));
}
