import { test, expect } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { binSpawn, localBin, npmCommand, npmSpawn, resolveNpmCli } from '@/setup/spawn-bin';

/**
 * Regression: spawning `npm.cmd` is not portable.
 *
 * - `shell: false` → Node >=18.20 refuses `.cmd` with EINVAL (CVE-2024-27980).
 * - `shell: true`  → needs `cmd.exe` on PATH; hosts shipping their own Node
 *   (Hermes, portable installs) fail ENOENT.
 * Both leave `status === null`, so the step silently does nothing — which is
 * exactly how `npm ci --prefix tools/mcp failed: undefined` shipped.
 *
 * `npmSpawn()` must resolve npm's JS entry and run it with `process.execPath`,
 * no shell. Verified against the real Node running this suite.
 */
test.describe('spawn-bin npm portability', () => {
  test('resolveNpmCli finds npm-cli.js next to the running node', () => {
    const cli = resolveNpmCli();
    expect(cli, 'npm-cli.js should resolve next to process.execPath').not.toBeNull();
    expect(fs.existsSync(cli as string)).toBe(true);
  });

  test('npmSpawn runs without a shell and returns a real exit code', () => {
    const spec = npmSpawn(['--version']);
    expect(spec.shell).toBe(false);
    expect(spec.command).toBe(process.execPath);

    const res = spawnSync(spec.command, spec.args, {
      encoding: 'utf-8',
      shell: spec.shell,
      timeout: 60_000,
    });
    // The whole point: status must be a number, never null (the silent-failure shape).
    expect(res.status, `spawn error: ${res.error?.message ?? 'none'}`).toBe(0);
    expect((res.stdout ?? '').trim()).toMatch(/^\d+\.\d+\.\d+/);
  });

  test('resolveNpmCli falls back to the sibling lib/ tree (CI layout)', () => {
    // GitHub Actions' hostedtoolcache keeps npm in `<node>/../lib/node_modules`,
    // not under the node binary. install-mcp-server.cjs shipped with only the
    // first candidate and hard-failed there (Cannot find module npm-cli.js).
    const nodeDir = path.join(process.cwd(), '.tmp-ci-layout');
    const fakeExec = path.join(nodeDir, 'bin', 'node');
    const libCli = path.join(nodeDir, 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js');
    fs.mkdirSync(path.dirname(libCli), { recursive: true });
    fs.writeFileSync(libCli, '');

    try {
      const resolved = resolveNpmCli(fakeExec);
      expect(resolved, 'the lib/ candidate must be reachable').toBe(libCli);
    } finally {
      fs.rmSync(nodeDir, { recursive: true, force: true });
    }
  });

  test('install-mcp-server.cjs uses the same two-candidate lookup', () => {
    // The .cjs shim predates spawn-bin and had its own single-path copy; keep
    // them from drifting apart again.
    const source = fs.readFileSync(
      path.join(process.cwd(), 'tools', 'scripts', 'install-mcp-server.cjs'),
      'utf-8',
    );
    expect(source).toContain("'..'");
    expect(source).toContain("'lib'");
    expect(source).toContain('existsSync');
  });

  test('the old shape (npm.cmd, shell:false) is demonstrably broken on win32', () => {
    test.skip(process.platform !== 'win32', 'Windows-only regression');
    const res = spawnSync(npmCommand(), ['--version'], { shell: false, encoding: 'utf-8' });
    // EINVAL → status null. If Node ever changes this, the guard in npmSpawn
    // becomes redundant but stays harmless; this assertion documents why.
    expect(res.status === null || res.error !== undefined).toBe(true);
  });

  test('binSpawn / localBin keep their platform contracts', () => {
    expect(binSpawn('npm', ['x'], 'win32')).toEqual({ command: 'npm', args: ['x'], shell: true });
    expect(binSpawn('npm', ['x'], 'linux')).toEqual({ command: 'npm', args: ['x'], shell: false });
    expect(npmCommand('win32')).toBe('npm.cmd');
    expect(npmCommand('linux')).toBe('npm');
    expect(
      localBin('C:/repo', 'tsx', 'win32').endsWith(path.join('node_modules', '.bin', 'tsx.cmd')),
    ).toBe(true);
  });

  test('agent-sync reports a real error message instead of undefined', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'src', 'setup', 'agent-sync.ts'),
      'utf-8',
    );
    // The old expression `stderr || stdout` is `undefined` when the spawn never
    // starts — the message QA saw. A real diagnosis names the cause.
    expect(source).toContain('ciRes.error?.message');
    expect(source).toContain('buildRes.error?.message');
    expect(source).toContain('npmSpawn');
  });
});
