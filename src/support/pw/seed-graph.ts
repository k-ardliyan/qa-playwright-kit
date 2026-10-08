/**
 * Seed graph runtime — turns declared seeds into real test data.
 *
 * The registry (`config/qa-kit.seeds.json`) declares seeds; this module is the
 * part that actually MATERIALIZES them and tears them down. It exists because
 * a registry entry alone is an assertion of provisioning, not proof: parent
 * records must exist before children, and cleanup must run in reverse order or
 * the app's own FK/restrict rules reject it.
 *
 * Safety contract (mirrors the evidence boundary enforced by
 * `validate_generated_tests`):
 * - Producers only ever call registered API endpoints — never eval prose,
 *   shell commands, or hand-read `.auth` tokens.
 * - Every created record's ID is tracked so teardown deletes THIS run's data
 *   only, never a prefix sweep of shared data.
 * - A failed cleanup is reported, not swallowed.
 *
 * @see https://playwright.dev/docs/test-fixtures (setup/teardown lifecycle)
 * @see https://playwright.dev/docs/api-testing (server-state preparation)
 */
import type { APIRequestContext } from '@playwright/test';
import { apiJson } from './api-seed';

export interface SeedProducerSpec {
  name: string;
  /** POST endpoint that creates the record. */
  endpoint: string;
  /** DELETE endpoint template with `{id}` placeholder. */
  cleanupEndpoint: string;
  /** Seed names that must exist before this one. */
  dependsOn?: string[];
  /** JSON body to POST (values may reference parent IDs as `{parent.<seed>.id}`). */
  payload?: Record<string, unknown>;
  /** Field on the response body holding the created ID. Default `id`. */
  idField?: string;
}

export interface SeedGraph {
  producers: SeedProducerSpec[];
}

export interface MaterializedSeed {
  name: string;
  id: string;
  body: unknown;
}

export interface SeedRunResult {
  seeds: Record<string, MaterializedSeed>;
  /** Errors from teardown, in the order they happened. Empty = clean run. */
  cleanupErrors: string[];
}

/** Resolve seed names to an execution order, parents before children. */
export function resolveSeedOrder(graph: SeedGraph, requested: string[]): string[] {
  const byName = new Map(graph.producers.map((p) => [p.name, p]));
  const order: string[] = [];
  const visiting = new Set<string>();
  const done = new Set<string>();

  const visit = (name: string, chain: string[]): void => {
    if (done.has(name)) return;
    if (visiting.has(name)) {
      throw new Error(`Seed dependency cycle detected: ${[...chain, name].join(' -> ')}`);
    }
    const spec = byName.get(name);
    if (!spec) throw new Error(`Unknown seed "${name}" — no registered producer.`);
    visiting.add(name);
    for (const dep of spec.dependsOn ?? []) visit(dep, [...chain, name]);
    visiting.delete(name);
    done.add(name);
    order.push(name);
  };

  for (const name of requested) visit(name, []);
  return order;
}

/** Substitute `{parent.<seed>.id}` references in a producer payload. */
function resolvePayload(
  payload: Record<string, unknown> | undefined,
  seeds: Record<string, MaterializedSeed>,
): Record<string, unknown> | undefined {
  if (!payload) return undefined;
  const json = JSON.stringify(payload).replace(
    /\{parent\.([\w.-]+)\.(\w+)\}/g,
    (_match, seedName: string, field: string) => {
      const parent = seeds[seedName];
      if (!parent) throw new Error(`Seed payload references unknown parent "${seedName}".`);
      const value =
        field === 'id' ? parent.id : (parent.body as Record<string, unknown> | undefined)?.[field];
      if (value === undefined) {
        throw new Error(`Parent "${seedName}" has no field "${field}" to substitute.`);
      }
      return String(value);
    },
  );
  return JSON.parse(json) as Record<string, unknown>;
}

function extractId(body: unknown, idField: string): string | undefined {
  if (typeof body !== 'object' || body === null) return undefined;
  const record = body as Record<string, unknown>;
  const direct = record[idField];
  if (typeof direct === 'string' || typeof direct === 'number') return String(direct);
  const nested = record.data;
  if (typeof nested === 'object' && nested !== null) {
    const inner = (nested as Record<string, unknown>)[idField];
    if (typeof inner === 'string' || typeof inner === 'number') return String(inner);
  }
  return undefined;
}

/**
 * Materialize the requested seeds in dependency order and return the created
 * IDs. Throws on the first failing producer rather than continuing with a
 * half-built dependency graph.
 */
export async function materializeSeeds(
  request: APIRequestContext,
  graph: SeedGraph,
  requested: string[],
): Promise<Record<string, MaterializedSeed>> {
  const order = resolveSeedOrder(graph, requested);
  const byName = new Map(graph.producers.map((p) => [p.name, p]));
  const created: Record<string, MaterializedSeed> = {};

  for (const name of order) {
    const spec = byName.get(name)!;
    const result = await apiJson(request, 'POST', spec.endpoint, {
      data: resolvePayload(spec.payload, created),
    });
    if (!result.ok) {
      throw new Error(
        `Seed "${name}" producer failed: POST ${spec.endpoint} -> ${result.status}. ` +
          `Refusing to continue with a partial dependency graph.`,
      );
    }
    const id = extractId(result.body, spec.idField ?? 'id');
    if (!id) {
      throw new Error(
        `Seed "${name}" producer returned no id (field "${spec.idField ?? 'id'}") — cannot clean it up, so the run is unsafe.`,
      );
    }
    created[name] = { name, id, body: result.body };
  }
  return created;
}

/**
 * Delete every seed this run created, children before parents (reverse of the
 * creation order). Reports failures instead of swallowing them — an unreported
 * cleanup failure is exactly how shared test data rots.
 */
export async function teardownSeeds(
  request: APIRequestContext,
  graph: SeedGraph,
  created: Record<string, MaterializedSeed>,
): Promise<string[]> {
  const byName = new Map(graph.producers.map((p) => [p.name, p]));
  const errors: string[] = [];
  const order = resolveSeedOrder(graph, Object.keys(created)).reverse();

  for (const name of order) {
    const seed = created[name];
    const spec = byName.get(name);
    if (!seed || !spec) continue;
    const url = spec.cleanupEndpoint.replace('{id}', encodeURIComponent(seed.id));
    try {
      const result = await apiJson(request, 'DELETE', url);
      if (!result.ok && result.status !== 404) {
        errors.push(`Seed "${name}" cleanup: DELETE ${url} -> ${result.status}.`);
      }
    } catch (error) {
      errors.push(
        `Seed "${name}" cleanup threw: ${error instanceof Error ? error.message : String(error)}.`,
      );
    }
  }
  return errors;
}

/**
 * Run a test body with test-owned seed data: materialize → use → teardown.
 * Cleanup runs in a `finally` so a failing assertion still removes the data,
 * and cleanup failures are surfaced rather than hidden.
 */
export async function withSeededData<T>(
  request: APIRequestContext,
  graph: SeedGraph,
  requested: string[],
  body: (seeds: Record<string, MaterializedSeed>) => Promise<T>,
): Promise<T> {
  const created = await materializeSeeds(request, graph, requested);
  try {
    return await body(created);
  } finally {
    const cleanupErrors = await teardownSeeds(request, graph, created);
    if (cleanupErrors.length > 0) {
      // eslint-disable-next-line no-console
      console.warn(
        `[seed-graph] cleanup reported ${cleanupErrors.length} error(s):`,
        cleanupErrors,
      );
    }
  }
}
