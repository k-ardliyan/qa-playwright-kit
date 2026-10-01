import { spawn } from 'node:child_process';
import * as path from 'node:path';
import { getPlaywrightConfigPath } from '../mcp/src/utils/playwright-paths';
import { bootstrapMcpEnvironment } from './mcp-bootstrap';
import { findRepoRoot } from '../../src/shared/workspace-paths';
import {
  describeSpawn,
  localPackageSpawn,
  npmSpawn,
  type BinSpawn,
} from '../../src/setup/spawn-bin';

/**
 * Spawn plan for the Playwright test-runner MCP server — NEVER through a shell.
 *
 * `-c <configPath>` is absolute and contains the repo path, so the old
 * `npx` + `shell: true` shape split it at every space on Windows and the server
 * exited with `too many arguments`. Running the installed CLI entry with the
 * current Node binary keeps the path intact.
 *
 * Falls back to `npm exec` (also shell-free) on a clone that has not run
 * `npm install` yet.
 */
export function resolveTestMcpLaunchSpawn(
  repoRoot: string,
  configPath: string,
  execPath: string = process.execPath,
): BinSpawn {
  const cliArgs = ['run-test-mcp-server', '-c', configPath];
  return (
    localPackageSpawn(repoRoot, 'node_modules/playwright/cli.js', cliArgs, execPath) ??
    npmSpawn(['exec', '--yes', '--', 'playwright', ...cliArgs], execPath)
  );
}

function main(): void {
  bootstrapMcpEnvironment(__dirname);

  const repoRoot = findRepoRoot(__dirname);
  const configPath = path.resolve(repoRoot, getPlaywrightConfigPath());
  const plan = resolveTestMcpLaunchSpawn(repoRoot, configPath);

  const child = spawn(plan.command, plan.args, {
    stdio: 'inherit',
    shell: plan.shell,
    cwd: repoRoot,
    env: process.env,
  });

  child.on('exit', (code, signal) => {
    if (signal) {
      process.exit(1);
    }
    process.exit(code ?? 1);
  });

  child.on('error', (error) => {
    process.stderr.write(
      `playwright-test MCP launch failed: ${error.message}\n  command: ${describeSpawn(plan)}\n`,
    );
    process.exit(1);
  });
}

if (require.main === module) {
  main();
}
