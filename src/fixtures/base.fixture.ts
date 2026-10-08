import { frameworkFixtureExtend } from './framework.fixture';
import { projectTest } from './project.fixture';
import { createSeededFixture, type SeededFixture } from './seed.fixture';

/**
 * Core Framework Fixtures
 *
 * Assembly point between framework behaviour (logger, lifecycle trace, seeded
 * data) and project-specific POM registrations (projectTest).
 * Generated tests import from here — register POMs in project.fixture.ts only.
 */

export const test = projectTest.extend(frameworkFixtureExtend).extend<{
  seeded: SeededFixture;
}>({
  // Test-scoped on purpose: seed data belongs to one test. The producer graph
  // is loaded from config/qa-kit.seeds.json on first use per process.
  seeded: async ({ request }, use) => {
    use(await createSeededFixture()({ request }));
  },
});

export { expect } from '@playwright/test';

export type { FrameworkFixtures } from './framework.fixture';
export type { SeededFixture } from './seed.fixture';
