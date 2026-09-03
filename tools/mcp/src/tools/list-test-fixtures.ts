/**
 * MCP: list_test_fixtures — list files under tests/data/ for Input Data paths.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { resolveAllowedPath } from '../utils/safety';
import { mcpWorkspace } from '../utils/workspace-paths';

function walk(dir: string, base: string, prefix: string, out: string[]): void {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const abs = path.join(dir, entry.name);
    const rel = path.relative(base, abs).replace(/\\/g, '/');
    if (entry.isDirectory()) {
      walk(abs, base, prefix, out);
    } else {
      out.push(`${prefix}/${rel}`.replace(/\\/g, '/'));
    }
  }
}

export function listTestFixtures(args: Record<string, unknown> | undefined): unknown {
  const fixturesRoot = mcpWorkspace.testDataDir;
  const prefix = mcpWorkspace.testDataRel;

  if (!fs.existsSync(fixturesRoot)) {
    return {
      status: 'success',
      fixtures: [] as string[],
      message: `${prefix}/ does not exist yet.`,
    };
  }

  const subdir =
    typeof args?.subdir === 'string' ? args.subdir.replace(/\\/g, '/').replace(/^\//, '') : '';
  const resolved = resolveAllowedPath(subdir ? `${prefix}/${subdir}` : prefix, 'test-data', {
    mustExist: true,
    readOnly: true,
  });
  if (!resolved.ok) {
    return { status: 'error', error: resolved.error };
  }

  const start = resolved.absolutePath;

  const fixtures: string[] = [];
  walk(start, fixturesRoot, prefix, fixtures);
  fixtures.sort((a, b) => a.localeCompare(b));

  return {
    status: 'success',
    fixtures,
    count: fixtures.length,
  };
}
