import * as path from 'node:path';
import { mcpWorkspace } from './workspace-paths';

type LoadEnvironmentFn = (options?: { adapterEnv?: { dir: string; name: string } }) => void;

function getLoadEnvironment(repoRoot: string): LoadEnvironmentFn {
  // env-loader lives in template core, outside the mcp-server package.
  try {
    const mod = require(path.join(repoRoot, 'src/utils/env-loader')) as {
      loadEnvironment: LoadEnvironmentFn;
    };
    return mod.loadEnvironment || (() => {});
  } catch {
    return () => {};
  }
}

/**
 * Anchor MCP processes at repo root and load the same env contract as Playwright configs.
 */
export function bootstrapMcpEnvironment(startDir: string): string {
  // Must be set before any logger.info from env-loader — stdout is reserved for JSON-RPC.
  process.env.MCP_STDIO = '1';

  // Anchor at the workspace registry, which resolves the repo from this
  // module's own location: the host may spawn the server with any cwd.
  const repoRoot = mcpWorkspace.rootDir;
  process.chdir(repoRoot);

  let resolved = { appEnv: process.env.APP_ENV || 'local', source: 'default' };
  try {
    const mod = require(path.join(repoRoot, 'src/utils/app-env')) as {
      resolveAppEnv: (opts: { repoRoot: string }) => {
        appEnv: string;
        source: string;
      };
    };
    if (mod && typeof mod.resolveAppEnv === 'function') {
      resolved = mod.resolveAppEnv({ repoRoot });
    }
  } catch {
    // Fallback if not compiled to cjs yet
  }
  process.stderr.write(
    `[qa-playwright-kit-mcp] APP_ENV=${resolved.appEnv} (source=${resolved.source}) → config/environments/${resolved.appEnv}.env\n`,
  );

  const loadEnvironment = getLoadEnvironment(repoRoot);
  loadEnvironment();

  return repoRoot;
}
