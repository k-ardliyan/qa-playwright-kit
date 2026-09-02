/**
 * Setup Wizard — open a NEW OS terminal running an npm command.
 *
 * Windows strategy:
 * 1. Prefer `cmd.exe /c start "" cmd /k "cd /d ... && cli"` (empty string title
 *    avoids start's quoted-title ambiguity).
 * 2. Or PowerShell window.
 *
 * @module src/setup/terminal
 */

import { spawn, spawnSync } from 'node:child_process';

export function buildTerminalCommand(
  repoRoot: string,
  cli: string,
  platform: NodeJS.Platform = process.platform,
): { command: string; args: string[]; windowsVerbatimArguments?: boolean } {
  if (platform === 'win32') {
    // start "" cmd /k "cd /d <path> && <cli>"
    // The first quoted token is the window title (empty string = no title ambiguity).
    // Using windowsVerbatimArguments prevents Node from re-escaping quotes to \".
    const fullCmd = `start "" cmd /k "cd /d "${repoRoot}" && ${cli}"`;
    return {
      command: 'cmd.exe',
      args: ['/c', fullCmd],
      windowsVerbatimArguments: true,
    };
  }
  if (platform === 'darwin') {
    return {
      command: 'osascript',
      args: [
        '-e',
        `tell application "Terminal" to do script "cd " & quoted form of "${repoRoot}" & " && ${cli}"`,
      ],
    };
  }
  return {
    command: 'gnome-terminal',
    args: ['--', 'bash', '-c', `cd '${repoRoot}' && ${cli}; exec bash`],
  };
}

function spawnDetached(
  command: string,
  args: string[],
  cwd: string,
  windowsVerbatim = false,
): boolean {
  try {
    const child = spawn(command, args, {
      cwd,
      detached: true,
      stdio: 'ignore',
      windowsVerbatimArguments: windowsVerbatim,
    });
    child.unref();
    return true;
  } catch {
    return false;
  }
}

function linuxAlternatives(
  repoRoot: string,
  cli: string,
): Array<{ command: string; args: string[] }> {
  const script = `cd '${repoRoot}' && ${cli}; exec bash`;
  return [
    { command: 'konsole', args: ['-e', 'bash', '-c', script] },
    { command: 'xfce4-terminal', args: ['-e', 'bash', '-c', script] },
    { command: 'xterm', args: ['-e', 'bash', '-c', script] },
  ];
}

function terminalAvailable(command: string): boolean {
  try {
    const r = spawnSync(command, ['--version'], { stdio: 'ignore' });
    return r.status === 0;
  } catch {
    return false;
  }
}

/**
 * Open a new terminal running `cli` in `repoRoot`.
 * Returns true when a terminal was spawned (does not wait for the command).
 */
export function openTerminalFor(repoRoot: string, cli: string): boolean {
  const cmd = buildTerminalCommand(repoRoot, cli);
  if (spawnDetached(cmd.command, cmd.args, repoRoot, cmd.windowsVerbatimArguments)) return true;

  if (process.platform === 'linux') {
    for (const alt of linuxAlternatives(repoRoot, cli)) {
      if (terminalAvailable(alt.command) && spawnDetached(alt.command, alt.args, repoRoot)) {
        return true;
      }
    }
  }
  return false;
}
