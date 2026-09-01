/**
 * Environment Loader for the Playwright AI Agent Framework.
 *
 * Selects and loads the correct per-environment `.env` file from
 * `config/environments/` based on resolved APP_ENV (see `resolveAppEnv`).
 *
 * Logic flow:
 * 1. Resolve APP_ENV: OS → pin (config/environments/.active-env) → default local
 * 2. invalid_os / invalid_pin → warn + fall back to local
 * 3. default → info (not warn)
 * 4. Try loading candidates in order:
 *    a. config/environments/{APP_ENV}.env         (primary — real credentials)
 *    b. config/environments/{APP_ENV}.env.example (fallback — template, warns)
 * 5. Encrypted primary + no decryption key → throw (never load dummy template)
 * 6. If no candidate exists → throw descriptive Error listing all paths tried
 * 7. Set process.env.APP_ENV (+ APP_ENV_SOURCE)
 * 8. Log success at info level
 * 9. Optionally overlay adapter-specific env files (non-overriding)
 *
 * Supported environments: local | dev | staging | production
 *
 * @see Requirements 5.2, 5.3, 5.4, 5.5, 5.6
 */

import * as fs from 'fs';
import * as path from 'path';
import dotenvx from '@dotenvx/dotenvx';
import { resolveAppEnv, type AppEnv } from './app-env';
import { logger } from './logger';
import { resolveSecureKeysPath } from './dotenv-keys';

export interface AdapterEnvRef {
  dir: string;
  name: string;
}

export interface LoadEnvironmentOptions {
  /** Overlay adapter-specific defaults after core load (non-overriding). */
  adapterEnv?: AdapterEnvRef;
}

/**
 * Resolve secure dotenvx keys path (merge-migrates workspace .env.keys first).
 * Never overwrites existing global private keys wholesale.
 */
export function getSecureKeysPath(): string {
  // Climb up to find the repository root (package.json present)
  let repoRoot = __dirname;
  while (true) {
    const pkgPath = path.join(repoRoot, 'package.json');
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as { name?: string };
        // Prefer monorepo / kit root when name matches; otherwise keep climbing
        // until filesystem root, then fall back to cwd.
        if (pkg.name) {
          // Accept any package.json as repo root once found near project
          break;
        }
      } catch {
        // ignore
      }
    }
    const parent = path.dirname(repoRoot);
    if (parent === repoRoot) {
      repoRoot = process.cwd();
      break;
    }
    repoRoot = parent;
  }

  // Prefer cwd if it looks like the project root (has env dir)
  if (fs.existsSync(path.join(process.cwd(), 'config', 'environments'))) {
    repoRoot = process.cwd();
  }

  try {
    const secure = resolveSecureKeysPath(repoRoot);
    return secure;
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    logger.warn(`[SECURITY] Failed to resolve/migrate dotenv keys: ${errMsg}`);
    return path.resolve(repoRoot, 'config', 'environments', '.env.keys');
  }
}

/**
 * Resolves APP_ENV (OS → pin → default), selects the matching file from
 * `config/environments/`, and loads it into `process.env` via dotenvx.
 *
 * Lookup order (first match wins):
 * 1. `config/environments/{APP_ENV}.env`          — primary (real credentials)
 * 2. `config/environments/{APP_ENV}.env.example`  — template fallback
 *
 * When `options.adapterEnv` is set, overlays `{dir}/{name}.env` then
 * `{dir}/{name}.env.example` without overwriting keys already set by core load.
 *
 * Defaults to `local` when APP_ENV is unset (info) or unrecognised (warn).
 *
 * @throws {Error} If no candidate file is found, with a list of all paths tried.
 */
export function loadEnvironment(options?: LoadEnvironmentOptions): void {
  const cwd = process.cwd();
  const resolved = resolveAppEnv({ repoRoot: cwd });
  const appEnv: AppEnv = resolved.appEnv;

  if (resolved.source === 'invalid_os') {
    logger.warn(`APP_ENV has unrecognised value: "${resolved.rawOsValue}" — falling back to local`);
  } else if (resolved.source === 'invalid_pin') {
    logger.warn(
      `config/environments/.active-env has unrecognised value: "${resolved.rawPinValue}" — falling back to local`,
    );
  } else if (resolved.source === 'default') {
    logger.info('Using default APP_ENV=local (config/environments/local.env)');
  } else if (resolved.source === 'pin') {
    logger.info(`Using APP_ENV=${appEnv} from config/environments/.active-env`);
  }
  // source === 'os' → silent (explicit operator intent)

  // Publish resolved selector for downstream readers (auth paths, status, reports)
  process.env.APP_ENV = appEnv;
  process.env.APP_ENV_SOURCE = resolved.source;

  // Requirement 5.4: try candidates in order — primary first, then template fallback
  const candidates = [
    {
      resolvedPath: path.resolve(cwd, `config/environments/${appEnv}.env`),
      label: `config/environments/${appEnv}.env`,
      isTemplate: false,
    },
    {
      resolvedPath: path.resolve(cwd, `config/environments/${appEnv}.env.example`),
      label: `config/environments/${appEnv}.env.example`,
      isTemplate: true,
    },
  ];

  const loaded = candidates.find((c) => fs.existsSync(c.resolvedPath));

  if (!loaded) {
    throw new Error(
      `Environment file not found for '${appEnv}'.\n` +
        `Tried:\n` +
        candidates.map((c) => `  - ${c.label}`).join('\n') +
        `\n\nCreate config/environments/${appEnv}.env with your credentials.`,
    );
  }

  if (loaded.isTemplate) {
    logger.warn(
      `config/environments/${appEnv}.env not found — loading template '${loaded.label}'. ` +
        `Create config/environments/${appEnv}.env and replace placeholder values before running tests.`,
    );
  } else {
    // [SECURITY GUARD] Fail fast when the primary file is encrypted (contains
    // `encrypted:`) but no decryption key is available. Silently loading the
    // placeholder template here would run tests with dummy credentials and
    // produce confusing login failures — the root cause is the env setup.
    // Plaintext files (CI-materialized secrets, local unencrypted) load as-is —
    // missing keys alone must NOT discard a real config/environments/{APP_ENV}.env.
    const fileText = fs.readFileSync(loaded.resolvedPath, 'utf8');
    const isEncrypted = fileText.includes('encrypted:');

    if (isEncrypted) {
      const secureKeysPath = getSecureKeysPath();
      const appEnvUpper = appEnv.toUpperCase();
      const hasEnvKey =
        process.env.DOTENV_PRIVATE_KEY ||
        process.env[`DOTENV_PRIVATE_KEY_${appEnvUpper}DEVELOPMENT`] ||
        process.env[`DOTENV_PRIVATE_KEY_${appEnvUpper}`];

      if (!fs.existsSync(secureKeysPath) && !hasEnvKey) {
        throw new Error(
          `Encrypted config/environments/${appEnv}.env found but no dotenvx private key is available.\n` +
            `Tried:\n` +
            `  - ${path.relative(cwd, secureKeysPath)}\n` +
            `  - env DOTENV_PRIVATE_KEY / DOTENV_PRIVATE_KEY_${appEnvUpper}\n\n` +
            `Fix: restore ~/.dotenvx-keys/<project>/.env.keys (shared securely, not via Git), ` +
            `or recreate the env file with 'npm run setup' / 'npm run env:edit'.\n` +
            `See docs/CREDENTIALS.md.`,
        );
      }
    }
  }

  // Requirement 5.5 (via dotenv): load the selected environment file
  dotenvx.config({
    path: loaded.resolvedPath,
    envKeysFile: getSecureKeysPath(),
  });

  // APP_ENV is the sole patent selector — re-assert after dotenv (file must not hijack it)
  process.env.APP_ENV = appEnv;
  process.env.APP_ENV_SOURCE = resolved.source;

  // Requirement 5.6: log success at info level
  logger.info(`Loaded environment '${appEnv}' from ${loaded.label}`);

  if (options?.adapterEnv) {
    loadAdapterEnvOverlay(options.adapterEnv, cwd);
  }
}

function loadAdapterEnvOverlay(adapterEnv: AdapterEnvRef, cwd: string): void {
  const overlayCandidates = [
    {
      resolvedPath: path.resolve(cwd, adapterEnv.dir, `${adapterEnv.name}.env`),
      label: `${adapterEnv.dir}/${adapterEnv.name}.env`,
    },
    {
      resolvedPath: path.resolve(cwd, adapterEnv.dir, `${adapterEnv.name}.env.example`),
      label: `${adapterEnv.dir}/${adapterEnv.name}.env.example`,
    },
  ];

  for (const candidate of overlayCandidates) {
    if (!fs.existsSync(candidate.resolvedPath)) {
      continue;
    }

    dotenvx.config({
      path: candidate.resolvedPath,
      override: false,
      envKeysFile: path.resolve(cwd, path.dirname(candidate.resolvedPath), '.env.keys'),
    });
    logger.info(`Loaded adapter env overlay from ${candidate.label}`);
    return;
  }

  logger.warn(
    `Adapter env overlay not found for '${adapterEnv.name}'. Tried:\n` +
      overlayCandidates.map((c) => `  - ${c.label}`).join('\n'),
  );
}
