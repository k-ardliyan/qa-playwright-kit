/**
 * Agent Skills & MCP Sync Helper for Setup Wizard
 *
 * Synchronizes:
 * 1. Project skills (`skills/` -> `.agents/skills/` and `.claude/skills/`)
 * 2. Cross-platform MCP configs (`.mcp.json` -> `.cursor/`, `.kiro/`, `claude_desktop_config.json`)
 *
 * @module src/setup/agent-sync
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'node:child_process';
import { generateConfig } from '../agents/integration/mcp-config-generator';
import { logger } from '../utils/logger';

export interface AgentSyncResult {
  skillsSynced: string[];
  mcpConfigsGenerated: boolean;
  mcpServerBuilt: boolean;
  hermesProfileSkillsDir?: string | null;
  errors: string[];
}

/**
 * Resolve the active Hermes profile skills directory across platforms (Windows / Linux / macOS).
 */
export function resolveHermesActiveSkillsDir(): string | null {
  const localAppData =
    process.env.LOCALAPPDATA ||
    (process.platform === 'win32' ? path.join(os.homedir(), 'AppData', 'Local') : '');
  const hermesBase = localAppData
    ? path.join(localAppData, 'hermes')
    : path.join(os.homedir(), '.hermes');

  let profile = process.env.HERMES_PROFILE?.trim();
  if (!profile) {
    const activeProfileFile = path.join(hermesBase, 'active_profile');
    if (fs.existsSync(activeProfileFile)) {
      profile = fs.readFileSync(activeProfileFile, 'utf8').trim();
    }
  }

  if (profile) {
    const profileSkills = path.join(hermesBase, 'profiles', profile, 'skills');
    if (fs.existsSync(path.dirname(profileSkills))) {
      return profileSkills;
    }
  }

  const defaultSkills = path.join(hermesBase, 'skills');
  if (fs.existsSync(hermesBase)) {
    return defaultSkills;
  }

  return null;
}

/**
 * Copy directory recursively (standard Node fs helper).
 */
function copyDirRecursive(src: string, dest: string): void {
  if (!fs.existsSync(src)) return;
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }

  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

/**
 * Ensure the local MCP server (tools/mcp) is compiled and its dependencies installed.
 * Runs automatically during wizard setup so that Hermes / AI agents never encounter
 * a missing `tools/mcp/dist/index-mcp.js` on clean checkouts.
 */
export function ensureMcpServerBuild(repoRoot: string = process.cwd()): {
  built: boolean;
  ok: boolean;
  error?: string;
} {
  const mcpPackageJson = path.join(repoRoot, 'tools', 'mcp', 'package.json');
  // If tools/mcp does not exist in repoRoot (e.g. unit test mock repo), skip
  if (!fs.existsSync(mcpPackageJson)) {
    return { built: false, ok: true };
  }

  const mcpDist = path.join(repoRoot, 'tools', 'mcp', 'dist', 'index-mcp.js');
  const mcpModules = path.join(repoRoot, 'tools', 'mcp', 'node_modules');

  if (fs.existsSync(mcpDist) && fs.existsSync(mcpModules)) {
    return { built: false, ok: true };
  }

  const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';

  if (!fs.existsSync(mcpModules)) {
    const ciRes = spawnSync(npmCmd, ['ci', '--prefix', 'tools/mcp'], {
      cwd: repoRoot,
      encoding: 'utf-8',
      shell: false,
      timeout: 180_000,
    });
    if (ciRes.status !== 0) {
      return {
        built: false,
        ok: false,
        error: `npm ci --prefix tools/mcp failed: ${ciRes.stderr || ciRes.stdout}`,
      };
    }
  }

  const buildRes = spawnSync(npmCmd, ['run', 'mcp:build'], {
    cwd: repoRoot,
    encoding: 'utf-8',
    shell: false,
    timeout: 180_000,
  });

  if (buildRes.status !== 0) {
    return {
      built: false,
      ok: false,
      error: `npm run mcp:build failed: ${buildRes.stderr || buildRes.stdout}`,
    };
  }

  return { built: true, ok: true };
}

/**
 * Synchronize skills and platform MCP configs into repo-level agent directories.
 */
export function syncAgentSkillsAndMcp(repoRoot: string = process.cwd()): AgentSyncResult {
  const result: AgentSyncResult = {
    skillsSynced: [],
    mcpConfigsGenerated: false,
    mcpServerBuilt: false,
    errors: [],
  };

  // 1. Sync skills
  const sourceSkillsDir = path.join(repoRoot, 'skills');
  const targetAgentSkillsDirs = [
    path.join(repoRoot, '.agents', 'skills'),
    path.join(repoRoot, '.claude', 'skills'),
  ];

  // Also include active Hermes profile skills dir if available
  const hermesSkillsDir = resolveHermesActiveSkillsDir();
  result.hermesProfileSkillsDir = hermesSkillsDir;
  if (hermesSkillsDir) {
    targetAgentSkillsDirs.push(hermesSkillsDir);
  }

  if (fs.existsSync(sourceSkillsDir)) {
    try {
      const skills = fs
        .readdirSync(sourceSkillsDir, { withFileTypes: true })
        .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
        .map((d) => d.name);

      for (const skillName of skills) {
        const skillSrc = path.join(sourceSkillsDir, skillName);
        for (const targetDir of targetAgentSkillsDirs) {
          const skillDest = path.join(targetDir, skillName);
          copyDirRecursive(skillSrc, skillDest);
        }
        result.skillsSynced.push(skillName);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      result.errors.push(`Failed to sync skills: ${msg}`);
      logger.warn(`Failed to sync skills: ${msg}`);
    }
  }

  // 2. Generate MCP configs
  const mcpSource = path.join(repoRoot, '.mcp.json');
  if (fs.existsSync(mcpSource)) {
    try {
      generateConfig({
        sourceConfigPath: mcpSource,
        outputDir: repoRoot,
      });
      result.mcpConfigsGenerated = true;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      result.errors.push(`Failed to generate MCP configs: ${msg}`);
      logger.warn(`Failed to generate MCP configs: ${msg}`);
    }
  }

  // 3. Ensure local MCP server is compiled
  try {
    const buildRes = ensureMcpServerBuild(repoRoot);
    result.mcpServerBuilt = buildRes.built;
    if (!buildRes.ok && buildRes.error) {
      result.errors.push(buildRes.error);
      logger.warn(`MCP build warning: ${buildRes.error}`);
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    result.errors.push(`Failed to verify/build MCP server: ${msg}`);
    logger.warn(`Failed to verify/build MCP server: ${msg}`);
  }

  return result;
}
