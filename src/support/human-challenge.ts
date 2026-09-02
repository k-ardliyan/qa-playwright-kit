/**
 * Human Challenge helpers — assisted OTP / CAPTCHA during auth setup.
 *
 * Priority for OTP:
 *   1. otp-browser (headed, recommended)
 *   2. otp-stdin (terminal; headless OK)
 *
 * CAPTCHA: captcha-browser only (terminal rejected).
 * CI / non-interactive: interactive modes fail fast.
 *
 * @module src/support/human-challenge
 */

import type { Page } from '@playwright/test';
import prompts from 'prompts';

export type ChallengeMode = 'auto' | 'none' | 'otp-browser' | 'otp-stdin' | 'captcha-browser';

export type DetectedChallenge = 'none' | 'otp' | 'captcha' | 'unknown';

export const CHALLENGE_MODES: readonly ChallengeMode[] = [
  'auto',
  'none',
  'otp-browser',
  'otp-stdin',
  'captcha-browser',
] as const;

const DEFAULT_TIMEOUT_MS = 180_000;

/** Parse AUTH_CHALLENGE_MODE from env (default none). */
export function resolveChallengeMode(env: NodeJS.ProcessEnv = process.env): ChallengeMode {
  const raw = (env.AUTH_CHALLENGE_MODE ?? 'none').trim().toLowerCase();
  if ((CHALLENGE_MODES as readonly string[]).includes(raw)) {
    return raw as ChallengeMode;
  }
  return 'none';
}

export function resolveChallengeTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.AUTH_CHALLENGE_TIMEOUT_MS?.trim();
  if (!raw) return DEFAULT_TIMEOUT_MS;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 5_000) return DEFAULT_TIMEOUT_MS;
  return n;
}

export function isInteractiveChallengeMode(mode: ChallengeMode): boolean {
  return mode !== 'none';
}

export function modeRequiresHeadedBrowser(mode: ChallengeMode): boolean {
  return mode === 'otp-browser' || mode === 'captcha-browser';
}

export function modeRequiresTty(mode: ChallengeMode): boolean {
  return mode === 'otp-stdin';
}

/** auto needs either a visible browser or a TTY (for OTP fallback). */
export function modeRequiresInteractiveSurface(mode: ChallengeMode): boolean {
  return mode === 'auto' || modeRequiresHeadedBrowser(mode) || modeRequiresTty(mode);
}

function isCi(env: NodeJS.ProcessEnv): boolean {
  const v = (env.CI ?? '').trim().toLowerCase();
  return v === 'true' || v === '1' || v === 'yes';
}

function isHeadlessEnv(env: NodeJS.ProcessEnv): boolean {
  // Playwright CLI forces a visible browser — honor that for challenge gates
  // even when HEADLESS=true remains in the env file.
  if (
    typeof process !== 'undefined' &&
    Array.isArray(process.argv) &&
    (process.argv.includes('--headed') || process.argv.includes('--debug'))
  ) {
    return false;
  }
  if ((env.PWDEBUG ?? '').trim() === '1' || (env.PWDEBUG ?? '').trim() === 'console') {
    return false;
  }
  const raw = (env.HEADLESS ?? 'true').trim().toLowerCase();
  if (raw === 'false' || raw === '0' || raw === 'no') return false;
  return true;
}

export interface ChallengeGateInput {
  mode: ChallengeMode;
  env?: NodeJS.ProcessEnv;
  /** Override TTY detection (tests). Default: process.stdin.isTTY */
  isTty?: boolean;
  /**
   * When true, caller intends terminal OTP entry.
   * captcha-browser always rejects terminal.
   */
  viaTerminal?: boolean;
}

/**
 * Fail fast when interactive challenge is unsafe / unsupported.
 * Pure enough for unit tests (pass env + isTty).
 */
export function assertChallengeAllowed(input: ChallengeGateInput): void {
  const mode = input.mode;
  if (mode === 'none') return;

  const env = input.env ?? process.env;
  if (isCi(env)) {
    throw new Error(
      `[human-challenge] AUTH_CHALLENGE_MODE=${mode} is interactive and forbidden under CI. ` +
        `Set AUTH_CHALLENGE_MODE=none for CI, or run auth setup locally.`,
    );
  }

  if (input.viaTerminal && mode === 'captcha-browser') {
    throw new Error(
      '[human-challenge] CAPTCHA cannot be solved via terminal input. ' +
        'Use AUTH_CHALLENGE_MODE=captcha-browser with HEADLESS=false and complete it in the browser.',
    );
  }

  if (modeRequiresTty(mode)) {
    const tty = input.isTty ?? Boolean(process.stdin.isTTY);
    if (!tty) {
      throw new Error(
        '[human-challenge] otp-stdin requires an interactive terminal (TTY). ' +
          'Use otp-browser with HEADLESS=false, or run from a real terminal.',
      );
    }
  }

  if (mode === 'auto') {
    const tty = input.isTty ?? Boolean(process.stdin.isTTY);
    if (isHeadlessEnv(env) && !tty) {
      throw new Error(
        '[human-challenge] auto mode needs a visible browser (HEADLESS=false / --headed) ' +
          'or an interactive terminal for OTP stdin fallback.',
      );
    }
  }

  if (modeRequiresHeadedBrowser(mode) && isHeadlessEnv(env)) {
    throw new Error(
      `[human-challenge] ${mode} requires a visible browser. ` +
        `Set HEADLESS=false (and preferably SLOW_MO=100), then re-run:\n` +
        `  npm run auth:setup:headed`,
    );
  }
}

/**
 * Resolve effective path for OTP when mode is auto.
 * Priority: browser (if not headless) → stdin (if TTY) → error.
 */
export function resolveAutoOtpPath(input: {
  env?: NodeJS.ProcessEnv;
  isTty?: boolean;
}): 'otp-browser' | 'otp-stdin' {
  const env = input.env ?? process.env;
  if (!isHeadlessEnv(env)) return 'otp-browser';
  const tty = input.isTty ?? Boolean(process.stdin.isTTY);
  if (tty) return 'otp-stdin';
  throw new Error(
    '[human-challenge] auto OTP: browser is headless and no TTY for stdin. ' +
      'Set HEADLESS=false for otp-browser (recommended) or run in a TTY with otp-stdin.',
  );
}

/** Build env updates when user picks a challenge mode (wizard / env:edit). */
export function challengeModeEnvUpserts(
  mode: ChallengeMode,
  current: { headless?: string; slowMo?: string } = {},
): Record<string, string> {
  const out: Record<string, string> = {
    AUTH_CHALLENGE_MODE: mode,
  };

  if (modeRequiresHeadedBrowser(mode) || mode === 'auto') {
    // Prefer headed for auto (OTP priority = browser first)
    out.HEADLESS = 'false';
    const slow = Number.parseInt(current.slowMo ?? '0', 10);
    if (!Number.isFinite(slow) || slow <= 0) {
      out.SLOW_MO = '100';
    }
  }

  return out;
}

// ─── Page helpers (runtime) ─────────────────────────────────────────────────

const DEFAULT_OTP_INPUT =
  'input[autocomplete="one-time-code"], input[inputmode="numeric"], ' +
  'input[name*="otp" i], input[id*="otp" i], input[name*="token" i], ' +
  'input[id*="token" i], input[name*="code" i], input[id*="code" i], ' +
  'input[placeholder*="otp" i], input[placeholder*="kode" i], ' +
  'input[placeholder*="verif" i], input[aria-label*="otp" i], ' +
  'input[aria-label*="kode" i]';

const DEFAULT_OTP_SUBMIT =
  'button[type="submit"], button:has-text("Verify"), button:has-text("Verifikasi"), ' +
  'button:has-text("Confirm"), button:has-text("Konfirmasi"), ' +
  'button:has-text("Submit"), button:has-text("Lanjut"), button:has-text("Continue")';

export async function detectChallenge(page: Page): Promise<DetectedChallenge> {
  try {
    const captcha = page.locator(
      'iframe[src*="recaptcha"], iframe[src*="hcaptcha"], iframe[src*="turnstile"], ' +
        '[class*="g-recaptcha"], [id*="captcha" i], [class*="captcha" i], #cf-challenge-running',
    );
    if (
      (await captcha.count()) > 0 &&
      (await captcha
        .first()
        .isVisible()
        .catch(() => false))
    ) {
      return 'captcha';
    }

    const otpSel = (process.env.AUTH_OTP_INPUT_SELECTOR ?? '').trim() || DEFAULT_OTP_INPUT;
    const otp = page.locator(otpSel);
    if (
      (await otp.count()) > 0 &&
      (await otp
        .first()
        .isVisible()
        .catch(() => false))
    ) {
      return 'otp';
    }

    // Text heuristics (weaker)
    const body = (
      await page
        .locator('body')
        .innerText()
        .catch(() => '')
    ).toLowerCase();
    if (/\bcaptcha\b|i.?m not a robot|bukan robot|hcaptcha|recaptcha|turnstile/.test(body)) {
      return 'captcha';
    }
    if (/\botp\b|one[- ]time|kode verifikasi|verification code|2fa|mfa|authenticator/.test(body)) {
      return 'otp';
    }
  } catch {
    // non-fatal
  }
  return 'none';
}

export async function promptOtpFromTerminal(
  message = 'Masukkan kode OTP / verifikasi:',
): Promise<string> {
  assertChallengeAllowed({ mode: 'otp-stdin', viaTerminal: true });
  const ans = await prompts({
    type: 'text',
    name: 'otp',
    message,
    validate: (v: string) => (v && String(v).trim().length > 0) || 'OTP tidak boleh kosong',
  });
  const code = String(ans.otp ?? '').trim();
  if (!code) {
    throw new Error('[human-challenge] OTP input dibatalkan atau kosong.');
  }
  return code;
}

export async function fillOtpAndSubmit(page: Page, code: string): Promise<void> {
  const otpSel = (process.env.AUTH_OTP_INPUT_SELECTOR ?? '').trim() || DEFAULT_OTP_INPUT;
  const submitSel = (process.env.AUTH_OTP_SUBMIT_SELECTOR ?? '').trim() || DEFAULT_OTP_SUBMIT;

  const input = page.locator(otpSel).first();
  await input.waitFor({ state: 'visible', timeout: 15_000 });
  await input.fill(code);

  const submit = page.locator(submitSel).first();
  if ((await submit.count()) > 0 && (await submit.isVisible().catch(() => false))) {
    await submit.click();
  } else {
    await input.press('Enter');
  }
}

/**
 * OTP via browser: human types in the page (or uses pause).
 * Prefer page.pause when available; also wait for OTP field to disappear / URL change.
 */
export async function completeOtpBrowser(
  page: Page,
  opts: { timeoutMs?: number } = {},
): Promise<void> {
  assertChallengeAllowed({ mode: 'otp-browser' });
  const timeoutMs = opts.timeoutMs ?? resolveChallengeTimeoutMs();

  console.log(
    '\n[human-challenge] OTP (browser) — isi kode di browser.\n' +
      '  Jika Playwright Inspector terbuka: isi OTP lalu tekan Resume.\n' +
      '  Jika tidak: selesaikan di jendela browser; framework menunggu field OTP hilang / navigasi.\n' +
      `  Timeout: ${Math.round(timeoutMs / 1000)}s\n`,
  );

  try {
    await page.pause();
  } catch {
    // pause may be unavailable outside headed/debug; poll instead
  }

  const otpSel = (process.env.AUTH_OTP_INPUT_SELECTOR ?? '').trim() || DEFAULT_OTP_INPUT;
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const still = await page
      .locator(otpSel)
      .first()
      .isVisible()
      .catch(() => false);
    if (!still) return;
    const challenge = await detectChallenge(page);
    if (challenge === 'none') return;
    await page.waitForTimeout(500);
  }
  // Do not throw here — caller waitForURL may still succeed if user submitted but field stays mounted
}

export async function completeOtpStdin(page: Page): Promise<void> {
  assertChallengeAllowed({ mode: 'otp-stdin', viaTerminal: true });
  const otpSel = (process.env.AUTH_OTP_INPUT_SELECTOR ?? '').trim() || DEFAULT_OTP_INPUT;
  // Wait for OTP UI (SMS delay) before prompting
  try {
    await page.locator(otpSel).first().waitFor({ state: 'visible', timeout: 30_000 });
  } catch {
    console.warn(
      '[human-challenge] OTP field not detected yet — tetap minta kode di terminal. ' +
        'Set AUTH_OTP_INPUT_SELECTOR jika selector beda.',
    );
  }
  const code = await promptOtpFromTerminal();
  await fillOtpAndSubmit(page, code);
}

/**
 * CAPTCHA: headed browser only. Human solves widget; pause + wait until gone.
 */
export async function completeCaptchaBrowser(
  page: Page,
  opts: { timeoutMs?: number } = {},
): Promise<void> {
  assertChallengeAllowed({ mode: 'captcha-browser' });
  const timeoutMs = opts.timeoutMs ?? resolveChallengeTimeoutMs();

  console.log(
    '\n[human-challenge] CAPTCHA (browser only) — selesaikan di browser.\n' +
      '  Terminal tidak bisa menyelesaikan CAPTCHA.\n' +
      '  Jika Inspector terbuka: selesaikan CAPTCHA lalu Resume.\n' +
      `  Timeout: ${Math.round(timeoutMs / 1000)}s\n`,
  );

  try {
    await page.pause();
  } catch {
    // fall through to poll
  }

  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const kind = await detectChallenge(page);
    if (kind !== 'captcha') return;
    await page.waitForTimeout(500);
  }
}

/**
 * After password submit: detect challenge and complete per mode.
 * No-op when mode=none and no challenge UI (or challenge ignored).
 */
export async function handlePostLoginChallenge(
  page: Page,
  opts: { mode?: ChallengeMode } = {},
): Promise<DetectedChallenge> {
  const mode = opts.mode ?? resolveChallengeMode();
  // Brief wait for post-login redirect / challenge render
  await page.waitForTimeout(800);
  const detected = await detectChallenge(page);

  if (mode === 'none') {
    if (detected === 'otp' || detected === 'captcha') {
      console.warn(
        `[human-challenge] Detected ${detected} UI but AUTH_CHALLENGE_MODE=none. ` +
          `Set otp-browser (recommended), otp-stdin, or captcha-browser via 'npm run setup' or env:edit.`,
      );
    }
    return detected;
  }

  // Interactive modes: fail early if surface is invalid (auto needs headed or TTY)
  assertChallengeAllowed({
    mode: mode === 'auto' ? 'auto' : mode,
    viaTerminal: mode === 'otp-stdin',
  });

  if (detected === 'none') {
    // Force path if mode explicitly requires human step (user may need pause anyway)
    if (mode === 'captcha-browser') {
      await completeCaptchaBrowser(page);
      return 'captcha';
    }
    if (mode === 'otp-browser') {
      await completeOtpBrowser(page);
      return 'otp';
    }
    if (mode === 'otp-stdin') {
      await completeOtpStdin(page);
      return 'otp';
    }
    if (mode === 'auto') {
      // Prefer browser path when headed; else stdin
      const path = resolveAutoOtpPath({});
      if (path === 'otp-stdin') await completeOtpStdin(page);
      else await completeOtpBrowser(page);
      return 'otp';
    }
    return 'none';
  }

  if (detected === 'captcha') {
    if (mode === 'otp-stdin' || mode === 'otp-browser') {
      // Still allow captcha completion if captcha appears during otp mode
      assertChallengeAllowed({
        mode: mode === 'otp-stdin' ? 'captcha-browser' : mode,
        viaTerminal: false,
      });
    }
    if (mode === 'otp-stdin') {
      throw new Error(
        '[human-challenge] CAPTCHA detected but mode is otp-stdin. ' +
          'Switch to captcha-browser or auto with HEADLESS=false.',
      );
    }
    const effective: ChallengeMode =
      mode === 'auto' || mode === 'otp-browser' ? 'captcha-browser' : mode;
    assertChallengeAllowed({ mode: effective === 'captcha-browser' ? 'captcha-browser' : mode });
    await completeCaptchaBrowser(page);
    // captcha may be followed by OTP
    const after = await detectChallenge(page);
    if (after === 'otp') {
      await completeOtpForMode(page, mode);
    }
    return 'captcha';
  }

  if (detected === 'otp') {
    await completeOtpForMode(page, mode);
    return 'otp';
  }

  // unknown challenge UI — interactive modes only (mode=none already returned)
  console.warn('[human-challenge] Unknown challenge UI — opening pause for manual completion.');
  if (mode === 'otp-stdin') {
    throw new Error(
      '[human-challenge] Unknown challenge with otp-stdin. Use otp-browser / captcha-browser.',
    );
  }
  assertChallengeAllowed({
    mode: mode === 'auto' ? 'otp-browser' : mode,
  });
  try {
    await page.pause();
  } catch {
    // ignore
  }
  return detected;
}

async function completeOtpForMode(page: Page, mode: ChallengeMode): Promise<void> {
  if (mode === 'otp-stdin') {
    await completeOtpStdin(page);
    return;
  }
  if (mode === 'otp-browser') {
    await completeOtpBrowser(page);
    return;
  }
  if (mode === 'auto') {
    const path = resolveAutoOtpPath({});
    assertChallengeAllowed({ mode: path, viaTerminal: path === 'otp-stdin' });
    if (path === 'otp-stdin') await completeOtpStdin(page);
    else await completeOtpBrowser(page);
    return;
  }
  if (mode === 'captcha-browser') {
    // OTP after captcha path may land here
    await completeOtpBrowser(page);
    return;
  }
}
