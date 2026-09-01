/**
 * Shared dotenvx private-key helpers.
 *
 * Rules:
 * - Prefer ~/.dotenvx-keys/<package-name>/.env.keys (outside repo)
 * - Never overwrite an existing global keys file wholesale — merge new DOTENV_PRIVATE_KEY* lines
 * - Migrate config/environments/.env.keys and root .env.keys
 *
 * Used by env-loader and env-edit.
 *
 * @module src/utils/dotenv-keys
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

export function resolveProjectName(repoRoot: string, fallback = 'qa-playwright-kit'): string {
  const pkgPath = path.resolve(repoRoot, 'package.json');
  if (!fs.existsSync(pkgPath)) return fallback;
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8')) as { name?: string };
    return pkg.name?.trim() || fallback;
  } catch {
    return fallback;
  }
}

export function getGlobalKeysDir(repoRoot: string): string {
  return path.resolve(os.homedir(), '.dotenvx-keys', resolveProjectName(repoRoot));
}

export function getGlobalKeysPath(repoRoot: string): string {
  return path.join(getGlobalKeysDir(repoRoot), '.env.keys');
}

export function listWorkspaceKeyCandidates(repoRoot: string): string[] {
  return [
    path.resolve(repoRoot, 'config', 'environments', '.env.keys'),
    path.resolve(repoRoot, '.env.keys'),
  ];
}

export interface MergeKeysResult {
  /** True if local file existed and was processed (merged or copied). */
  migrated: boolean;
  /** Number of new private-key lines added to global file. */
  added: number;
  /** Global keys path after operation. */
  globalKeysPath: string;
}

/**
 * Merge DOTENV_PRIVATE_KEY* entries from a local keys file into the secure global file.
 * Never deletes unrelated existing global keys.
 * Deletes the local file on success.
 */
export function mergeLocalKeysIntoSecure(
  localKeysPath: string,
  globalKeysPath: string,
): MergeKeysResult {
  const result: MergeKeysResult = {
    migrated: false,
    added: 0,
    globalKeysPath,
  };

  if (!fs.existsSync(localKeysPath)) return result;

  const globalDir = path.dirname(globalKeysPath);
  if (!fs.existsSync(globalDir)) {
    fs.mkdirSync(globalDir, { recursive: true });
  }

  const incoming = fs.readFileSync(localKeysPath, 'utf-8');

  if (!fs.existsSync(globalKeysPath)) {
    fs.writeFileSync(globalKeysPath, incoming, 'utf-8');
    // count private keys in incoming
    result.added = countPrivateKeyLines(incoming);
    result.migrated = true;
    fs.unlinkSync(localKeysPath);
    return result;
  }

  const existing = fs.readFileSync(globalKeysPath, 'utf-8');
  const existingKeys = new Set(
    existing
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#') && l.includes('='))
      .map((l) => l.slice(0, l.indexOf('=')).trim()),
  );

  const extraLines: string[] = [];
  for (const raw of incoming.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const key = line.slice(0, line.indexOf('=')).trim();
    if (!key.startsWith('DOTENV_PRIVATE_KEY')) continue;
    if (existingKeys.has(key)) continue;
    extraLines.push(raw.endsWith('\n') ? raw.replace(/\r?\n$/, '') : raw);
    existingKeys.add(key);
  }

  if (extraLines.length > 0) {
    const merged =
      (existing.endsWith('\n') ? existing : existing + '\n') +
      '\n# merged by dotenv-keys helper\n' +
      extraLines.join('\n') +
      '\n';
    fs.writeFileSync(globalKeysPath, merged, 'utf-8');
    result.added = extraLines.length;
  }

  fs.unlinkSync(localKeysPath);
  result.migrated = true;
  return result;
}

function countPrivateKeyLines(text: string): number {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.startsWith('DOTENV_PRIVATE_KEY') && l.includes('=')).length;
}

/**
 * Migrate all known workspace key files under repoRoot into the secure global folder.
 */
export function migrateWorkspaceEnvKeys(repoRoot: string): MergeKeysResult[] {
  const globalPath = getGlobalKeysPath(repoRoot);
  return listWorkspaceKeyCandidates(repoRoot).map((local) =>
    mergeLocalKeysIntoSecure(local, globalPath),
  );
}

/**
 * Resolve secure keys path for runtime decrypt, migrating workspace keys first (merge-safe).
 */
export function resolveSecureKeysPath(repoRoot: string): string {
  migrateWorkspaceEnvKeys(repoRoot);
  return getGlobalKeysPath(repoRoot);
}
