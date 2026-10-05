/**
 * Agent Skills & MCP Sync Helper for Setup Wizard
 *
 * Synchronizes:
 * 1. Project skills (`skills/` -> `.agents/skills/`, plus `.claude/skills/`
 *    only when Claude is installed on this machine) — both repo-owned, disposable
 *    targets. The active Hermes profile skills dir is NEVER written: it is where
 *    Hermes learns, so mirroring into it would wipe real lessons. Hermes instead
 *    reads the repo's `skills/` via `hermes skills trust <repo>` (top tier).
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
  /** Clients detected on this machine whose MCP configs were generated. */
  mcpPlatforms: Platform[];
  mcpServerBuilt: boolean;
  /** Hermes Agent is installed on this machine (its base dir exists). */
  hermesDetected: boolean;
  /** Hermes now trusts this repo, so its skills load as the top tier. */
  hermesTrusted: boolean;
  /** Exact command to run when the automatic trust step did not succeed. */
  hermesTrustCommand: string;
  errors: string[];
}

/**
 * Hermes Agent base dir across platforms (Windows / Linux / macOS).
 *
 * The active Hermes PROFILE skills dir lives under here, but we never touch it:
 * that is where Hermes learns (agent-authored skills + curator state). Writing
 * there — as the old mirror did — wipes real lessons. We only detect the install
 * and register the repo as a trusted project so Hermes reads `skills/` itself.
 */
export function hermesBaseDir(homeDir: string = os.homedir()): string {
  const localAppData =
    process.env.LOCALAPPDATA ||
    (process.platform === 'win32' ? path.join(homeDir, 'AppData', 'Local') : '');
  return localAppData ? path.join(localAppData, 'hermes') : path.join(homeDir, '.hermes');
}

/** Hermes Agent is installed on this machine (its base dir exists). */
export function detectHermesInstall(homeDir: string = os.homedir()): boolean {
  return fs.existsSync(hermesBaseDir(homeDir));
}

/** The exact command that makes Hermes load this repo's `skills/` as the top tier. */
export function hermesTrustCommand(repoRoot: string): string {
  return `hermes skills trust ${repoRoot}`;
}

/**
 * Register *repoRoot* as a Hermes trusted project, so `<repo>/skills/` loads as
 * the highest-precedence tier (`hermes skills trust`). Idempotent — Hermes no-ops
 * when the root is already trusted.
 *
 * Soft-fails like the MCP build: a missing `hermes` binary or a non-zero exit is
 * reported (with the manual command) and never aborts setup. Hermes is optional.
 */
export type TrustRunner = (repoRoot: string) => { trusted: boolean; error?: string };

function defaultTrustRunner(repoRoot: string): { trusted: boolean; error?: string } {
  const res = spawnSync('hermes', ['skills', 'trust', repoRoot], {
    encoding: 'utf-8',
    shell: true,
    timeout: 30_000,
  });
  if (res.status === 0) return { trusted: true };
  return {
    trusted: false,
    error:
      res.error?.message ?? res.stderr?.trim() ?? res.stdout?.trim() ?? `exit code ${res.status}`,
  };
}

/** Immediate subdirectory names under *dir* (dot-dirs excluded). */
function listSkillNames(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
    .map((d) => d.name);
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
 * Scoped to a single skill dir, NEVER a skills root — a root-level wipe would
 * destroy anything else living beside the skills.
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
 * Only ever called for targets the repo fully owns (`.agents/skills`,
 * `.claude/skills`). The Hermes profile skills dir is never a target.
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
 * @param trustRunner - Overrides the Hermes trust step (injectable so tests never
 *                   spawn the real `hermes` binary).
 */
export function syncAgentSkillsAndMcp(
  repoRoot: string = process.cwd(),
  homeDir: string = os.homedir(),
  trustRunner: TrustRunner = defaultTrustRunner,
): AgentSyncResult {
  const result: AgentSyncResult = {
    skillsSynced: [],
    mcpPlatforms: [],
    mcpServerBuilt: false,
    hermesDetected: false,
    hermesTrusted: false,
    hermesTrustCommand: hermesTrustCommand(repoRoot),
    errors: [],
  };

  const installedClients = detectInstalledClients(homeDir);

  // 1. Mirror the framework pack (`skills/`) into repo-owned, disposable targets
  // only. The active Hermes profile skills dir is deliberately NOT a target: it
  // is where Hermes learns, so writing there (as this used to) wiped real
  // lessons. Hermes reads `skills/` itself once the repo is a trusted project.
  const sourceSkillsDir = path.join(repoRoot, 'skills');
  const targetAgentSkillsDirs = [
    path.join(repoRoot, '.agents', 'skills'),
    // Claude-only target: writing it when Claude is not installed just leaves
    // an orphan dir the user will never read.
    ...(installedClients.includes('claude') ? [path.join(repoRoot, '.claude', 'skills')] : []),
  ];

  try {
    const frameworkNames = listSkillNames(sourceSkillsDir);
    result.skillsSynced = frameworkNames;

    for (const targetDir of targetAgentSkillsDirs) {
      pruneStaleSkills(sourceSkillsDir, targetDir);
      for (const name of frameworkNames) {
        mirrorSkill(path.join(sourceSkillsDir, name), path.join(targetDir, name));
      }
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    result.errors.push(`Failed to sync skills: ${msg}`);
    logger.warn(`Failed to sync skills: ${msg}`);
  }

  // 1b. Register the repo as a Hermes trusted project so Hermes loads `skills/`
  // as the top tier — no copy, so `npm run setup` can never wipe what Hermes
  // learned. Soft-fails: Hermes is optional, and the manual command is reported.
  result.hermesDetected = detectHermesInstall(homeDir);
  if (result.hermesDetected) {
    const trust = trustRunner(repoRoot);
    result.hermesTrusted = trust.trusted;
    if (!trust.trusted) {
      logger.warn(
        `Hermes project trust skipped: ${trust.error}. Run manually: ${result.hermesTrustCommand}`,
      );
    }
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
