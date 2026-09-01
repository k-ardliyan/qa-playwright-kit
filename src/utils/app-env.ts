/**
 * APP_ENV control plane — single source of truth for which environment profile is active.
 *
 * Resolution order:
 * 1. process.env.APP_ENV (CI / one-shot shell) — always wins when valid
 * 2. config/environments/.active-env pin (local only; ignored when CI=true)
 * 3. default = local
 *
 * @module src/utils/app-env
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

export const KNOWN_APP_ENVS = ['local', 'dev', 'staging', 'production'] as const;
export type AppEnv = (typeof KNOWN_APP_ENVS)[number];
export type AppEnvSource = 'os' | 'pin' | 'default' | 'invalid_os' | 'invalid_pin';

export const ACTIVE_ENV_FILENAME = '.active-env';

export interface ResolveAppEnvOptions {
  repoRoot: string;
  /** Inject pin text in tests; when undefined, read file from disk. null = no pin. */
  pinFileContents?: string | null;
  /** Override CI detection */
  ci?: boolean;
}

export interface ResolvedAppEnv {
  appEnv: AppEnv;
  source: AppEnvSource;
  /** Absolute path to {envDir}/{appEnv}.env (canonical: config/environments/) */
  filePath: string;
  /** Absolute path to {envDir}/.active-env (canonical: config/environments/) */
  pinPath: string;
  rawOsValue?: string;
  rawPinValue?: string;
}

export function isKnownAppEnv(value: string): value is AppEnv {
  return (KNOWN_APP_ENVS as readonly string[]).includes(value);
}

export function getEnvironmentsDir(repoRoot: string): string {
  return path.join(repoRoot, 'config', 'environments');
}

export function readActiveEnvPin(repoRoot: string): string | null {
  const pinPath = path.join(getEnvironmentsDir(repoRoot), ACTIVE_ENV_FILENAME);
  if (!fs.existsSync(pinPath)) return null;
  const raw = fs.readFileSync(pinPath, 'utf8').trim();
  return raw.length > 0 ? raw : null;
}

export function writeActiveEnvPin(repoRoot: string, appEnv: AppEnv): string {
  const envDir = getEnvironmentsDir(repoRoot);
  if (!fs.existsSync(envDir)) fs.mkdirSync(envDir, { recursive: true });
  const pinPath = path.join(envDir, ACTIVE_ENV_FILENAME);
  fs.writeFileSync(pinPath, `${appEnv}\n`, 'utf8');
  return pinPath;
}

function envFilePath(repoRoot: string, appEnv: AppEnv): string {
  return path.join(getEnvironmentsDir(repoRoot), `${appEnv}.env`);
}

function pinPathFor(repoRoot: string): string {
  return path.join(getEnvironmentsDir(repoRoot), ACTIVE_ENV_FILENAME);
}

/**
 * Resolve the active APP_ENV and its source.
 * Does not load dotenv files — only selects the profile name.
 */
export function resolveAppEnv(options: ResolveAppEnvOptions): ResolvedAppEnv {
  const repoRoot = options.repoRoot;
  const pinPath = pinPathFor(repoRoot);
  const ci = options.ci ?? process.env.CI === 'true';

  const rawOs = process.env.APP_ENV?.trim();
  if (rawOs) {
    if (isKnownAppEnv(rawOs)) {
      return {
        appEnv: rawOs,
        source: 'os',
        filePath: envFilePath(repoRoot, rawOs),
        pinPath,
        rawOsValue: rawOs,
      };
    }
    return {
      appEnv: 'local',
      source: 'invalid_os',
      filePath: envFilePath(repoRoot, 'local'),
      pinPath,
      rawOsValue: rawOs,
    };
  }

  // Pin is local-dev convenience only — never in CI
  if (!ci) {
    const pinRaw =
      options.pinFileContents !== undefined ? options.pinFileContents : readActiveEnvPin(repoRoot);
    if (pinRaw) {
      const v = pinRaw.trim();
      if (isKnownAppEnv(v)) {
        return {
          appEnv: v,
          source: 'pin',
          filePath: envFilePath(repoRoot, v),
          pinPath,
          rawPinValue: v,
        };
      }
      return {
        appEnv: 'local',
        source: 'invalid_pin',
        filePath: envFilePath(repoRoot, 'local'),
        pinPath,
        rawPinValue: v,
      };
    }
  }

  return {
    appEnv: 'local',
    source: 'default',
    filePath: envFilePath(repoRoot, 'local'),
    pinPath,
  };
}
