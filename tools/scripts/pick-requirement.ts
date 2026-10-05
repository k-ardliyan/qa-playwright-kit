/// <reference types="node" />

/**
 * Picker for requirements/*.md so QA can run
 * `npm run qa:run` / `npm run validate:requirement` without npm `--`.
 *
 * Non-TTY (CI, pipes) never prompts — callers must pass a path.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { abortIfCancelled, isInteractive, select } from '../../src/setup/prompts/clack';

// Every `_`-prefixed file is skipped below, so only README needs naming here.
const SKIP_FILES = new Set(['README.md']);

export function isInteractiveStdin(): boolean {
  return isInteractive();
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

  // `select` needs a TTY; callers already gate on isInteractiveStdin(), so this
  // is a safety net rather than a normal path.
  if (!isInteractive()) return null;

  const chosen = abortIfCancelled(
    await select<string>({
      message: 'Pilih requirement / Choose a requirement',
      options: files.map((file) => ({ value: file, label: file })),
    }),
    'Dibatalkan.',
  );
  return chosen;
}
