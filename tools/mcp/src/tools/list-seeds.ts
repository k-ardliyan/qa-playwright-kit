import { createToolError } from '../utils/safety';
import {
  SEED_REGISTRY_RELATIVE_PATH,
  hasExecutableProducer,
  loadSeedRegistry,
} from '../utils/seed-registry';

export interface ListSeedsOutput {
  status: 'success' | 'error';
  /** Declared seeds, in registry order. Empty when no registry exists. */
  seeds: Array<{
    name: string;
    producer?: string;
    fixture?: string;
    notes?: string;
    entity?: string;
    /**
     * True when the seed declares an executable producer (endpoint +
     * cleanupEndpoint) the seed-graph runtime can materialize and tear down.
     */
    executable: boolean;
    dependsOn?: string[];
  }>;
  count: number;
  executableCount: number;
  registryPath: string;
  message: string;
  error?: { code: string; message: string };
}

/**
 * MCP tool `list_seeds` — surface the project's seed registry so the agent can
 * answer "does seed:payroll.draft exist and who produces it?" without reading
 * files by hand. A missing registry is a SUCCESS with guidance, not an error:
 * most workspaces have not declared one yet.
 *
 * `executable` distinguishes a seed the runtime can actually build from one
 * that is only documented prose — the difference between real setup and a
 * registry entry that asserts provisioning without providing it.
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
        executableCount: 0,
        registryPath: loaded.registryPath,
        message: err.error.message,
        error: err.error,
      };
    }
    return {
      status: 'success',
      seeds: [],
      count: 0,
      executableCount: 0,
      registryPath: loaded.registryPath,
      message: `No seed registry at ${SEED_REGISTRY_RELATIVE_PATH} yet — copy config/qa-kit.seeds.example.json and declare each seed:<entity>.<state> producer so validate_plan can check refs (PLAN_SEED_UNKNOWN).`,
    };
  }

  const seeds = loaded.registry.seeds.map((s) => ({
    name: s.name,
    ...(s.producer ? { producer: s.producer } : {}),
    ...(s.fixture ? { fixture: s.fixture } : {}),
    ...(s.notes ? { notes: s.notes } : {}),
    ...(s.entity ? { entity: s.entity } : {}),
    executable: hasExecutableProducer(s),
    ...(s.create?.dependsOn ? { dependsOn: s.create.dependsOn } : {}),
  }));
  const executableCount = seeds.filter((s) => s.executable).length;
  const proseOnly = seeds.length - executableCount;
  const guidance =
    proseOnly > 0
      ? ` ${proseOnly} seed(s) have no executable "create" producer — add endpoint + cleanupEndpoint so the runtime can build them instead of specs improvising setup.`
      : '';
  return {
    status: 'success',
    seeds,
    count: seeds.length,
    executableCount,
    registryPath: loaded.registryPath,
    message: `${seeds.length} declared seed(s); ${executableCount} executable.${guidance}`,
  };
}
