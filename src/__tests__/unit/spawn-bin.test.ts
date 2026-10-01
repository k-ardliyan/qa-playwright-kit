import { test, expect } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  binSpawn,
  localBin,
  npmCommand,
  npmSpawn,
  localPackageSpawn,
  describeSpawn,
  resolveNpmCli,
} from '@/setup/spawn-bin';
import { resolveMcpLaunchSpawn } from '../../../tools/scripts/playwright-mcp-launch';

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

  /**
   * The regression that shipped: `npx` + `shell: true` concatenated argv into a
   * command line, so an absolute path containing spaces was split and
   * `@playwright/mcp` exited with `too many arguments` — the whole browser MCP
   * server never started. Every test machine had a space-free path, so nothing
   * caught it. These assertions pin the spawn plan: shell-free, argv intact.
   */
  test('localPackageSpawn runs a repo entry with no shell and argv intact', () => {
    const repoRoot = process.cwd();
    const plan = localPackageSpawn(repoRoot, 'node_modules/@playwright/mcp/cli.js', [
      '--output-dir=/tmp/My Project/artifacts',
    ]);
    expect(plan).not.toBeNull();
    expect(plan!.shell).toBe(false);
    expect(plan!.command).toBe(process.execPath);
    expect(plan!.args[0]).toBe(path.join(repoRoot, 'node_modules', '@playwright', 'mcp', 'cli.js'));
    // The spaced path stays exactly ONE argv entry — the whole bug.
    expect(plan!.args[1]).toBe('--output-dir=/tmp/My Project/artifacts');
    expect(plan!.args).toHaveLength(2);
  });

  test('localPackageSpawn returns null for a missing entry so callers can fall back', () => {
    expect(
      localPackageSpawn(process.cwd(), 'node_modules/@playwright/mcp/does-not-exist.js', []),
    ).toBeNull();
  });

  test('describeSpawn quotes only the entries that need it', () => {
    const line = describeSpawn({
      command: 'C:/Program Files/node/node.exe',
      args: ['--output-dir=/tmp/My Project/x', '--headless'],
      shell: false,
    });
    expect(line).toBe(
      '"C:/Program Files/node/node.exe" "--output-dir=/tmp/My Project/x" --headless',
    );
  });

  test('the browser MCP launch plan survives a repo path with spaces', () => {
    const plan = resolveMcpLaunchSpawn(process.cwd(), ['--headless', '--output-dir=/tmp/a b/c d']);
    expect(plan.shell).toBe(false);
    expect(plan.command).toBe(process.execPath);
    expect(plan.args).toContain('--output-dir=/tmp/a b/c d');
    // No npx, no cmd.exe, no interpolation anywhere in the plan.
    expect(plan.args.join(' ')).not.toContain('npx');
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
