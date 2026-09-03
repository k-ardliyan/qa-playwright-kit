import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Find repo root directory by searching upwards for package.json.
 */
export function findRepoRoot(startDir = process.cwd()): string {
  let current = path.resolve(startDir);
  while (true) {
    if (
      fs.existsSync(path.join(current, 'package.json')) &&
      fs.existsSync(path.join(current, 'playwright.config.ts'))
    ) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return startDir;
    }
    current = parent;
  }
}

/**
 * Safely resolve the installed `@playwright/mcp` version from node_modules.
 * Returns the version string (for example, "0.0.80") or null if missing/malformed.
 */
export function resolveInstalledPlaywrightMcpVersionSync(customRoot?: string): string | null {
  try {
    const root = customRoot ?? findRepoRoot();
    const pkgPath = path.join(root, 'node_modules', '@playwright', 'mcp', 'package.json');
    if (!fs.existsSync(pkgPath)) {
      return null;
    }
    const raw = fs.readFileSync(pkgPath, 'utf-8');
    const parsed = JSON.parse(raw) as { version?: unknown };
    if (typeof parsed.version === 'string' && parsed.version.trim().length > 0) {
      return parsed.version.trim();
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Async version of resolveInstalledPlaywrightMcpVersionSync.
 */
export async function resolveInstalledPlaywrightMcpVersion(
  customRoot?: string,
): Promise<string | null> {
  return resolveInstalledPlaywrightMcpVersionSync(customRoot);
}
