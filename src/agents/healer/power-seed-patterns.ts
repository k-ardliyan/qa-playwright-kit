/**
 * Seed heal patterns for official Playwright power failures (network / hybrid / env).
 * Healer agents should call `ensurePowerSeedPatterns(db)` after loadDatabase().
 */

import type { FailureSignature, FixTemplate } from '@/shared/types';
import type { HealPatternDatabase } from '@/shared/types/heal-patterns.schema';
import { findBySignature, storePattern } from './pattern-database';

interface SeedDef {
  signature: FailureSignature;
  fix: FixTemplate;
  tags: string[];
}

const SEEDS: SeedDef[] = [
  {
    signature: {
      errorType: 'network',
      errorPattern: 'net::ERR_|NS_ERROR_FAILURE|Failed to fetch|NetworkError|ECONNREFUSED',
    },
    fix: {
      strategy: 'add_state_setup',
      beforePattern: 'await page.goto',
      afterTemplate:
        "await mockServerError(page, '**/api/**', 500);\n// or mockJson for controlled payloads\nawait page.goto",
      requiredImports: ["import { mockServerError, mockJson, unmockAll } from '@/support/pw';"],
    },
    tags: ['network', 'route', 'power'],
  },
  {
    signature: {
      errorType: 'network',
      errorPattern: 'Timeout.*waiting for.*(response|request)|api.*500|Internal Server Error',
    },
    fix: {
      strategy: 'add_state_setup',
      beforePattern: 'page.click',
      afterTemplate:
        "await mockJson(page, '**/api/**', { ok: true });\n// ensure UI action after route is registered\n",
      requiredImports: ["import { mockJson, unmockAll } from '@/support/pw';"],
    },
    tags: ['network', 'timeout', 'power'],
  },
  {
    signature: {
      errorType: 'data_state',
      errorPattern: 'not found|404|empty list|no rows|seed|missing.*data',
    },
    fix: {
      strategy: 'add_state_setup',
      beforePattern: 'await page.goto',
      afterTemplate:
        "const seeded = await apiSeed(request, '/api/<resource>', { /* payload from requirement */ });\nawait page.goto",
      requiredImports: ["import { apiSeed, apiCleanup } from '@/support/pw';"],
    },
    tags: ['hybrid', 'data_state', 'power'],
  },
  {
    signature: {
      errorType: 'auth',
      errorPattern: 'storageState|login|unauthorized|401|403|AUTH SETUP|session',
    },
    fix: {
      strategy: 'add_state_setup',
      beforePattern: 'test.describe(',
      afterTemplate:
        "test.use({ storageState: authStatePath('<role>') });\n// Ensure a VALID session exists: npm run auth:setup (real UI login — the ONLY session producer).\n// If the failure is 401/session-expired/redirect-to-login, do NOT patch this spec further:\n// re-run auth:setup then re-run this file (Auth Recovery Protocol, max 1 re-auth cycle per role).\n// NEVER inject storage state manually (browser_set_storage_state / addCookies / localStorage.setItem).\ntest.describe(",
      requiredImports: ["import { authStatePath } from '@/support/auth-paths';"],
    },
    tags: ['auth', 'env', 'power'],
  },
  {
    signature: {
      errorType: 'timeout',
      errorPattern: 'waiting for event [\'"]download[\'"]|Timeout.*download|Download.*timeout',
    },
    fix: {
      strategy: 'add_state_setup',
      beforePattern: 'page.click',
      afterTemplate:
        "const { path: downloaded } = await downloadAndSave(page, async () => {\n  await page.getByRole('button', { name: /download|unduh|export/i }).click();\n});\n// assert envelope / content with scenario tokens\n",
      requiredImports: [
        "import { downloadAndSave, assertDownloadedEnvelope } from '@/support/pw';",
      ],
    },
    tags: ['download', 'file', 'power'],
  },
  {
    signature: {
      errorType: 'data_state',
      errorPattern: 'Upload fixture not found|ENOENT.*tests/data|setInputFiles',
    },
    fix: {
      strategy: 'replace_locator',
      beforePattern: 'setInputFiles',
      afterTemplate:
        "await uploadFixture(page.locator('input[type=file]'), 'images/sample.png');\n// or path from scenario Input Data under tests/data/\n",
      requiredImports: ["import { uploadFixture } from '@/support/pw';"],
    },
    tags: ['upload', 'file', 'power'],
  },
  {
    signature: {
      errorType: 'locator',
      errorPattern: 'dropzone|drag and drop|DataTransfer|locator.drop',
    },
    fix: {
      strategy: 'replace_locator',
      beforePattern: 'dropFixture',
      afterTemplate:
        "await dropFixture(page.locator('.dropzone'), 'documents/sample.pdf');\n// uses native Playwright locator.drop() synthetic DataTransfer\n",
      requiredImports: ["import { dropFixture } from '@/support/pw';"],
    },
    tags: ['upload', 'drop', 'power'],
  },
];

/**
 * Idempotently seed power-related patterns into the heal database.
 * Only inserts missing signatures — does not inflate success counts on re-run.
 */
export function ensurePowerSeedPatterns(db: HealPatternDatabase): HealPatternDatabase {
  let next = db;
  for (const seed of SEEDS) {
    if (findBySignature(next, seed.signature)) {
      continue;
    }
    next = storePattern(next, seed.signature, seed.fix, true);
    const match = next.patterns.find(
      (p) =>
        p.signature.errorType === seed.signature.errorType &&
        p.signature.errorPattern === seed.signature.errorPattern,
    );
    if (match) {
      match.tags = [...new Set([...(match.tags ?? []), ...seed.tags])];
    }
  }
  return next;
}

export function listPowerSeedSignatures(): FailureSignature[] {
  return SEEDS.map((s) => s.signature);
}
