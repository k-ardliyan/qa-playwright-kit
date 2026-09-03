/**
 * Auth storage paths scoped by APP_ENV.
 *
 * Canonical: `.auth/{APP_ENV}/{role}.json`
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

export function currentAppEnv(): string {
  const v = (process.env.APP_ENV ?? 'local').trim();
  return v.length > 0 ? v : 'local';
}

/**
 * Resolve path for a role's storage state.
 * @param role kebab-case role name (`user`, `finance`, `super-admin`)
 * @param appEnv defaults to process.env.APP_ENV || 'local'
 */
export function authStatePath(role: string, appEnv = currentAppEnv()): string {
  const r =
    role.trim().toLowerCase() === 'default' || role.trim().toLowerCase() === 'general'
      ? 'user'
      : role.trim().toLowerCase();
  const scoped = path.join('.auth', appEnv, `${r}.json`);
  return scoped;
}

/** Preferred write path (always scoped; no legacy). */
export function authStateWritePath(role: string, appEnv = currentAppEnv()): string {
  const r =
    role.trim().toLowerCase() === 'default' || role.trim().toLowerCase() === 'general'
      ? 'user'
      : role.trim().toLowerCase();
  return path.join('.auth', appEnv, `${r}.json`);
}

export function ensureAuthDirForEnv(appEnv = currentAppEnv()): string {
  const dir = path.join('.auth', appEnv);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}
