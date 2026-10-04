import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import * as path from 'node:path';
import { findRepoRoot } from '../shared/workspace-paths';

const DEFAULT_PORT = 4567;
const START_TIMEOUT_MS = 30_000;
const POLL_INTERVAL_MS = 150;

function parseArgs(argv: string[]): { port: number; open: boolean } {
  let port = DEFAULT_PORT;
  let open = true;
  for (const arg of argv) {
    const match = arg.match(/^--port=(\d+)$/);
    if (match) port = Number(match[1]);
    else if (arg === '--no-open') open = false;
    else throw new Error(`Unknown dashboard option: ${arg}`);
  }
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`Invalid dashboard port: ${port}`);
  }
  return { port, open };
}

async function waitUntilReady(
  port: number,
  sessionId: string,
  watcher: ReturnType<typeof spawn>,
): Promise<void> {
  const deadline = Date.now() + START_TIMEOUT_MS;
  const url = `http://127.0.0.1:${port}/heartbeat`;
  while (Date.now() < deadline) {
    if (watcher.exitCode !== null)
      throw new Error('Dashboard watcher exited before the server was ready.');
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(500) });
      if (response.ok) {
        const health = (await response.json()) as { sessionId?: string };
        if (health.sessionId === sessionId) return;
      }
    } catch {
      // The watched server is starting or restarting.
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  throw new Error(`Dashboard did not become ready within ${START_TIMEOUT_MS / 1000} seconds.`);
}

function openBrowser(url: string): void {
  const command =
    process.platform === 'win32'
      ? `start "" "${url}"`
      : process.platform === 'darwin'
        ? 'open'
        : 'xdg-open';
  const args = process.platform === 'win32' ? [] : [url];
  const child = spawn(command, args, {
    detached: true,
    shell: process.platform === 'win32',
    stdio: 'ignore',
  });
  child.on('error', (error) =>
    console.warn(`[dashboard] Could not open browser: ${error.message}`),
  );
  child.unref();
}

async function main(): Promise<void> {
  const { port, open } = parseArgs(process.argv.slice(2));
  const repoRoot = findRepoRoot(__dirname);
  const sessionId = randomUUID();
  const tsxCli = path.join(repoRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs');
  const server = path.join(repoRoot, 'src', 'cli', 'dashboard-server.ts');
  const watcher = spawn(process.execPath, [tsxCli, 'watch', server, `--port=${port}`], {
    cwd: repoRoot,
    env: { ...process.env, DASHBOARD_SESSION_ID: sessionId },
    stdio: 'inherit',
  });
  const forwardSignal = (signal: NodeJS.Signals) => {
    if (watcher.exitCode === null) watcher.kill(signal);
  };
  process.on('SIGINT', forwardSignal);
  process.on('SIGTERM', forwardSignal);

  try {
    await waitUntilReady(port, sessionId, watcher);
    const url = `http://localhost:${port}`;
    console.log(`[dashboard] Ready at ${url}`);
    if (open) openBrowser(url);
  } catch (error) {
    console.error(`[dashboard] ${error instanceof Error ? error.message : String(error)}`);
    watcher.kill('SIGTERM');
    process.exitCode = 1;
  }

  const [code, signal] = await new Promise<[number | null, NodeJS.Signals | null]>((resolve) => {
    watcher.once('exit', (exitCode, exitSignal) => resolve([exitCode, exitSignal]));
  });
  process.exitCode ??= code ?? (signal ? 1 : 0);
}

const isMain = typeof require !== 'undefined' && require.main === module;
if (isMain) {
  main().catch((error: unknown) => {
    console.error(`[dashboard] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
