import { test, expect } from '@playwright/test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { MCP_GENERATED_PAIRS, syncMcpGenerated } from '../../../tools/scripts/sync-mcp-generated';

test.describe('sync:mcp-generated (SoT → MCP copy)', () => {
  const root = process.cwd();
  const script = path.join(root, 'tools', 'scripts', 'sync-mcp-generated.ts');

  function runCheck(): { status: number | null; stdout: string; stderr: string } {
    const result = spawnSync('npx', ['tsx', script, '--check'], {
      cwd: root,
      encoding: 'utf-8',
      shell: true,
    });
    return {
      status: result.status,
      stdout: String(result.stdout ?? ''),
      stderr: String(result.stderr ?? ''),
    };
  }

  function seedTmpTree(): string {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-sync-'));
    for (const pair of MCP_GENERATED_PAIRS) {
      const tmpSrc = path.join(tmp, pair.source);
      fs.mkdirSync(path.dirname(tmpSrc), { recursive: true });
      fs.copyFileSync(path.join(root, pair.source), tmpSrc);
    }
    return tmp;
  }

  test('CLI --check exits 0 on the live tree (read-only)', () => {
    const check = runCheck();
    expect(check.status, check.stderr || check.stdout).toBe(0);
    expect(check.stdout).toContain('in sync');
  });

  test('live dest copies carry AUTO-SYNCED banner pointing at src/contracts', () => {
    const dest = path.join(root, 'tools', 'mcp', 'src', 'contracts', 'traceability-contract.ts');
    const body = fs.readFileSync(dest, 'utf-8');
    expect(body).toMatch(/^\/\*\*\n \* AUTO-SYNCED from src\/contracts\/traceability-contract\.ts/);
    expect(body).toContain('export interface CoverageStateBreakdown');
  });

  test('write then --check succeeds on an isolated tree', () => {
    const tmp = seedTmpTree();
    try {
      const write = syncMcpGenerated(tmp, false);
      expect(write.ok).toBe(true);
      expect(write.mismatches).toEqual([]);
      expect(write.missingSources).toEqual([]);

      const check = syncMcpGenerated(tmp, true);
      expect(check.ok).toBe(true);

      const dest = path.join(tmp, 'tools/mcp/src/contracts/traceability-contract.ts');
      const body = fs.readFileSync(dest, 'utf-8');
      expect(
        body.startsWith('/**\n * AUTO-SYNCED from src/contracts/traceability-contract.ts'),
      ).toBe(true);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('--check fails when dest diverges from SoT', () => {
    const tmp = seedTmpTree();
    try {
      const write = syncMcpGenerated(tmp, false);
      expect(write.ok).toBe(true);

      const drifted = path.join(tmp, MCP_GENERATED_PAIRS[0].dest);
      fs.appendFileSync(drifted, '\n// DRIFT\n');

      const check = syncMcpGenerated(tmp, true);
      expect(check.ok).toBe(false);
      expect(check.mismatches).toContain(MCP_GENERATED_PAIRS[0].dest.replace(/\\/g, '/'));
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('--check fails when dest is missing', () => {
    const tmp = seedTmpTree();
    try {
      const check = syncMcpGenerated(tmp, true);
      expect(check.ok).toBe(false);
      expect(check.mismatches.length).toBe(MCP_GENERATED_PAIRS.length);
      expect(check.mismatches[0]).toContain('(missing)');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('--check fails when a source of truth is missing', () => {
    const tmp = seedTmpTree();
    try {
      fs.rmSync(path.join(tmp, MCP_GENERATED_PAIRS[0].source));
      const check = syncMcpGenerated(tmp, true);
      expect(check.ok).toBe(false);
      expect(check.missingSources).toContain(MCP_GENERATED_PAIRS[0].source.replace(/\\/g, '/'));
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
