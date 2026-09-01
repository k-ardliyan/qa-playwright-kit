/**
 * Secret-key classification + dotenvx encrypt/decrypt for env files.
 *
 * Encrypt ONLY credential values (`*_PASSWORD`, `*_SECRET`, `*_TOKEN`, plus
 * a small explicit list). URLs, flags, identifiers stay plaintext so QA can
 * edit them in the file without `env:edit`.
 *
 * Keypair rule: NEVER inject DOTENV_PRIVATE_KEY* into the dotenvx child
 * environment. Stale process.env keys + a newly minted public key =
 * DECRYPTION_FAILED. Pass `-fk` to the global keys file when it exists;
 * otherwise let dotenvx mint a coherent pair next to the env file, then merge.
 *
 * @module src/utils/env-secrets
 */

import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { parseEnvText } from './env-text';
import { getGlobalKeysPath, migrateWorkspaceEnvKeys } from './dotenv-keys';

/** Extra keys that are secrets even without a `_PASSWORD` / `_SECRET` / `_TOKEN` suffix. */
const NAMED_SECRET_KEYS = new Set(['PASSWORD', 'SECRET', 'TOKEN', 'API_KEY', 'AUTH_TOKEN']);

/**
 * True when this env key must be ciphertext on disk.
 * Identifiers (EMAIL/USERNAME/PHONE), URLs, flags: false.
 */
export function isSecretEnvKey(key: string): boolean {
  const k = key.trim().toUpperCase();
  if (!k || k.startsWith('DOTENV_')) return false;
  if (NAMED_SECRET_KEYS.has(k)) return true;
  return /_(PASSWORD|SECRET|TOKEN|API_KEY)$/.test(k);
}

export function secretKeysFromEnvText(text: string): string[] {
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const key = line.slice(0, line.indexOf('=')).trim();
    if (!isSecretEnvKey(key) || seen.has(key)) continue;
    seen.add(key);
    keys.push(key);
  }
  return keys;
}

export interface EncryptSecretsResult {
  encryptedKeys: string[];
  skipped: boolean;
}

export class EnvEncryptError extends Error {
  constructor(
    message: string,
    readonly detail?: string,
  ) {
    super(message);
    this.name = 'EnvEncryptError';
  }
}

function execErrorText(err: unknown): string {
  const e = err as { stderr?: string; stdout?: string; message?: string };
  const raw = String(e.stderr || e.stdout || e.message || err).trim();
  const first = raw.split(/\r?\n/).find((l) => l.trim().length > 0);
  return first ?? 'unknown dotenvx error';
}

/**
 * Child env for dotenvx: no inherited `DOTENV_PRIVATE_KEY*` (stale keys +
 * a newly minted public key = DECRYPTION_FAILED), and no inherited values for
 * keys that live in the file being processed. dotenvx merges process.env OVER
 * file values — a stale inherited BASE_URL/PASSWORD would otherwise be
 * re-encrypted into the file or printed by `decrypt --stdout`.
 */
function buildChildEnv(filePath?: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith('DOTENV_PRIVATE_KEY')) delete env[key];
  }
  if (filePath) {
    try {
      for (const key of Object.keys(parseEnvText(fs.readFileSync(filePath, 'utf-8')))) {
        delete env[key];
      }
    } catch {
      // unreadable file — the dotenvx operation will fail on its own
    }
  }
  return env;
}

function quoteForCmd(p: string): string {
  return `"${p.replace(/"/g, '\\"')}"`;
}

function runDotenvx(args: string, cwd: string, filePath?: string): string {
  return execSync(`npx @dotenvx/dotenvx ${args}`, {
    cwd,
    encoding: 'utf-8',
    env: buildChildEnv(filePath),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function localKeysPath(envDir: string): string {
  return path.join(envDir, '.env.keys');
}

function resolveKeysFile(repoRoot: string, envDir: string, extra?: string | null): string | null {
  const candidates = [
    extra ?? '',
    getGlobalKeysPath(repoRoot),
    localKeysPath(envDir),
    path.join(repoRoot, '.env.keys'),
  ];
  for (const p of candidates) {
    if (p && fs.existsSync(p)) return p;
  }
  return null;
}

function restorePlaintext(filePath: string, plaintext: string): void {
  try {
    fs.writeFileSync(filePath, plaintext, 'utf-8');
  } catch {
    // last resort — caller still throws
  }
}

/**
 * Encrypt secret keys in `filePath` in place. Non-secret keys stay plaintext.
 * Keys minted next to the file are merged into ~/.dotenvx-keys/<project>/.
 * On decrypt-verify failure the original plaintext is restored.
 */
export function encryptSecretKeysInFile(
  filePath: string,
  opts: { repoRoot: string; keysPath?: string | null } = { repoRoot: process.cwd() },
): EncryptSecretsResult {
  const repoRoot = opts.repoRoot;
  const envDir = path.dirname(filePath);
  const plaintext = fs.readFileSync(filePath, 'utf-8');
  const secretKeys = secretKeysFromEnvText(plaintext);

  if (secretKeys.length === 0) {
    return { encryptedKeys: [], skipped: true };
  }

  const quotedFile = quoteForCmd(filePath);
  const keyFlags = secretKeys.map((k) => `-k ${k}`).join(' ');
  const globalKeys = getGlobalKeysPath(repoRoot);
  const preferredFk = opts.keysPath && fs.existsSync(opts.keysPath) ? opts.keysPath : null;

  const attempts: string[] = [];
  // Reuse an existing keys file when present so dotenvx does not mint a new
  // public key against a leftover private key of the same name.
  if (preferredFk) {
    attempts.push(`encrypt -f ${quotedFile} -fk ${quoteForCmd(preferredFk)} ${keyFlags} --quiet`);
  }
  if (fs.existsSync(globalKeys) && preferredFk !== globalKeys) {
    attempts.push(`encrypt -f ${quotedFile} -fk ${quoteForCmd(globalKeys)} ${keyFlags} --quiet`);
  }
  // Mint a coherent pair next to the env file (no inherited private keys).
  attempts.push(`encrypt -f ${quotedFile} ${keyFlags} --quiet`);

  let lastErr = '';
  let encrypted = false;
  for (const cmd of attempts) {
    try {
      runDotenvx(cmd, repoRoot, filePath);
      encrypted = true;
      break;
    } catch (err: unknown) {
      lastErr = execErrorText(err);
    }
  }

  if (!encrypted) {
    restorePlaintext(filePath, plaintext);
    throw new EnvEncryptError('Gagal encrypt secret keys di env file', lastErr || undefined);
  }

  try {
    migrateWorkspaceEnvKeys(repoRoot);
  } catch {
    // non-fatal — verify below still needs a keys file
  }

  const keysForDecrypt = resolveKeysFile(repoRoot, envDir, preferredFk);
  try {
    const decryptArgs = keysForDecrypt
      ? `decrypt -f ${quotedFile} -fk ${quoteForCmd(keysForDecrypt)} --stdout --quiet`
      : `decrypt -f ${quotedFile} --stdout --quiet`;
    runDotenvx(decryptArgs, repoRoot, filePath);
  } catch (err: unknown) {
    restorePlaintext(filePath, plaintext);
    throw new EnvEncryptError(
      'Encrypt selesai tapi file tidak bisa di-decrypt ulang',
      execErrorText(err),
    );
  }

  // Drop dotenvx's ASCII box + machine-specific `-fk` comment after verification.
  normalizeDotenvxBannerInFile(filePath);

  return { encryptedKeys: secretKeys, skipped: false };
}

/** Decrypt env file to plaintext string without rewriting disk. */
export function decryptEnvFileToText(
  filePath: string,
  opts: { repoRoot: string; keysPath?: string | null },
): string {
  const raw = fs.readFileSync(filePath, 'utf-8');
  if (!raw.includes('encrypted:')) return raw;

  const keysPath = resolveKeysFile(opts.repoRoot, path.dirname(filePath), opts.keysPath ?? null);
  if (!keysPath) {
    throw new EnvEncryptError(
      'File env terenkripsi tapi kunci tidak ditemukan',
      'Kunci dekripsi biasanya di ~/.dotenvx-keys/<package-name>/.env.keys — tidak ikut Git.',
    );
  }

  const quotedFile = quoteForCmd(filePath);
  try {
    return String(
      runDotenvx(
        `decrypt -f ${quotedFile} -fk ${quoteForCmd(keysPath)} --stdout --quiet`,
        opts.repoRoot,
        filePath,
      ),
    );
  } catch (err: unknown) {
    throw new EnvEncryptError('Gagal decrypt env file', execErrorText(err));
  }
}

/**
 * Strip dotenvx cosmetic noise, keeping the functional DOTENV_PUBLIC_KEY line:
 * - the `#/---[DOTENV_PUBLIC_KEY]---/` ASCII box
 * - the trailing `# -fk <machine-specific path>` comment on the key line
 * - the `# <basename>` filename marker line dotenvx prepends
 */
export function normalizeDotenvxBanner(text: string, basename?: string): string {
  const lines = text.split(/\r?\n/);
  const out: string[] = [];
  for (const line of lines) {
    if (line.startsWith('#/')) continue;
    if (/^DOTENV_PUBLIC_KEY[^=]*=/.test(line)) {
      out.push(line.replace(/\s+#\s.*$/, ''));
      continue;
    }
    if (basename && line.trim() === `# ${basename}`) continue;
    out.push(line);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n');
}

/** Rewrite `filePath` in place with the dotenvx banner normalized. */
export function normalizeDotenvxBannerInFile(filePath: string): void {
  const before = fs.readFileSync(filePath, 'utf-8');
  const after = normalizeDotenvxBanner(before, path.basename(filePath));
  if (after !== before) {
    fs.writeFileSync(filePath, after, 'utf-8');
  }
}
