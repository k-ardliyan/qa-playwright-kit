import { test, expect } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as os from 'node:os';
import path from 'node:path';

/** Persistent development-server and report-watch contracts. */
const SERVER = path.resolve(__dirname, '../dashboard-server.ts');
const TSX = path.resolve(__dirname, '../../../node_modules/tsx/dist/cli.mjs');

function startServer(port: number, reportDir: string) {
  const child = spawn(process.execPath, [TSX, SERVER, `--port=${port}`, '--no-open'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, QA_REPORT_DIR: reportDir },
  });
  const state = { log: '', exited: null as number | null };
  child.stdout.on('data', (d) => (state.log += d.toString()));
  child.stderr.on('data', (d) => (state.log += d.toString()));
  child.on('exit', (code) => (state.exited = code));
  return { child, state };
}

async function waitReady(state: { log: string }) {
  for (let i = 0; i < 80 && !state.log.includes('Dashboard running'); i++) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return state.log.includes('Dashboard running');
}

async function stop(child: ChildProcess) {
  if (child.exitCode === null) child.kill();
  await new Promise((resolve) => setTimeout(resolve, 300));
}

function openSse(port: number, onChunk: (chunk: string) => void) {
  const request = http.get(`http://127.0.0.1:${port}/events`, (response) => {
    response.setEncoding('utf8');
    response.on('data', onChunk);
  });
  return () => request.destroy();
}

async function waitFor(predicate: () => boolean, timeoutMs = 3000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return predicate();
}

test.describe('dashboard dev server lifecycle', () => {
  test('no-open mode stays persistent and does not announce an opener', async () => {
    const reportDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dashboard-server-'));
    const { child, state } = startServer(4610, reportDir);
    try {
      expect(await waitReady(state)).toBe(true);
      expect(state.log).toContain('http://localhost:4610');
      expect(state.log).toContain('Source changes restart with npm run dashboard');
      expect(state.log).not.toContain('Shuts down');
      expect((await fetch('http://127.0.0.1:4610/heartbeat')).status).toBe(200);
      await new Promise((resolve) => setTimeout(resolve, 400));
      expect(state.exited).toBeNull();
    } finally {
      await stop(child);
      fs.rmSync(reportDir, { recursive: true, force: true });
    }
  });

  test('SSE identifies its server instance and reports debounced dashboard file changes', async () => {
    const reportDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dashboard-watch-'));
    const { child, state } = startServer(4611, reportDir);
    let closeStream = () => {};
    try {
      expect(await waitReady(state)).toBe(true);
      let received = '';
      closeStream = openSse(4611, (chunk) => (received += chunk));
      expect(await waitFor(() => received.includes('event: server-ready'))).toBe(true);
      expect(received).toMatch(/"instanceId":"[\w-]+"/);

      received = '';
      fs.writeFileSync(path.join(reportDir, 'unrelated.log'), 'ignore');
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(received).not.toContain('report-updated');

      fs.writeFileSync(path.join(reportDir, 'test-summary.json'), '{}');
      fs.writeFileSync(path.join(reportDir, '.latest-run'), '{}');
      fs.writeFileSync(path.join(reportDir, 'custom-dashboard.html'), '<!doctype html>');
      expect(await waitFor(() => received.includes('event: report-updated'))).toBe(true);
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(received.match(/event: report-updated/g)).toHaveLength(1);

      received = '';
      const stylesDir = path.resolve(__dirname, '../../support/custom-dashboard/styles');
      const watchedStyle = path.join(stylesDir, 'tokens.css');
      fs.utimesSync(watchedStyle, new Date(), new Date(Date.now() + 1000));
      expect(await waitFor(() => received.includes('event: dashboard-updated'))).toBe(true);
      expect(state.exited).toBeNull();
    } finally {
      closeStream();
      await stop(child);
      fs.rmSync(reportDir, { recursive: true, force: true });
    }
  });
});
