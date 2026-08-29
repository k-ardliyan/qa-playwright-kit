/// <reference types="node" />

/**
 * Numbered picker for requirements/*.md so QA can run
 * `npm run qa:run` / `npm run validate:requirement` without npm `--`.
 *
 * Non-TTY (CI, pipes) never prompts — callers must pass a path.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import prompts from 'prompts';

const SKIP_FILES = new Set(['_TEMPLATE.md', '_GOOD_EXAMPLE.md', '_BAD_EXAMPLE.md', 'README.md']);

export function isInteractiveStdin(): boolean {
  return Boolean(process.stdin.isTTY);
}

export function listRequirementFiles(repoRoot: string): string[] {
  const dir = path.join(repoRoot, 'requirements');
  const out: string[] = [];

  const walk = (current: string): void => {
    if (!fs.existsSync(current)) return;
    for (const name of fs.readdirSync(current)) {
      const full = path.join(current, name);
      const st = fs.statSync(full);
      if (st.isDirectory()) {
        walk(full);
        continue;
      }
      if (!name.endsWith('.md') || SKIP_FILES.has(name) || name.startsWith('_')) continue;
      out.push(path.relative(repoRoot, full).replace(/\\/g, '/'));
    }
  };

  walk(dir);
  return out.sort();
}

export async function pickRequirementFile(repoRoot: string): Promise<string | null> {
  const files = listRequirementFiles(repoRoot);
  if (files.length === 0) return null;
  if (files.length === 1) return files[0] ?? null;

  process.stdout.write('\n');
  files.forEach((file, i) => {
    process.stdout.write(`  ${i + 1}. ${file}\n`);
  });

  const { value } = await prompts({
    type: 'text',
    name: 'value',
    message: `Pilih requirement — ketik angka 1-${files.length} lalu Enter`,
    initial: '1',
    validate: (raw: string) => {
      const n = Number(String(raw).trim());
      if (!Number.isInteger(n) || n < 1 || n > files.length) {
        return `Masukkan angka 1-${files.length}`;
      }
      return true;
    },
  });

  if (value == null) return null;
  const n = Number(String(value).trim());
  return files[n - 1] ?? null;
}
