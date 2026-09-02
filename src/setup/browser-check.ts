/**
 * Setup Wizard — Playwright browser availability check.
 *
 * Detects whether the Playwright Chromium browser is installed on the local
 * machine (registry dir: ms-playwright). If missing, offers to open a NEW
 * terminal window (OS-aware: cmd on Windows, Terminal.app on macOS,
 * gnome-terminal/konsole/xterm fallback on Linux) that runs
 * `npx playwright install chromium`, or skip.
 *
 * @module src/setup/browser-check
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import prompts from 'prompts';
import { type WizardLang, t } from './i18n';

/**
 * Resolve the Playwright browsers registry directory for this OS.
 * Honors PLAYWRIGHT_BROWSERS_PATH override (used by CI/advanced setups).
 */
export function browsersDir(): string {
  const override = process.env.PLAYWRIGHT_BROWSERS_PATH?.trim();
  if (override) return override;

  if (process.platform === 'win32') {
    return path.join(
      process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'),
      'ms-playwright',
    );
  }
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Caches', 'ms-playwright');
  }
  return path.join(os.homedir(), '.cache', 'ms-playwright');
}

/**
 * True when a Chromium build (chromium-* or chromium_headless_shell-*) is
 * present in the browsers registry. Missing/unreadable dir → false.
 */
export function hasChromiumInstalled(dir: string = browsersDir()): boolean {
  try {
    if (!fs.existsSync(dir)) return false;
    return fs.readdirSync(dir).some((name) => name.startsWith('chromium'));
  } catch {
    return false;
  }
}

/**
 * Build the OS-specific command that opens a new terminal running
 * `npx playwright install chromium` in the repo. Pure builder for testability.
 * Linux returns the gnome-terminal variant; openInstallerTerminal falls back.
 */
export function buildInstallCommand(
  repoRoot: string,
  platform: NodeJS.Platform = process.platform,
): { command: string; args: string[]; windowsVerbatimArguments?: boolean } {
  if (platform === 'win32') {
    const fullCmd = `start "" cmd /k "cd /d "${repoRoot}" && npx playwright install chromium"`;
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
        `tell application "Terminal" to do script "cd " & quoted form of "${repoRoot}" & " && npx playwright install chromium"`,
      ],
    };
  }
  return {
    command: 'gnome-terminal',
    args: ['--', 'bash', '-c', `cd '${repoRoot}' && npx playwright install chromium; exec bash`],
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

/** Linux fallback chain: pick the first terminal emulator present. */
function linuxAlternatives(repoRoot: string): Array<{ command: string; args: string[] }> {
  const script = `cd '${repoRoot}' && npx playwright install chromium; exec bash`;
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
 * Open a new terminal window that installs the Playwright Chromium browser.
 * Returns true when the terminal was spawned (does not wait for install).
 */
export function openInstallerTerminal(
  repoRoot: string,
  platform: NodeJS.Platform = process.platform,
): boolean {
  const cmd = buildInstallCommand(repoRoot, platform);
  if (spawnDetached(cmd.command, cmd.args, repoRoot, cmd.windowsVerbatimArguments)) return true;

  if (platform === 'linux') {
    for (const alt of linuxAlternatives(repoRoot)) {
      if (terminalAvailable(alt.command) && spawnDetached(alt.command, alt.args, repoRoot)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Interactive check used by the wizard: report Chromium availability and, when
 * missing, offer to open a new terminal for installation or skip.
 */
export async function ensureBrowsers(
  lang: WizardLang,
  repoRoot: string = process.cwd(),
): Promise<void> {
  if (hasChromiumInstalled()) {
    console.log(
      t(
        lang,
        '  ✓ Chromium (browser Playwright) sudah terinstall.',
        '  ✓ Chromium (Playwright browser) is installed.',
      ),
    );
    return;
  }

  console.log(
    t(
      lang,
      '  ⚠ Chromium (browser Playwright) belum terinstall.',
      '  ⚠ Chromium (Playwright browser) is not installed.',
    ),
  );

  const { install } = await prompts(
    {
      type: 'confirm',
      name: 'install',
      message: t(
        lang,
        'Buka terminal baru untuk menginstall Chromium? (pilih "tidak" untuk skip)',
        'Open a new terminal to install Chromium? (choose "no" to skip)',
      ),
      initial: true,
    },
    {
      onCancel(): never {
        throw new Error('SETUP_WIZARD_CANCELLED');
      },
    },
  );

  if (!install) {
    console.log(
      t(
        lang,
        '  ⏭ Lewati install. Test E2E akan gagal sampai browser diinstall: npx playwright install chromium',
        '  ⏭ Skipped. E2E tests will fail until the browser is installed: npx playwright install chromium',
      ),
    );
    return;
  }

  const ok = openInstallerTerminal(repoRoot);
  if (ok) {
    console.log(
      t(
        lang,
        '  ✅ Terminal baru dibuka — install Chromium berjalan di sana. Lanjutkan wizard; install selesai biasanya 1-3 menit.',
        '  ✅ New terminal opened — Chromium install runs there. Continue the wizard; install usually takes 1-3 minutes.',
      ),
    );
  } else {
    console.log(
      t(
        lang,
        '  ⚠ Gagal membuka terminal otomatis. Install manual: npx playwright install chromium',
        '  ⚠ Could not open a terminal automatically. Manual install: npx playwright install chromium',
      ),
    );
  }
}
