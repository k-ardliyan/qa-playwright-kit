import fs from 'node:fs';
import path from 'node:path';
import { findRepoRoot } from '../shared/workspace-paths';

/** Specs are always listed from the real workspace root, never the launch cwd. */
export function listStudioSpecs(repoRoot: string = findRepoRoot()): string[] {
  const testsDir = path.join(repoRoot, 'tests');
  const out: string[] = [];
  const walk = (dir: string) => {
    if (!fs.existsSync(dir)) return;
    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
      if (item.name === 'node_modules') continue;
      const full = path.join(dir, item.name);
      if (item.isDirectory()) walk(full);
      else if (item.isFile() && item.name.endsWith('.spec.ts') && item.name !== 'auth.setup.ts') {
        const rel = path.relative(repoRoot, full);
        if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) continue;
        const posix = rel.split(path.sep).join('/');
        if (posix.startsWith('tests/')) out.push(posix);
      }
    }
  };
  walk(testsDir);
  out.sort();
  return out;
}
