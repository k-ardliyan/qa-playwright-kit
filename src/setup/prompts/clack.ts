/**
 * Shared @clack/prompts plumbing for every interactive CLI in the kit.
 *
 * Two responsibilities that the raw clack API leaves to each caller:
 *
 * 1. **TTY guard.** clack's `select` does not block on a non-TTY stdin — it
 *    resolves to the first option (verified). A tool that prompts under CI, a
 *    pipe, or an agent session would therefore silently pick a wrong value.
 *    `requireTty()` refuses to prompt unless a real terminal is attached, so
 *    callers must supply flags instead. Headless paths never reach this file.
 *
 * 2. **One cancellation contract.** Every prompt resolves to a cancel symbol on
 *    Ctrl+C; `abortIfCancelled()` folds that into the single
 *    `PROMPT_CANCELLED` error the CLIs already handle.
 *
 * Validators live here too (pure, no prompts) so the same rule is reused by an
 * interactive prompt and by a headless flag check.
 *
 * @module src/setup/prompts/clack
 */

import * as p from '@clack/prompts';

/** Thrown when the user cancels a prompt (Ctrl+C / Esc). */
export const PROMPT_CANCELLED = 'PROMPT_CANCELLED';

/** Alias kept for the wizard's existing catch site. */
export const SETUP_CANCELLED = 'SETUP_WIZARD_CANCELLED';

/**
 * True when stdin/stdout are a real TTY. Interactive prompts require this;
 * without it clack's `select` silently resolves to the first option.
 */
export function isInteractive(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

/**
 * Guard for callers that are about to prompt. Throws with an actionable message
 * rather than letting clack pick a wrong default on a non-TTY stdin.
 */
export function requireTty(context: string): void {
  if (!isInteractive()) {
    throw new Error(
      `${context} butuh terminal interaktif (TTY). Jalankan di terminal, atau pakai flag non-interaktif. ` +
        `${context} needs an interactive terminal (TTY). Run in a terminal, or use the non-interactive flags.`,
    );
  }
}

/**
 * Unwrap a prompt result, converting clack's cancel symbol into a clean abort.
 * `cancelLabel` lets each entry point phrase the message; the thrown error is
 * always the shared PROMPT_CANCELLED so callers have one catch path.
 */
export function abortIfCancelled<T>(value: T, cancelLabel = 'Dibatalkan.'): Exclude<T, symbol> {
  if (p.isCancel(value)) {
    p.cancel(cancelLabel);
    throw new Error(PROMPT_CANCELLED);
  }
  return value as Exclude<T, symbol>;
}

// ─── Flow primitives (thin re-exports so callers import from one place) ───────

export const intro = p.intro;
export const outro = p.outro;
export const note = p.note;
export const log = p.log;
export const spinner = p.spinner;
export const cancel = p.cancel;

// ─── Prompt primitives ───────────────────────────────────────────────────────

export const text = p.text;
export const select = p.select;
export const multiselect = p.multiselect;
export const confirm = p.confirm;
export const password = p.password;
export const autocomplete = p.autocomplete;

// ─── Reusable validators (pure, no prompts) ──────────────────────────────────
//
// Return an error string, or undefined when valid — the shape clack's
// `validate` expects, so the same function feeds both a prompt and a flag check.

/** Non-empty after trim. */
export function validateRequired(value: string | undefined, label: string): string | undefined {
  if (!value || value.trim().length === 0) return `${label} tidak boleh kosong / cannot be empty`;
  return undefined;
}

/** HTTP/HTTPS URL. */
export function validateUrl(value: string | undefined): string | undefined {
  if (!value || value.trim().length === 0) {
    return 'URL tidak boleh kosong / URL cannot be empty';
  }
  try {
    const u = new URL(value.trim());
    if (u.protocol !== 'http:' && u.protocol !== 'https:') {
      return 'Harus URL HTTP/HTTPS yang valid / Must be a valid HTTP/HTTPS URL';
    }
    return undefined;
  } catch {
    return 'Harus URL HTTP/HTTPS yang valid / Must be a valid HTTP/HTTPS URL';
  }
}

/** Comma-separated role list → at least one valid role name. */
export function validateRoleList(value: string | undefined): string | undefined {
  const roles = (value ?? '')
    .split(',')
    .map((r) => r.trim())
    .filter(Boolean);
  if (roles.length === 0) return 'Minimal satu role / At least one role';
  for (const r of roles) {
    if (!/^[a-z0-9-]+$/.test(r.toLowerCase())) {
      return `Role "${r}" tidak valid (huruf kecil, angka, tanda hubung) / invalid (lowercase, digits, hyphen)`;
    }
  }
  return undefined;
}
