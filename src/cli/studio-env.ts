/**
 * Static APP_ENV + per-role auth status for the dashboard. No browser.
 * @module src/cli/studio-env
 */

import * as path from 'node:path';
import { resolveAppEnv } from '../utils/app-env';
import { probeAuthRoles, type AuthRoleStatus } from '../shared/mcp/auth-probe';
import { findRepoRoot } from '../shared/workspace-paths';

export interface StudioEnvStatus {
  appEnv: string;
  roles: AuthRoleStatus[];
}

export function getStudioEnvStatus(repoRoot: string = findRepoRoot()): StudioEnvStatus {
  const appEnv = resolveAppEnv({ repoRoot }).appEnv;
  const authDir = path.join(repoRoot, '.auth', appEnv);
  // probeAuthRoles returns [] when the dir is missing. No credential values leave this function.
  return { appEnv, roles: probeAuthRoles(authDir) };
}
