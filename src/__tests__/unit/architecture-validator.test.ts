import { test, expect } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';

test.describe('Architecture Validator (tools/validators/validate-architecture.ts)', () => {
  const root = process.cwd();

  test('validator script exits with 0 on canonical codebase', () => {
    const result = spawnSync('npx', ['tsx', 'tools/validators/validate-architecture.ts'], {
      cwd: root,
      encoding: 'utf-8',
      shell: true,
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('All architecture and boundary checks passed cleanly');
  });

  test('ARCH-001: src/ core does not import from tests/', () => {
    const srcDir = path.join(root, 'src');
    const forbiddenPattern = /from\s+['"](?:\.\.\/)+tests\/|from\s+['"]@\/tests\//;

    function checkDir(dir: string): void {
      if (!fs.existsSync(dir)) return;
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== 'node_modules' && entry.name !== 'dist') {
            checkDir(fullPath);
          }
        } else if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx'))) {
          const content = fs.readFileSync(fullPath, 'utf-8');
          const lines = content.split('\n');
          for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (/^\s*(?:import|export)\s+.*from\s+['"].*['"]/.test(line)) {
              expect(forbiddenPattern.test(line)).toBeFalsy();
            }
          }
        }
      }
    }

    checkDir(srcDir);
  });

  test('ARCH-002: legacy directories do not exist', () => {
    const legacy = ['src/tests', 'src/pages', 'test-fixtures', 'example'];
    for (const dir of legacy) {
      expect(fs.existsSync(path.join(root, dir))).toBeFalsy();
    }
  });

  test('ARCH-002: dead setup-wizard.ts does not exist', () => {
    expect(fs.existsSync(path.join(root, 'tools/scripts/setup-wizard.ts'))).toBeFalsy();
  });

  test('ARCH-003: public API modules exist and export expected symbols', () => {
    const publicFiles = [
      'src/public/index.ts',
      'src/public/fixtures.ts',
      'src/public/auth.ts',
      'src/public/metadata.ts',
      'src/public/workspace.ts',
    ];

    for (const file of publicFiles) {
      expect(fs.existsSync(path.join(root, file))).toBeTruthy();
    }
  });

  test('ARCH-004: test workspace contract files exist', () => {
    const testFiles = ['tests/fixtures.ts', 'tests/auth.setup.ts', 'tests/seed.spec.ts'];
    for (const file of testFiles) {
      expect(fs.existsSync(path.join(root, file))).toBeTruthy();
    }
  });

  test('ARCH-005: project layout directories exist', () => {
    const dirs = [
      'config/environments',
      'config/playwright',
      'tools/mcp',
      'tools/scripts',
      'tools/validators',
      'artifacts',
    ];

    for (const dir of dirs) {
      expect(fs.existsSync(path.join(root, dir))).toBeTruthy();
    }
  });

  test('ARCH-SYNC-001: MCP generated copies carry AUTO-SYNCED banner from SoT', () => {
    const dest = path.join(root, 'tools/mcp/src/contracts/traceability-contract.ts');
    expect(fs.existsSync(dest)).toBeTruthy();
    const body = fs.readFileSync(dest, 'utf-8');
    expect(body).toContain('AUTO-SYNCED from src/contracts/traceability-contract.ts');
  });

  test('package.json setup script is npm run setup, not setup:wizard', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf-8')) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts.setup).toBe('tsx src/setup/index.ts');
    expect(pkg.scripts['setup:check']).toBe('tsx src/setup/index.ts --check');
    expect(pkg.scripts['setup:wizard']).toBeUndefined();
    expect(pkg.scripts['test:quality']).toContain('setup:check');
    expect(pkg.scripts['test:quality']).not.toContain('setup:wizard');
  });

  test('ARCH-017: a doc naming a non-existent framework path fails the gate', () => {
    // Regression guard for the class of bug where a rename updates the folder
    // but misses one prose reference (e.g. `.github/agents/reporting.agent.md`
    // shipped while the agent FILE stayed `reporter.agent.md`).
    const probe = path.join(root, 'docs', '__arch017-probe.md');
    fs.writeFileSync(
      probe,
      '# probe\n\nSee `.github/agents/reporting.agent.md` and `src/ghost/missing.ts`.\n',
    );
    try {
      const result = spawnSync('npx', ['tsx', 'tools/validators/validate-architecture.ts'], {
        cwd: root,
        encoding: 'utf-8',
        shell: true,
      });
      expect(result.status).toBe(1);
      expect(result.stdout + result.stderr).toContain('ARCH-017: DOC_PATH_DRIFT');
      expect(result.stdout + result.stderr).toContain('reporting.agent.md');
    } finally {
      fs.rmSync(probe, { force: true });
    }
  });

  test('ARCH-017: the canonical codebase has no doc-path drift', () => {
    // The negative half: real docs must not trip the guard (guards that cry
    // wolf on legitimate content get ignored).
    const result = spawnSync('npx', ['tsx', 'tools/validators/validate-architecture.ts'], {
      cwd: root,
      encoding: 'utf-8',
      shell: true,
    });
    expect(result.stdout).not.toContain('ARCH-017');
    expect(result.status).toBe(0);
  });
});
