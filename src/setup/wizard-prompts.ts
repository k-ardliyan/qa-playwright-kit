/**
 * Setup Wizard — interactive prompt UI for first-run and update flows.
 *
 * Uses the 'prompts' library (already a project dependency).
 * All prompts are cancellable — Ctrl+C aborts the wizard cleanly.
 *
 * @module src/setup/wizard-prompts
 */

import prompts from 'prompts';
import { KNOWN_APP_ENVS, type AppEnv } from '../utils/app-env';
import { type ChallengeMode, CHALLENGE_MODES } from '../support/human-challenge';
import { isPlaceholderCredential } from '../shared/utils/role-credentials';
import { checkReachable } from './reachability';

export interface RoleFields {
  email?: string;
  username?: string;
  phone?: string;
  password: string;
  loginIdPref?: 'email' | 'username' | 'phone';
}

// ─── Internal helpers ────────────────────────────────────────────────────────

function isValidEmail(v: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

function isNonEmpty(v: string): boolean {
  return v.trim().length > 0;
}

function isValidUrl(v: string): boolean {
  try {
    const u = new URL(v);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

function stripTrailingSlash(v: string): string {
  return v.endsWith('/') ? v.slice(0, -1) : v;
}

/**
 * Pure numbered-choice parser — unit-testable without TTY.
 * Returns 1-based index on success, or an error message string on failure.
 * ponytail: keep inline when still 1 consumer; extract to shared when reused cross-module.
 */
export function parseNumberedChoice(raw: string, len: number): number | string {
  const s = raw.trim();
  if (!s) return `Masukkan angka 1-${len}`;
  const n = Number(s);
  if (!Number.isInteger(n) || n < 1 || n > len) return `Masukkan angka 1-${len}`;
  return n;
}

/** Abort handler — re-throws a special cancel so the orchestrator can exit cleanly. */
function onCancel(): never {
  throw new Error('SETUP_WIZARD_CANCELLED');
}

/**
 * Numbered choice — type-then-Enter (robust for non-technical users).
 * Prints `1. title — description` lines, then prompts for a number.
 * Never auto-submits on keypress; requires Enter to confirm.
 * ponytail: add arrow-key live preview when prompts lib is replaced.
 */
async function promptNumberedChoice<T extends string>(opts: {
  message: string;
  choices: Array<{ title: string; value: T; description?: string }>;
  existing?: string;
}): Promise<T> {
  const { choices, message, existing } = opts;
  console.log('');
  choices.forEach((c, i) => {
    const marker = c.value === existing ? ' (saat ini)' : '';
    const desc = c.description ? ` — ${c.description}` : '';
    console.log(`  ${i + 1}. ${c.title}${desc}${marker}`);
  });
  const initialIdx = existing ? choices.findIndex((c) => c.value === existing) : -1;
  const initial = initialIdx >= 0 ? String(initialIdx + 1) : '1';
  const { value } = await prompts(
    {
      type: 'text',
      name: 'value',
      message: `${message} — ketik angka 1-${choices.length} lalu Enter`,
      initial,
      validate: (v: string) => {
        const r = parseNumberedChoice(v, choices.length);
        return typeof r === 'number' ? true : r;
      },
    },
    { onCancel },
  );
  const n = Number(String(value).trim());
  return choices[n - 1]!.value;
}

// ─── Public prompts ──────────────────────────────────────────────────────────

/**
 * Prompt for APP_ENV selection.
 * Pre-fills existing value if provided.
 */
export async function promptAppEnv(existing?: string): Promise<AppEnv> {
  return promptNumberedChoice<AppEnv>({
    message: 'Pilih environment (APP_ENV)',
    choices: KNOWN_APP_ENVS.map((env) => ({ title: env, value: env as AppEnv })),
    existing,
  });
}

/**
 * Prompt for BASE_URL.
 * Validates: HTTP/HTTPS, no trailing slash, optionally reachable.
 */
export async function promptBaseUrl(existing?: string): Promise<string> {
  let attempts = 0;
  const maxAttempts = 3;

  while (attempts < maxAttempts) {
    attempts += 1;
    const { value } = await prompts(
      {
        type: 'text',
        name: 'value',
        message: 'Base URL of the application under test',
        initial: existing ?? 'http://localhost:3000',
        validate: (v: string) => {
          if (!isNonEmpty(v)) return 'URL cannot be empty';
          if (!isValidUrl(v)) return 'Must be a valid HTTP/HTTPS URL';
          return true;
        },
      },
      { onCancel },
    );

    const url = stripTrailingSlash(value as string);

    // Optional: test reachability
    const { confirm } = await prompts(
      {
        type: 'confirm',
        name: 'confirm',
        message: `Test reachability of ${url}? (HEAD request)`,
        initial: true,
      },
      { onCancel },
    );

    if (confirm) {
      const reachable = await checkReachable(url);

      if (!reachable) {
        const { proceed } = await prompts(
          {
            type: 'confirm',
            name: 'proceed',
            message: `⚠ ${url} is not reachable. Continue anyway?`,
            initial: false,
          },
          { onCancel },
        );
        if (!proceed) continue;
      }
    }

    return url;
  }

  // Fallback after max attempts
  throw new Error(`Failed to get a valid BASE_URL after ${maxAttempts} attempts`);
}

/**
 * Prompt for credentials of a single role.
 * Simplest path for non-technical users: pick one login identifier (email/username/phone),
 * fill it, then password (+ confirm). Pre-fills existing value when provided.
 */
export async function promptRoleCredentials(
  role: string,
  existing?: Partial<RoleFields>,
): Promise<RoleFields> {
  // Choose the login identifier to configure.
  // Existing value (if any) is pre-selected: loginIdPref → email → username → phone.
  const pickId =
    (existing?.loginIdPref &&
      ((['email', 'username', 'phone'] as const).includes(existing.loginIdPref)
        ? existing.loginIdPref
        : undefined)) ||
    (existing?.email
      ? 'email'
      : existing?.username
        ? 'username'
        : existing?.phone
          ? 'phone'
          : 'email');
  const id = await promptNumberedChoice<'email' | 'username' | 'phone'>({
    message: `Metode login untuk role "${role}"`,
    choices: [
      { title: 'Email', value: 'email' },
      { title: 'Username', value: 'username' },
      { title: 'Phone', value: 'phone' },
    ],
    existing: pickId,
  });

  const value = await prompts(
    {
      type: 'text',
      name: 'value',
      message: `  ${id} untuk ${role}`,
      initial: existing?.[id] ?? '',
      validate: (v: string) => {
        if (!v.trim()) return `${id} tidak boleh kosong`;
        if (id === 'email' && !isValidEmail(v)) return 'Format email tidak valid';
        if (isPlaceholderCredential(v)) return 'Terlihat placeholder — masukkan nilai asli';
        return true;
      },
    },
    { onCancel },
  );

  const fields: RoleFields = { password: '' };
  fields[id] = String(value).trim();
  fields.loginIdPref = id;

  // Password (always required) — placeholder rejected at prompt
  const { password } = await prompts(
    {
      type: 'password',
      name: 'password',
      message: `Password untuk ${role}`,
      validate: (v: string) => {
        if (v.trim().length === 0) return 'Password tidak boleh kosong';
        if (isPlaceholderCredential(v)) return 'Terlihat placeholder — masukkan password asli';
        return true;
      },
    },
    { onCancel },
  );
  // Confirm password (prevents typo in hidden input)
  const { confirm } = await prompts(
    {
      type: 'password',
      name: 'confirm',
      message: `Konfirmasi password untuk ${role}`,
    },
    { onCancel },
  );
  if ((confirm as string) !== (password as string)) {
    throw new Error(`Password tidak cocok untuk role "${role}" — wizard dibatalkan`);
  }
  fields.password = password as string;

  return fields;
}

/**
 * Prompt for which roles to configure.
 * Always includes 'user' (default role).
 */
export async function promptRoles(existingRoles?: string[]): Promise<string[]> {
  const { input } = await prompts(
    {
      type: 'list',
      name: 'input',
      message: 'Roles to configure (comma-separated, e.g. "user,finance,super-admin")',
      initial: existingRoles?.join(',') ?? 'user',
      separator: ',',
    },
    { onCancel },
  );

  const roles = (input as string[])
    .map((r: string) => r.trim().toLowerCase())
    .filter((r: string) => r.length > 0);

  // Ensure 'user' is always present
  if (!roles.includes('user')) {
    roles.unshift('user');
  }

  return roles;
}

/**
 * Prompt for AUTH_CHALLENGE_MODE.
 */
export async function promptChallengeMode(existing?: string): Promise<ChallengeMode> {
  return promptNumberedChoice<ChallengeMode>({
    message: 'Mode challenge autentikasi',
    existing: existing ?? 'none',
    choices: CHALLENGE_MODES.map((m) => ({
      title: m,
      value: m as ChallengeMode,
      description:
        m === 'none'
          ? 'Tanpa challenge (default)'
          : m === 'otp-browser'
            ? 'OTP via browser (disarankan)'
            : m === 'otp-stdin'
              ? 'OTP via terminal'
              : m === 'captcha-browser'
                ? 'CAPTCHA via browser'
                : m === 'auto'
                  ? 'Otomatis deteksi'
                  : undefined,
    })),
  });
}

/**
 * Prompt to confirm overwriting an existing env file.
 */
export async function confirmOverwrite(envFilePath: string): Promise<boolean> {
  const { overwrite } = await prompts(
    {
      type: 'confirm',
      name: 'overwrite',
      message: `Env file already exists: ${envFilePath}\n  Update it?`,
      initial: true,
    },
    { onCancel },
  );
  return overwrite as boolean;
}
