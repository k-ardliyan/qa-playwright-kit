import { test, expect } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';

/**
 * Idle-watchdog contract for the dashboard server.
 *
 * The watchdog exists for one flow: this process opened a browser tab, so when
 * that tab is closed the server should reclaim itself. It has twice been written
 * too eagerly and killed live sessions instead:
 *
 *   - `/heartbeat` was the only accepted proof of life, so curl / scripts / MCP
 *     tools looked like an abandoned tab and lost their server ~20s later,
 *     silently and with exit code 0 (which reads as success).
 *   - The countdown was armed even when no browser was opened, and the page's
 *     `setInterval` ping is throttled to ~1/min in background tabs, well past
 *     the timeout — so merely switching tabs could kill it.
 *
 * These tests pin the resulting rules. They assert the STARTUP CONTRACT rather
 * than waiting out a 60s timeout, so they stay fast and non-flaky.
 */

const SERVER = path.resolve(__dirname, '../dashboard-server.ts');
const TSX = path.resolve(__dirname, '../../../node_modules/tsx/dist/cli.mjs');

function startServer(port: number, args: string[] = [], env: NodeJS.ProcessEnv = {}) {
  const child = spawn(process.execPath, [TSX, SERVER, `--port=${port}`, ...args], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, ...env },
  });
  const state = { log: '', exited: null as number | null };
  child.stdout.on('data', (d) => (state.log += d.toString()));
  child.stderr.on('data', (d) => (state.log += d.toString()));
  child.on('exit', (code) => (state.exited = code));
  return { child, state };
}

async function waitReady(state: { log: string }) {
  for (let i = 0; i < 80 && !state.log.includes('Dashboard running'); i++) {
    await new Promise((r) => setTimeout(r, 250));
  }
  return state.log.includes('Dashboard running');
}

async function stop(child: ChildProcess) {
  if (child.exitCode === null) child.kill();
  await new Promise((r) => setTimeout(r, 400));
}

test.describe('dashboard server idle watchdog', () => {
  test('started without a browser: announces persistence, not a countdown', async () => {
    const { child, state } = startServer(4610, ['--no-open']);
    try {
      expect(await waitReady(state)).toBe(true);
      // With --no-open there is no owned tab, so no countdown may be advertised.
      expect(state.log).toContain('Persists until Ctrl+C (started without a browser tab)');
      expect(state.log).not.toContain('Shuts down');
    } finally {
      await stop(child);
    }
  });

  test('started with a browser: advertises the tab-close countdown', async () => {
    // Force the OS browser launch to fail so the test owns the only client.
    const { child, state } = startServer(4611, [], { COMSPEC: 'C:\\nonexistent\\cmd.exe' });
    try {
      expect(await waitReady(state)).toBe(true);
      expect(state.log).toMatch(/Shuts down [\d.]+s after this browser tab closes/);
    } finally {
      await stop(child);
    }
  });

  test('any request counts as activity, not just /heartbeat', async () => {
    const { child, state } = startServer(4612, ['--no-open']);
    try {
      expect(await waitReady(state)).toBe(true);
      // A plain page fetch must arm the watchdog — no /heartbeat involved.
      const res = await fetch('http://127.0.0.1:4612/latest');
      expect(res.status).toBe(200);
      expect(state.log).toContain('First client request — idle watchdog armed.');
    } finally {
      await stop(child);
    }
  });

  test('an open SSE stream keeps the server alive past the idle timeout', async () => {
    // The stream — not the throttled setInterval ping — is what proves a page is
    // still open. Short timeout so the real contract is exercised, not simulated.
    const { child, state } = startServer(4613, ['--no-open'], {
      DASHBOARD_IDLE_TIMEOUT_MS: '1500',
    });
    try {
      expect(await waitReady(state)).toBe(true);
      const controller = new AbortController();
      fetch('http://127.0.0.1:4613/events', { signal: controller.signal }).catch(() => {});
      await new Promise((r) => setTimeout(r, 500));

      // Wait well past the idle timeout with the stream held open.
      await new Promise((r) => setTimeout(r, 3500));
      expect(state.exited, 'server must survive while an SSE stream is open').toBeNull();
      expect((await fetch('http://127.0.0.1:4613/latest')).status).toBe(200);

      controller.abort();
    } finally {
      await stop(child);
    }
  });

  test('without an owned tab, a quiet non-browser client keeps its server', async () => {
    // The original bug: a curl/script/MCP client fetched a page, sent no
    // /heartbeat, and lost the server ~20s later. There is no owned tab to
    // reclaim here, so the watchdog must not fire at all.
    const { child, state } = startServer(4614, ['--no-open'], {
      DASHBOARD_IDLE_TIMEOUT_MS: '1500',
    });
    try {
      expect(await waitReady(state)).toBe(true);
      await fetch('http://127.0.0.1:4614/latest'); // one fetch, then silence
      await new Promise((r) => setTimeout(r, 4000)); // 2.5x the idle timeout

      expect(state.exited, 'a --no-open server must outlive its clients').toBeNull();
      expect((await fetch('http://127.0.0.1:4614/latest')).status).toBe(200);
    } finally {
      await stop(child);
    }
  });

  test('a browser-owned server exits on its own once the tab stops responding', async () => {
    // Full watchdog contract with a compressed timeout: started as if it opened
    // a browser, one client shows up, then goes quiet.
    const { child, state } = startServer(4615, [], {
      DASHBOARD_IDLE_TIMEOUT_MS: '1500',
      COMSPEC: 'C:\\nonexistent\\cmd.exe', // OS browser launch fails; test owns the only client
    });
    try {
      expect(await waitReady(state)).toBe(true);
      expect(state.log).toMatch(/Shuts down [\d.]+s after this browser tab closes/);

      await fetch('http://127.0.0.1:4615/latest'); // arm the watchdog
      expect(state.log).toContain('First client request — idle watchdog armed.');

      const deadline = Date.now() + 8000;
      while (state.exited === null && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 200));
      }
      expect(state.exited, 'watchdog should reclaim the server').not.toBeNull();
      expect(state.log).toContain('The browser tab appears closed');
    } finally {
      await stop(child);
    }
  });
});
