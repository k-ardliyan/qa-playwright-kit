import * as fs from 'node:fs';
import * as path from 'node:path';
import { mcpWorkspace } from './workspace-paths';

/**
 * Seed registry — the per-project answer to "does `seed:<entity>.<state>`
 * exist, and what produces it?".
 *
 * The registry is a PER-PROJECT artifact at `config/qa-kit.seeds.json`
 * (shipped as `config/qa-kit.seeds.example.json` — copy and adapt). The
 * framework ships NO registry: an absent file means every seed behavior is
 * inert, so existing QA workspaces never get new noise. When present,
 * `validate_plan` cross-checks scenario `seed:` refs against it
 * (PLAN_SEED_UNKNOWN) and `list_seeds` surfaces it to the agent.
 */

export const SEED_REGISTRY_RELATIVE_PATH = path.join('config', 'qa-kit.seeds.json');

export interface SeedRegistryEntry {
  /** Seed ref name WITHOUT the `seed:` prefix — e.g. `payroll.draft`. */
  name: string;
  /** How the seed is produced (API endpoint + state, DB fixture, UI path). */
  producer?: string;
  /** Optional fixture file backing the seed state. */
  fixture?: string;
  notes?: string;
}

export interface SeedRegistryFile {
  schemaVersion: number;
  seeds: SeedRegistryEntry[];
}

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
    const parsed = JSON.parse(fs.readFileSync(registryPath, 'utf-8')) as Partial<SeedRegistryFile>;
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      !Array.isArray(parsed.seeds) ||
      parsed.seeds.some(
        (s) => typeof s !== 'object' || s === null || typeof s.name !== 'string' || !s.name.trim(),
      )
    ) {
      return {
        ok: false,
        reason: 'invalid',
        detail: 'Expected { "schemaVersion": 1, "seeds": [{ "name": "..." }] }.',
        registryPath,
      };
    }
    const registry: SeedRegistryFile = {
      schemaVersion: typeof parsed.schemaVersion === 'number' ? parsed.schemaVersion : 1,
      seeds: parsed.seeds.filter(
        (s): s is SeedRegistryEntry =>
          typeof s === 'object' && s !== null && typeof s.name === 'string',
      ),
    };
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
