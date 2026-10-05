/**
 * Setup Wizard — clipboard helper.
 *
 * The wizard copies the Hermes prompt to the clipboard so QA can paste it in one
 * step. It is TERMINAL-ONLY by design: no OS message-box (PowerShell MessageBox /
 * osascript / zenity) is ever spawned, because those block or fail on headless
 * hosts (CI, SSH, Windows Server, containers) and are a poor fit for a CLI.
 *
 * @module src/setup/prompt-dialog
 */

import { spawn } from 'node:child_process';

export interface ClipboardCommand {
  command: string;
  args: string[];
  /** Clipboard body is handed over via stdin. */
  input?: string;
}

/** Copy-only command. Linux primary is wl-copy; caller falls back to xclip. */
export function buildClipboardCommand(
  text: string,
  platform: NodeJS.Platform = process.platform,
): ClipboardCommand {
  if (platform === 'win32') return { command: 'clip.exe', args: [], input: text };
  if (platform === 'darwin') return { command: 'pbcopy', args: [], input: text };
  return { command: 'wl-copy', args: [], input: text };
}

export function buildXclipCommand(text: string): ClipboardCommand {
  return { command: 'xclip', args: ['-selection', 'clipboard'], input: text };
}

function runOne(spec: ClipboardCommand): Promise<boolean> {
  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(spec.command, spec.args, {
        stdio: ['pipe', 'ignore', 'ignore'],
        windowsHide: true,
      });
    } catch {
      resolve(false);
      return;
    }
    let settled = false;
    const done = (ok: boolean) => {
      if (settled) return;
      settled = true;
      resolve(ok);
    };
    child.on('error', () => done(false));
    child.on('close', (code) => done(code === 0));
    const stdin = child.stdin;
    if (!stdin) {
      done(false);
      return;
    }
    try {
      if (spec.input !== undefined) stdin.write(spec.input);
      stdin.end();
    } catch {
      done(false);
    }
  });
}

/** Copy text to the OS clipboard. Returns false when no clipboard tool works. */
export async function copyText(text: string): Promise<boolean> {
  if (await runOne(buildClipboardCommand(text))) return true;
  if (process.platform === 'linux') return runOne(buildXclipCommand(text));
  return false;
}
