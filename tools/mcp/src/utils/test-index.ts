/**
 * AUTO-SYNCED from src/support/traceability/test-index.ts — do not edit by hand.
 * Run: npm run sync:mcp-generated  (also runs inside npm run mcp:build)
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

export interface TestIndexEntry {
  scenarioId?: string;
  testId?: string;
  covers?: string[];
  module?: string;
  feature?: string;
  actor?: string;
  authContext?: string;
  requirementPath?: string;
  specFile: string;
  testTitle: string;
  lineNumber?: number;
}

export interface TestIndex {
  generatedAt: string;
  totalSpecs: number;
  totalTests: number;
  entries: TestIndexEntry[];
}

export function extractTestMetadataFromSpec(
  specContent: string,
  specRelPath: string,
): TestIndexEntry[] {
  const entries: TestIndexEntry[] = [];
  const lines = specContent.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Detect test('title', ...) or test.skip('title', ...)
    const testMatch = line.match(/test(?:\.skip|\.only|\.fixme)?\s*\(\s*['"`]([^'"`]+)['"`]/);
    if (testMatch) {
      const testTitle = testMatch[1];
      let scenarioId: string | undefined;
      let testId: string | undefined;
      let module: string | undefined;
      let feature: string | undefined;
      let actor: string | undefined;
      let requirementPath: string | undefined;

      const scInTitle = testTitle.match(/\b(SC-\d+)\b/i);
      if (scInTitle) scenarioId = scInTitle[1].toUpperCase();

      const tcInTitle = testTitle.match(/\b(TC-[A-Z0-9-]+)\b/i);
      if (tcInTitle) testId = tcInTitle[1].toUpperCase();

      // Look ahead up to 30 lines inside the test function for setTestMetadata
      const lookaheadLimit = Math.min(lines.length, i + 30);
      const testBlockText = lines.slice(i, lookaheadLimit).join('\n');

      const metaMatch = testBlockText.match(
        /setTestMetadata\s*\(\s*test\.info\(\)\s*,\s*({[\s\S]*?})\s*\)/,
      );
      if (metaMatch) {
        const objStr = metaMatch[1];
        const scenarioMatch = objStr.match(/scenarioId:\s*['"]([^'"]+)['"]/);
        const testIdMatch = objStr.match(/testId:\s*['"]([^'"]+)['"]/);
        const moduleMatch = objStr.match(/module:\s*['"]([^'"]+)['"]/);
        const featureMatch = objStr.match(/feature:\s*['"]([^'"]+)['"]/);
        const actorMatch = objStr.match(/actor:\s*['"]([^'"]+)['"]/);
        const reqMatch = objStr.match(/requirementPath:\s*['"]([^'"]+)['"]/);

        if (scenarioMatch) scenarioId = scenarioMatch[1];
        if (testIdMatch) testId = testIdMatch[1];
        if (moduleMatch) module = moduleMatch[1];
        if (featureMatch) feature = featureMatch[1];
        if (actorMatch) actor = actorMatch[1];
        if (reqMatch) requirementPath = reqMatch[1];
      }

      entries.push({
        scenarioId,
        testId,
        module,
        feature,
        actor,
        requirementPath,
        specFile: specRelPath.replace(/\\/g, '/'),
        testTitle,
        lineNumber: i + 1,
      });
    }
  }

  return entries;
}

export function buildTestIndex(testsDir: string, repoRoot: string): TestIndex {
  const entries: TestIndexEntry[] = [];
  let totalSpecs = 0;

  function scan(dir: string): void {
    if (!fs.existsSync(dir)) return;
    const items = fs.readdirSync(dir, { withFileTypes: true });
    for (const item of items) {
      const full = path.join(dir, item.name);
      if (item.isDirectory() && item.name !== 'node_modules' && item.name !== '.git') {
        scan(full);
      } else if (item.isFile() && item.name.endsWith('.spec.ts')) {
        totalSpecs++;
        const rel = path.relative(repoRoot, full).replace(/\\/g, '/');
        const content = fs.readFileSync(full, 'utf-8');
        const specEntries = extractTestMetadataFromSpec(content, rel);
        entries.push(...specEntries);
      }
    }
  }

  scan(testsDir);

  return {
    generatedAt: new Date().toISOString(),
    totalSpecs,
    totalTests: entries.length,
    entries,
  };
}
