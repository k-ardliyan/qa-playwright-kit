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
import { generateConfig } from '../agents/integration/mcp-config-generator';
import { logger } from '../utils/logger';

export interface AgentSyncResult {
  skillsSynced: string[];
  mcpConfigsGenerated: boolean;
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
 * Synchronize skills and platform MCP configs into repo-level agent directories.
 */
export function syncAgentSkillsAndMcp(repoRoot: string = process.cwd()): AgentSyncResult {
  const result: AgentSyncResult = {
    skillsSynced: [],
    mcpConfigsGenerated: false,
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
  if (hermesSkillsDir) {
    targetAgentSkillsDirs.push(hermesSkillsDir);
    result.hermesProfileSkillsDir = hermesSkillsDir;
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

  return result;
}
