import {
  SEED_REGISTRY_RELATIVE_PATH,
  loadSeedRegistry,
  toSeedProducers,
} from '../utils/seed-registry';

export interface GetSeedGraphOutput {
  status: 'success' | 'error';
  /**
   * Producer specs in registry order, ready to feed the seed-graph runtime
   * (`withSeededData` / the `seeded` fixture). Only seeds with an executable
   * `create` block appear here.
   */
  producers: Array<{
    name: string;
    endpoint: string;
    cleanupEndpoint: string;
    dependsOn?: string[];
    payload?: Record<string, unknown>;
    idField?: string;
  }>;
  count: number;
  /** Seeds declared in the registry but not executable (no `create` block). */
  nonExecutable: string[];
  registryPath: string;
  message: string;
  error?: { code: string; message: string };
}

/**
 * MCP tool `get_seed_graph` — hand the Generator the executable producer graph
 * so it never hand-copies endpoints into a spec.
 *
 * `list_seeds` answers "what seeds exist and are they runnable?"; this answers
 * "what exactly do I pass to the runtime?". A missing or prose-only registry is
 * a SUCCESS with an empty graph plus guidance, matching `list_seeds`.
 */
export function getSeedGraph(): GetSeedGraphOutput {
  const loaded = loadSeedRegistry();
  if (!loaded.ok) {
    const guidance =
      loaded.reason === 'invalid'
        ? `Seed registry at ${loaded.registryPath} is invalid JSON/shape${loaded.detail ? `: ${loaded.detail}` : ''} — fix it or delete it.`
        : `No seed registry at ${SEED_REGISTRY_RELATIVE_PATH} yet — declare each seed with a "create" block (endpoint + cleanupEndpoint) to make it executable.`;
    return {
      status: 'success',
      producers: [],
      count: 0,
      nonExecutable: [],
      registryPath: loaded.registryPath,
      message: guidance,
    };
  }

  const producers = toSeedProducers(loaded.registry);
  const executableNames = new Set(producers.map((p) => p.name));
  const nonExecutable = loaded.registry.seeds
    .filter((seed) => !executableNames.has(seed.name))
    .map((seed) => seed.name);

  const guidance =
    nonExecutable.length > 0
      ? ` ${nonExecutable.length} declared seed(s) are not executable: ${nonExecutable
          .map((name) => `seed:${name}`)
          .join(', ')}. Add a "create" block so the runtime can materialize them.`
      : '';

  return {
    status: 'success',
    producers,
    count: producers.length,
    nonExecutable,
    registryPath: loaded.registryPath,
    message: `${producers.length} executable producer(s).${guidance}`,
  };
}
