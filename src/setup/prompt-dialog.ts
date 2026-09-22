import { spawn } from 'node:child_process';

export interface PromptDialogCommand {
  command: string;
  args: string[];
  /** Set when the body is handed over via stdin (clip.exe, pbcopy, wl-copy, xclip). */
  input?: string;
}

const TITLE = 'QA Playwright Kit';
/** ponytail: 4000 chars fits a MessageBox. Full text stays in the terminal and on the clipboard. */
const DIALOG_CAP = 4000;

function cap(message: string): string {
  return message.length > DIALOG_CAP ? `${message.slice(0, DIALOG_CAP)}\n…` : message;
}

/** Copy-only command. Linux primary is wl-copy; caller falls back to xclip. */
export function buildClipboardCommand(
  text: string,
  platform: NodeJS.Platform = process.platform,
): PromptDialogCommand {
  if (platform === 'win32') return { command: 'clip.exe', args: [], input: text };
  if (platform === 'darwin') return { command: 'pbcopy', args: [], input: text };
  return { command: 'wl-copy', args: [], input: text };
}

export function buildXclipCommand(text: string): PromptDialogCommand {
  return { command: 'xclip', args: ['-selection', 'clipboard'], input: text };
}

/**
 * Native message box. Windows: PowerShell MessageBox. macOS: osascript.
 * Linux: zenity; caller falls back to kdialog.
 * Prompt rides inside the command argument as data (PowerShell here-string,
 * AppleScript string) — never through `cmd /c` shell quoting.
 */
export function buildDialogCommand(
  message: string,
  platform: NodeJS.Platform = process.platform,
): PromptDialogCommand {
  const body = cap(message);
  if (platform === 'win32') {
    // @' ... '@ is literal. A line that is exactly '@ would close it early.
    const literal = body.replace(/'@/g, "'@ ");
    const ps = [
      'Add-Type -AssemblyName System.Windows.Forms',
      `$m = @'\n${literal}\n'@`,
      `[void][System.Windows.Forms.MessageBox]::Show($m, '${TITLE}', 'OK', 'Information')`,
    ].join('; ');
    return { command: 'powershell.exe', args: ['-NoProfile', '-STA', '-Command', ps] };
  }
  if (platform === 'darwin') {
    const escaped = body.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    return {
      command: 'osascript',
      args: [
        '-e',
        `display dialog "${escaped}" with title "${TITLE}" buttons {"OK"} default button "OK"`,
      ],
    };
  }
  return {
    command: 'zenity',
    args: ['--info', `--title=${TITLE}`, '--width=640', `--text=${body}`],
  };
}

export function linuxDialogFallbacks(message: string): PromptDialogCommand[] {
  const body = cap(message);
  return [{ command: 'kdialog', args: ['--title', TITLE, '--msgbox', body] }];
}

function runOne(spec: PromptDialogCommand): Promise<boolean> {
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

export async function copyText(text: string): Promise<boolean> {
  if (await runOne(buildClipboardCommand(text))) return true;
  if (process.platform === 'linux') return runOne(buildXclipCommand(text));
  return false;
}

export async function showPromptDialog(message: string): Promise<boolean> {
  if (await runOne(buildDialogCommand(message))) return true;
  if (process.platform === 'linux') {
    for (const fallback of linuxDialogFallbacks(message)) {
      if (await runOne(fallback)) return true;
    }
  }
  return false;
}
