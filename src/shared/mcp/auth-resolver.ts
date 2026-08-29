import * as fs from 'node:fs';
import * as path from 'node:path';
import { authStatePath, currentAppEnv } from '../../support/auth-paths';

export interface ResolvedMcpAuthState {
  role: string;
  environment: string;
  storagePath: string;
  exists: boolean;
  diagnosticMessage?: string;
  recommendedCommand?: string;
}

/**
 * Resolve the storage state path for MCP sessions and provide diagnostic hints if missing.
 */
export function resolveMcpAuthState(
  options: {
    role?: string;
    environment?: string;
    repoRoot?: string;
  } = {},
): ResolvedMcpAuthState {
  const rawRole = options.role?.trim();
  const role = (rawRole && rawRole.length > 0 ? rawRole : 'user').toLowerCase();
  const environment = options.environment ?? currentAppEnv();
  const storagePath = authStatePath(role, environment);
  const fullPath = options.repoRoot
    ? path.resolve(options.repoRoot, storagePath)
    : path.resolve(storagePath);
  const exists = fs.existsSync(fullPath);

  if (!exists) {
    return {
      role,
      environment,
      storagePath,
      exists: false,
      diagnosticMessage: `Storage state for role '${role}' in environment '${environment}' not found at '${storagePath}'.`,
      recommendedCommand: 'npm run auth:setup',
    };
  }

  return {
    role,
    environment,
    storagePath,
    exists: true,
  };
}
