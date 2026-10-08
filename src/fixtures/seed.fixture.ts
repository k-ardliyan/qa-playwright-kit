import type { APIRequestContext } from '@playwright/test';
import { loadSeedGraph } from '@/support/pw/seed-config';
import { withSeededData, type MaterializedSeed, type SeedGraph } from '@/support/pw/seed-graph';

/**
 * Test-scoped seed fixture.
 *
 * Usage in a generated hybrid spec:
 *
 *   test('SC-02: order reduces stock (@hybrid)', async ({ page, seeded }) => {
 *     await seeded(['order.draft'], async (seeds) => {
 *       await page.goto(`/orders/${seeds['order.draft'].id}`);
 *       await expect(page.getByText('Draft')).toBeVisible();
 *     });
 *   });
 *
 * The producer graph comes from `config/qa-kit.seeds.json` (loaded once per
 * process). Seeds are materialized parents-first and torn down children-first,
 * scoped to the IDs this test created — never a prefix sweep of shared data.
 */
export type SeededFixture = <T>(
  requested: string[],
  body: (seeds: Record<string, MaterializedSeed>) => Promise<T>,
) => Promise<T>;

/** Injectable seam so unit tests can drive the fixture without a live registry. */
export interface SeededFixtureDeps {
  /** Overrides the registry graph (tests only). */
  graph?: SeedGraph;
}

/**
 * Build the `seeded` fixture body. Exported separately from the registration so
 * unit tests can pass a stub request context and an explicit graph.
 */
export function createSeededFixture(
  deps: SeededFixtureDeps = {},
): (args: { request: APIRequestContext }) => Promise<SeededFixture> {
  // Loaded lazily on first use, not at module import: a workspace without a
  // registry must not fail while merely assembling fixtures.
  let graph: SeedGraph | undefined = deps.graph;
  return async ({ request }): Promise<SeededFixture> => {
    const resolved = graph ?? (graph = loadSeedGraph());
    return async <T>(
      requested: string[],
      body: (seeds: Record<string, MaterializedSeed>) => Promise<T>,
    ): Promise<T> => {
      if (resolved.producers.length === 0) {
        throw new Error(
          `Seed "${requested.join(', ')}" requested but no executable producer is configured. ` +
            `Declare it in config/qa-kit.seeds.json with a "create" block (endpoint + cleanupEndpoint).`,
        );
      }
      return withSeededData(request, resolved, requested, body);
    };
  };
}
