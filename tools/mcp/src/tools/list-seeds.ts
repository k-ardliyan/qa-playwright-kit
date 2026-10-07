import { createToolError } from '../utils/safety';
import { SEED_REGISTRY_RELATIVE_PATH, loadSeedRegistry } from '../utils/seed-registry';

export interface ListSeedsOutput {
  status: 'success' | 'error';
  /** Declared seeds, in registry order. Empty when no registry exists. */
  seeds: Array<{ name: string; producer?: string; fixture?: string; notes?: string }>;
  count: number;
  registryPath: string;
  message: string;
  error?: { code: string; message: string };
}

/**
 * MCP tool `list_seeds` — surface the project's seed registry so the agent can
 * answer "does seed:payroll.draft exist and who produces it?" without reading
 * files by hand. A missing registry is a SUCCESS with guidance, not an error:
 * most workspaces have not declared one yet.
 */
export function listSeeds(): ListSeedsOutput {
  const loaded = loadSeedRegistry();
  if (!loaded.ok) {
    if (loaded.reason === 'invalid') {
      const err = createToolError(
        'INVALID_INPUT',
        `Seed registry at ${loaded.registryPath} is invalid JSON/shape${loaded.detail ? `: ${loaded.detail}` : ''} — fix it or delete it (a missing registry is fine).`,
      );
      return {
        status: 'error',
        seeds: [],
        count: 0,
        registryPath: loaded.registryPath,
        message: err.error.message,
        error: err.error,
      };
    }
    return {
      status: 'success',
      seeds: [],
      count: 0,
      registryPath: loaded.registryPath,
      message: `No seed registry at ${SEED_REGISTRY_RELATIVE_PATH} yet — copy config/qa-kit.seeds.example.json and declare each seed:<entity>.<state> producer so validate_plan can check refs (PLAN_SEED_UNKNOWN).`,
    };
  }

  const seeds = loaded.registry.seeds.map((s) => ({
    name: s.name,
    ...(s.producer ? { producer: s.producer } : {}),
    ...(s.fixture ? { fixture: s.fixture } : {}),
    ...(s.notes ? { notes: s.notes } : {}),
  }));
  return {
    status: 'success',
    seeds,
    count: seeds.length,
    registryPath: loaded.registryPath,
    message: `${seeds.length} declared seed(s). Every seed:<name> ref in scenario Data Setup should match one of these names.`,
  };
}
