import { test, expect } from '@playwright/test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';

/**
 * Gate contract for tools/scripts/skills-mirror-check.ts: the .agents/skills/
 * mirror must be byte-identical to skills/, or the gate fails with the fix
 * (setup:check), never a manual copy.
 */

const SCRIPT = path.join(process.cwd(), 'tools', 'scripts', 'skills-mirror-check.ts');

function makeTempTree(withMirror: boolean): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skills-mirror-'));
  fs.mkdirSync(path.join(root, 'skills', 'pack', 'references'), { recursive: true });
  if (withMirror) {
    fs.mkdirSync(path.join(root, '.agents', 'skills', 'pack', 'references'), { recursive: true });
  }
  return root;
}

function runGate(cwd: string, pack?: string) {
  const env = pack ? { ...process.env, SKILLS_MIRROR_PACK: pack } : process.env;
  return spawnSync('npx', ['tsx', SCRIPT], { cwd, encoding: 'utf-8', shell: true, env });
}

test.describe('skills-mirror-check (mirror parity gate)', () => {
  test('exits 0 when the mirror is absent (fresh checkout)', () => {
    const root = makeTempTree(false);
    try {
      const result = runGate(root, 'pack');
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('not present yet');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('exits 1 with file list when the mirror drifted', () => {
    const root = makeTempTree(true);
    try {
      fs.writeFileSync(path.join(root, 'skills', 'pack', 'SKILL.md'), 'canonical\n');
      fs.writeFileSync(path.join(root, 'skills', 'pack', 'references', 'a.md'), 'A\n');
      // Mirror: same file, different content + one orphan.
      fs.writeFileSync(path.join(root, '.agents', 'skills', 'pack', 'SKILL.md'), 'drifted\n');
      fs.writeFileSync(
        path.join(root, '.agents', 'skills', 'pack', 'references', 'b.md'),
        'orphan\n',
      );

      const result = runGate(root, 'pack');
      const out = result.stdout + result.stderr;
      expect(result.status).toBe(1);
      expect(out).toContain('DRIFTED');
      expect(out).toContain('[content-drift] SKILL.md');
      expect(out).toContain('[missing-in-mirror] references/a.md');
      expect(out).toContain('[missing-in-canonical] references/b.md');
      expect(out).toContain('setup:check');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('exits 0 when canonical and mirror are byte-identical', () => {
    const root = makeTempTree(true);
    try {
      fs.writeFileSync(path.join(root, 'skills', 'pack', 'SKILL.md'), 'same\n');
      fs.writeFileSync(path.join(root, 'skills', 'pack', 'references', 'a.md'), 'A\n');
      fs.writeFileSync(path.join(root, '.agents', 'skills', 'pack', 'SKILL.md'), 'same\n');
      fs.writeFileSync(path.join(root, '.agents', 'skills', 'pack', 'references', 'a.md'), 'A\n');

      const result = runGate(root, 'pack');
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('in sync');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('the real repo tree passes (canonical pack + synced mirror)', () => {
    const result = runGate(process.cwd());
    expect(result.status).toBe(0);
  });
});
