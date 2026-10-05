/**
 * Agent Skills & MCP Sync Helper for Setup Wizard
 *
 * Synchronizes:
 * 1. Project skills (`skills/` -> `.agents/skills/`, plus `.claude/skills/`
 *    only when Claude is installed on this machine) AND QA-owned self-learned
 *    skills (`.learned-skills/*-learned/` -> the same targets, never overwritten
 *    by `npm run upgrade`).
 * 2. Cross-platform MCP configs (`.mcp.json` -> `.cursor/`, `.kiro/`,
 *    `claude_desktop_config.json`) — ONLY for clients detected installed.
 *    Hermes reads root `.mcp.json` directly; the standalone
 *    `npm run mcp:config` stays available to force any platform.
 *
 * @module src/setup/agent-sync
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'node:child_process';
import { generateConfig, type Platform } from '../agents/integration/mcp-config-generator';
import { logger } from '../utils/logger';
import { npmSpawn } from './spawn-bin';

export interface AgentSyncResult {
  skillsSynced: string[];
  /** Self-learned skills mirrored from {@link LEARNED_SKILLS_DIR}. */
  learnedSkillsSynced: string[];
  /** Clients detected on this machine whose MCP configs were generated. */
  mcpPlatforms: Platform[];
  mcpServerBuilt: boolean;
  hermesProfileSkillsDir?: string | null;
  errors: string[];
}

/**
 * QA-owned self-learned skill zone.
 *
 * A dot-dir at the repo root, matching the repo's own convention for
 * agent-local state (`.hermes/`, `.agents/`, `.claude/`) — it adds nothing to
 * the visible root listing.
 *
 * Deliberately a SIBLING of `skills/`, never a subdirectory of it: `skills/` is
 * a `FRAMEWORK_PATHS` entry, so `npm run upgrade` overwrites everything inside.
 * Learned skills written here survive every upgrade while the framework pack is
 * refreshed underneath them.
 *
 * Also NOT nested under `.agents/`: that dir is disposable build output, and a
 * learned skill is the one thing here that cannot be regenerated.
 */
export const LEARNED_SKILLS_DIR = '.learned-skills';

/** Suffix every learned skill directory must carry, so a learned skill is
 * recognizable at a glance and can never be mistaken for framework-owned. */
export const LEARNED_SKILL_SUFFIX = '-learned';

/** Immediate subdirectory names under *dir* (dot-dirs excluded). */
function listSkillNames(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
    .map((d) => d.name);
}

/**
 * Why a learned skill name is unsafe, or `null` when it is fine.
 *
 * Both rules protect the same thing: a learned skill is mirrored into the same
 * agent dirs as the framework pack, so a name that shadows a framework skill
 * would leave the learned file loaded AS the framework skill — the framework
 * pack silently "forgets" everything an upgrade taught it.
 */
export function learnedSkillNameError(
  name: string,
  frameworkNames: Iterable<string>,
): string | null {
  if (!name.endsWith(LEARNED_SKILL_SUFFIX)) {
    return `learned skill '${name}' must end with '${LEARNED_SKILL_SUFFIX}' (e.g. 'qa-playwright-kit${LEARNED_SKILL_SUFFIX}')`;
  }
  if (new Set(frameworkNames).has(name)) {
    return `learned skill '${name}' collides with a framework skill name — rename it`;
  }
  return null;
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
 * Client markers, checked in the user's home directory.
 *
 * A client's config is only generated when the client is actually installed
 * on this machine. Marker dirs are the first-class install traces:
 * - `.claude`   — Claude Code / Claude Desktop
 * - `.cursor`   — Cursor (global config dir always present after install)
 * - `.kiro`     — Kiro
 * - `.codex`    — Codex CLI
 *
 * Hermes needs no marker: it reads the root `.mcp.json` directly.
 * VS Code/Copilot is out of scope here — `.vscode/mcp.json` ships in the repo
 * and `npm run mcp:config --platform=<p>` remains the escape hatch for any
 * client we do not detect.
 */
const CLIENT_MARKERS: Record<string, string> = {
  claude: '.claude',
  cursor: '.cursor',
  kiro: '.kiro',
  codex: '.codex',
};

/**
 * Which AI clients are installed on this machine, by home-directory marker.
 * Pure filesystem probe — no spawning, no network.
 */
export function detectInstalledClients(homeDir: string = os.homedir()): Platform[] {
  return (Object.keys(CLIENT_MARKERS) as Platform[]).filter((client) =>
    fs.existsSync(path.join(homeDir, CLIENT_MARKERS[client])),
  );
}

/**
 * Mirror ONE skill dir *src* into *dest*, replacing it, and return whether it
 * was copied.
 *
 * Replaces rather than merges on purpose: a merge would leave a file deleted
 * upstream (or a renamed reference) behind in the agent dirs, so the agent would
 * keep loading a file that no longer exists in the repo.
 *
 * Scoped to a single skill dir, NEVER the skills root: the Hermes profile skills
 * dir also holds Hermes' own state (`.hub/`, `.usage.json`, bundled skills), so
 * a root-level wipe there would destroy it.
 *
 * A path under *src* that is not a real file is skipped rather than copied — an
 * unresolvable symlink would make `copyFileSync` throw and abort the sync.
 */
function mirrorSkill(src: string, dest: string): boolean {
  if (!fs.existsSync(src)) return false;
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });

  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      fs.cpSync(from, to, { recursive: true });
    } else if (entry.isFile()) {
      fs.copyFileSync(from, to);
    }
  }
  return true;
}

/**
 * Drop skill dirs in *targetDir* that *sourceDir* no longer has, so a skill
 * removed or renamed upstream stops loading from the agent dirs.
 *
 * Only ever called for targets the repo fully owns. The Hermes profile skills
 * dir is excluded by the caller: it contains skills the repo never wrote.
 */
function pruneStaleSkills(sourceDir: string, targetDir: string): void {
  const current = new Set(listSkillNames(sourceDir));
  for (const name of listSkillNames(targetDir)) {
    if (!current.has(name)) {
      fs.rmSync(path.join(targetDir, name), { recursive: true, force: true });
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

  if (!fs.existsSync(mcpModules)) {
    const ciSpawn = npmSpawn(['ci', '--prefix', 'tools/mcp']);
    const ciRes = spawnSync(ciSpawn.command, ciSpawn.args, {
      cwd: repoRoot,
      encoding: 'utf-8',
      shell: ciSpawn.shell,
      timeout: 180_000,
    });
    if (ciRes.status !== 0) {
      return {
        built: false,
        ok: false,
        error: `npm ci --prefix tools/mcp failed: ${
          ciRes.error?.message ?? ciRes.stderr ?? ciRes.stdout ?? `exit code ${ciRes.status}`
        }`,
      };
    }
  }

  const buildSpawn = npmSpawn(['run', 'mcp:build']);
  const buildRes = spawnSync(buildSpawn.command, buildSpawn.args, {
    cwd: repoRoot,
    encoding: 'utf-8',
    shell: buildSpawn.shell,
    timeout: 180_000,
  });

  if (buildRes.status !== 0) {
    return {
      built: false,
      ok: false,
      error: `npm run mcp:build failed: ${
        buildRes.error?.message ??
        buildRes.stderr ??
        buildRes.stdout ??
        `exit code ${buildRes.status}`
      }`,
    };
  }

  return { built: true, ok: true };
}

/**
 * Synchronize skills and platform MCP configs into repo-level agent directories.
 *
 * @param repoRoot - Repo root (defaults to cwd).
 * @param homeDir  - Home dir used for client detection (defaults to the real one;
 *                   injectable so tests are deterministic).
 */
export function syncAgentSkillsAndMcp(
  repoRoot: string = process.cwd(),
  homeDir: string = os.homedir(),
): AgentSyncResult {
  const result: AgentSyncResult = {
    skillsSynced: [],
    learnedSkillsSynced: [],
    mcpPlatforms: [],
    mcpServerBuilt: false,
    errors: [],
  };

  const installedClients = detectInstalledClients(homeDir);

  // 1. Mirror skills. The framework pack (`skills/`) is overwritten in every
  // target; the QA-owned learned zone (`.learned-skills/`) is added alongside it
  // and is never a target of `npm run upgrade`, so it survives framework updates.
  const sourceSkillsDir = path.join(repoRoot, 'skills');
  const learnedSkillsDir = path.join(repoRoot, LEARNED_SKILLS_DIR);
  const targetAgentSkillsDirs = [
    path.join(repoRoot, '.agents', 'skills'),
    // Claude-only target: writing it when Claude is not installed just leaves
    // an orphan dir the user will never read.
    ...(installedClients.includes('claude') ? [path.join(repoRoot, '.claude', 'skills')] : []),
  ];

  // Also include active Hermes profile skills dir if available
  const hermesSkillsDir = resolveHermesActiveSkillsDir();
  result.hermesProfileSkillsDir = hermesSkillsDir;
  if (hermesSkillsDir) {
    targetAgentSkillsDirs.push(hermesSkillsDir);
  }

  try {
    const frameworkNames = listSkillNames(sourceSkillsDir);
    const learnedNames: string[] = [];
    for (const name of listSkillNames(learnedSkillsDir)) {
      const problem = learnedSkillNameError(name, frameworkNames);
      if (problem) {
        result.errors.push(`Skipped ${problem}`);
        continue;
      }
      learnedNames.push(name);
    }
    result.skillsSynced = frameworkNames;
    result.learnedSkillsSynced = learnedNames;

    for (const targetDir of targetAgentSkillsDirs) {
      // The Hermes profile dir holds Hermes' own skills and state; the repo only
      // ever adds/overwrites its own entries there, never prunes.
      if (targetDir !== hermesSkillsDir) {
        pruneStaleSkills(sourceSkillsDir, targetDir);
      }
      for (const name of frameworkNames) {
        mirrorSkill(path.join(sourceSkillsDir, name), path.join(targetDir, name));
      }
      for (const name of learnedNames) {
        mirrorSkill(path.join(learnedSkillsDir, name), path.join(targetDir, name));
      }
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    result.errors.push(`Failed to sync skills: ${msg}`);
    logger.warn(`Failed to sync skills: ${msg}`);
  }

  // 2. Generate MCP configs — only for clients actually installed here.
  // Generating for absent clients leaves config files nobody reads (the old
  // behavior wrote .cursor/.kiro/.codex/claude on every machine). Escape
  // hatch for anything not detected: `npm run mcp:config --platform=<p>`.
  const mcpSource = path.join(repoRoot, '.mcp.json');
  if (fs.existsSync(mcpSource)) {
    for (const platform of installedClients) {
      try {
        generateConfig({ sourceConfigPath: mcpSource, outputDir: repoRoot, platform });
        result.mcpPlatforms.push(platform);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        result.errors.push(`Failed to generate ${platform} MCP config: ${msg}`);
        logger.warn(`Failed to generate ${platform} MCP config: ${msg}`);
      }
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
