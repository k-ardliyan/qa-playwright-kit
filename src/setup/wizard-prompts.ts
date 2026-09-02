/**
 * Setup Wizard — interactive prompt UI for first-run and update flows.
 *
 * Uses the 'prompts' library (already a project dependency).
 * All prompts are cancellable — Ctrl+C aborts the wizard cleanly.
 * Messages are bilingual (id/en) — language is chosen at wizard start.
 *
 * @module src/setup/wizard-prompts
 */

import prompts from 'prompts';
import { KNOWN_APP_ENVS, type AppEnv } from '../utils/app-env';
import { type ChallengeMode, CHALLENGE_MODES } from '../support/human-challenge';
import { isPlaceholderCredential } from '../shared/utils/role-credentials';
import { checkReachable } from './reachability';
import { type WizardLang, t, LANG_LABELS, KNOWN_LANGS } from './i18n';

export interface RoleFields {
  email?: string;
  username?: string;
  phone?: string;
  password: string;
  loginIdPref?: 'email' | 'username' | 'phone';
  loginUrlPath?: string;
  successUrlPath?: string;
}

/** Sentinel returned when the user picks "back" on a numbered choice. */
export const BACK = Symbol('back');

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

/** Strip control characters that corrupt .env values (paste artifacts). */
function stripControlChars(v: string): string {
  let out = '';
  for (const ch of v) {
    const c = ch.charCodeAt(0);
    if (c >= 0x20 || c === 0x09 || c === 0x0a || c === 0x0d) out += ch;
  }
  return out;
}

/**
 * Pure numbered-choice parser — unit-testable without TTY.
 * Returns 1-based index on success, or an error message string on failure.
 * ponytail: keep inline when still 1 consumer; extract to shared when reused cross-module.
 */
export function parseNumberedChoice(
  raw: string,
  len: number,
  lang: WizardLang = 'id',
): number | string {
  const s = raw.trim();
  if (!s) return t(lang, `Masukkan angka 1-${len}`, `Enter a number 1-${len}`);
  const n = Number(s);
  if (!Number.isInteger(n) || n < 1 || n > len) {
    return t(lang, `Masukkan angka 1-${len}`, `Enter a number 1-${len}`);
  }
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
  lang: WizardLang;
  message: string;
  choices: Array<{ title: string; value: T; description?: string }>;
  existing?: string;
}): Promise<T> {
  const { lang, choices, message, existing } = opts;
  console.log('');
  choices.forEach((c, i) => {
    const marker = c.value === existing ? t(lang, ' (saat ini)', ' (current)') : '';
    const desc = c.description ? ` — ${c.description}` : '';
    console.log(`  ${i + 1}. ${c.title}${desc}${marker}`);
  });
  const initialIdx = existing ? choices.findIndex((c) => c.value === existing) : -1;
  const initial = initialIdx >= 0 ? String(initialIdx + 1) : '1';
  const { value } = await prompts(
    {
      type: 'text',
      name: 'value',
      message: `${message} — ${t(lang, 'ketik angka lalu Enter', 'type a number and press Enter')}`,
      initial,
      validate: (v: string) => {
        const r = parseNumberedChoice(v, choices.length, lang);
        return typeof r === 'number' ? true : r;
      },
    },
    { onCancel },
  );
  const n = Number(String(value).trim());
  return choices[n - 1]!.value;
}

/** Inputs that mean "go back" on a text/password prompt. */
const BACK_INPUTS = new Set(['0', 'back', 'kembali']);

/**
 * Text/password prompt with a back escape hatch.
 * Typing 0 / back / kembali returns the BACK sentinel instead of a value.
 * The hint is shown once at the start of the credentials flow, not per prompt.
 */
async function promptTextWithBack(opts: {
  lang: WizardLang;
  message: string;
  initial?: string;
  isSecret?: boolean;
  validate?: (v: string) => string | true;
}): Promise<string | typeof BACK> {
  const { message, initial, isSecret, validate } = opts;
  const { value } = await prompts(
    {
      type: isSecret ? 'password' : 'text',
      name: 'value',
      message,
      initial,
      validate: (v: string) => {
        if (BACK_INPUTS.has(v.trim().toLowerCase())) return true;
        return validate ? validate(v) : true;
      },
    },
    { onCancel },
  );
  const raw = String(value ?? '');
  if (BACK_INPUTS.has(raw.trim().toLowerCase())) return BACK;
  return raw;
}

// ─── Public prompts ──────────────────────────────────────────────────────────

/**
 * First-run language selection (Indonesian default).
 */
export async function promptLanguage(existing?: WizardLang): Promise<WizardLang> {
  return promptNumberedChoice<WizardLang>({
    lang: 'id',
    message: t('id', 'Pilih bahasa', 'Choose language'),
    choices: KNOWN_LANGS.map((l) => ({ title: LANG_LABELS[l], value: l })),
    existing: existing ?? 'id',
  });
}

/**
 * Prompt for APP_ENV selection.
 * Pre-fills existing value if provided.
 */
export async function promptAppEnv(lang: WizardLang, existing?: string): Promise<AppEnv> {
  return promptNumberedChoice<AppEnv>({
    lang,
    message: t(lang, 'Pilih environment (APP_ENV)', 'Select environment (APP_ENV)'),
    choices: KNOWN_APP_ENVS.map((env) => ({ title: env, value: env as AppEnv })),
    existing,
  });
}

/**
 * Prompt for BASE_URL.
 * Validates: HTTP/HTTPS, no trailing slash, optionally reachable.
 */
export async function promptBaseUrl(lang: WizardLang, existing?: string): Promise<string> {
  let attempts = 0;
  const maxAttempts = 3;

  while (attempts < maxAttempts) {
    attempts += 1;
    const { value } = await prompts(
      {
        type: 'text',
        name: 'value',
        message: t(
          lang,
          'Base URL aplikasi yang akan ditest',
          'Base URL of the application under test',
        ),
        initial: existing ?? 'http://localhost:3000',
        validate: (v: string) => {
          if (!isNonEmpty(v)) return t(lang, 'URL tidak boleh kosong', 'URL cannot be empty');
          if (!isValidUrl(v))
            return t(lang, 'Harus URL HTTP/HTTPS yang valid', 'Must be a valid HTTP/HTTPS URL');
          return true;
        },
      },
      { onCancel },
    );

    const url = stripTrailingSlash(stripControlChars(value as string));

    // Reachability is tested automatically (no confirmation prompt).
    // On failure the user chooses: continue anyway or re-enter the URL.
    const reachable = await checkReachable(url);

    if (!reachable) {
      const { proceed } = await prompts(
        {
          type: 'confirm',
          name: 'proceed',
          message: t(
            lang,
            `⚠ ${url} tidak bisa diakses. Lanjutkan saja? (pilih "tidak" untuk ganti URL)`,
            `⚠ ${url} is not reachable. Continue anyway? (choose "no" to change the URL)`,
          ),
          initial: false,
        },
        { onCancel },
      );
      if (!proceed) continue;
    }

    return url;
  }

  // Fallback after max attempts
  throw new Error(
    t(
      lang,
      `Gagal mendapatkan BASE_URL valid setelah ${maxAttempts} percobaan`,
      `Failed to get a valid BASE_URL after ${maxAttempts} attempts`,
    ),
  );
}

/**
 * Normalize an app-path answer (login page / post-login redirect).
 * Accepts pasted full URLs (→ pathname only), adds the leading slash,
 * strips query/hash/trailing slash; empty → fallback default.
 */
export function normalizeAppPath(raw: string, fallback: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return fallback;
  let candidate = trimmed;
  if (/^https?:\/\//i.test(candidate)) {
    try {
      const parsed = new URL(candidate);
      candidate = parsed.pathname || '/';
    } catch {
      return fallback;
    }
  }
  candidate = candidate.split('?')[0]!.split('#')[0]!.trim();
  if (!candidate) return fallback;
  // Collapse duplicate slashes and ensure a single leading slash
  candidate = '/' + candidate.replace(/^\/+/, '').replace(/\/+/g, '/').replace(/\/+$/, '');
  return candidate.length > 1 ? candidate : fallback;
}

/** Prompt validator for path inputs: empty (default) or a path / full URL. */
export function isValidAppPathInput(v: string): boolean {
  const t = v.trim();
  if (!t) return true;
  if (/^https?:\/\//i.test(t)) return true;
  return !/\s/.test(t) && !t.includes('?') && !t.includes('#');
}

/**
 * Prompt for credentials of a single role.
 * Simpler path for non-technical users: pick one login identifier (email/username/phone),
 * fill it, then password (+ confirm). Pre-fills existing value when provided.
 *
 * Back navigation: each text/password prompt accepts `0` (or `back` / `kembali`)
 * to return exactly one step: confirm → password (can change the first password),
 * password → identifier value, identifier value → picker.
 * The hint is printed once before the first prompt. Password mismatch
 * re-prompts (does not abort).
 */
export async function promptRoleCredentials(
  lang: WizardLang,
  role: string,
  existing?: Partial<RoleFields>,
): Promise<RoleFields | typeof BACK> {
  console.log(
    t(
      lang,
      `  💡 Ketik 0 (atau "back"/"kembali") di prompt mana pun untuk kembali satu langkah.`,
      `  💡 Type 0 (or "back"/"kembali") on any prompt to go back one step.`,
    ),
  );

  // Existing value (if any) is pre-selected: loginIdPref → username → email → phone.
  const pickId =
    (existing?.loginIdPref &&
      ((['username', 'email', 'phone'] as const).includes(existing.loginIdPref)
        ? existing.loginIdPref
        : undefined)) ||
    (existing?.username
      ? 'username'
      : existing?.email
        ? 'email'
        : existing?.phone
          ? 'phone'
          : 'username');

  const validateIdent = (id: 'email' | 'username' | 'phone') => (v: string) => {
    if (!v.trim()) return t(lang, `${id} tidak boleh kosong`, `${id} cannot be empty`);
    if (id === 'email' && !isValidEmail(v)) {
      return t(lang, 'Format email tidak valid', 'Invalid email format');
    }
    if (isPlaceholderCredential(v)) {
      return t(
        lang,
        'Terlihat placeholder — masukkan nilai asli',
        'Looks like a placeholder — enter the real value',
      );
    }
    return true;
  };

  const validatePassword = (v: string) => {
    if (v.trim().length === 0)
      return t(lang, 'Password tidak boleh kosong', 'Password cannot be empty');
    if (isPlaceholderCredential(v)) {
      return t(
        lang,
        'Terlihat placeholder — masukkan password asli',
        'Looks like a placeholder — enter the real password',
      );
    }
    return true;
  };

  // 6-step loop:
  // 0 = method picker (username/email/phone)
  // 1 = identifier value
  // 2 = password
  // 3 = password confirm
  // 4 = loginUrlPath (e.g. /login or /admin/login)
  // 5 = successUrlPath (e.g. /dashboard or /guru/kelas)
  let step: 0 | 1 | 2 | 3 | 4 | 5 = 0;
  let id: 'email' | 'username' | 'phone' = pickId;
  let identValue = '';
  let password = '';
  let loginPath = '';
  let successPath: string;

  for (;;) {
    if (step === 0) {
      id = await promptNumberedChoice<'username' | 'email' | 'phone'>({
        lang,
        message: t(lang, `Metode login untuk role "${role}"`, `Login method for role "${role}"`),
        choices: [
          { title: 'Username', value: 'username' },
          { title: 'Email', value: 'email' },
          { title: 'Phone', value: 'phone' },
        ],
        existing: pickId,
      });
      step = 1;
      continue;
    }

    if (step === 1) {
      const value = await promptTextWithBack({
        lang,
        message: `  ${id} ${t(lang, 'untuk', 'for')} ${role}`,
        initial: existing?.[id] ?? '',
        validate: validateIdent(id),
      });
      if (value === BACK) {
        step = 0;
        continue;
      }
      identValue = value.trim();
      step = 2;
      continue;
    }

    if (step === 2) {
      const value = await promptTextWithBack({
        lang,
        isSecret: true,
        message: t(lang, `Password untuk ${role}`, `Password for ${role}`),
        validate: validatePassword,
      });
      if (value === BACK) {
        step = 1;
        continue;
      }
      password = value;
      step = 3;
      continue;
    }

    if (step === 3) {
      // step === 3: confirm — mismatch re-prompts, 0 goes back to password.
      const confirm = await promptTextWithBack({
        lang,
        isSecret: true,
        message: t(lang, `Konfirmasi password untuk ${role}`, `Confirm password for ${role}`),
      });
      if (confirm === BACK) {
        step = 2;
        continue;
      }
      if (confirm === password) {
        step = 4;
        continue;
      }
      console.log(
        t(
          lang,
          `⚠ Password tidak cocok untuk role "${role}" — coba lagi`,
          `⚠ Passwords do not match for role "${role}" — try again`,
        ),
      );
      continue;
    }

    if (step === 4) {
      const defaultLogin = existing?.loginUrlPath || '/login';
      const value = await promptTextWithBack({
        lang,
        message: t(
          lang,
          `Path halaman login untuk ${role} (Enter = ${defaultLogin})`,
          `Login page path for ${role} (Enter = ${defaultLogin})`,
        ),
        initial: defaultLogin,
        validate: (v: string) =>
          isValidAppPathInput(v) || t(lang, 'Format path tidak valid', 'Invalid path format'),
      });
      if (value === BACK) {
        step = 3;
        continue;
      }
      loginPath = normalizeAppPath(value, defaultLogin);
      step = 5;
      continue;
    }

    // step === 5: success redirect path
    const defaultSuccess = existing?.successUrlPath || '/dashboard';
    const value = await promptTextWithBack({
      lang,
      message: t(
        lang,
        `Path redirect sukses untuk ${role} (Enter = ${defaultSuccess})`,
        `Success redirect path for ${role} (Enter = ${defaultSuccess})`,
      ),
      initial: defaultSuccess,
      validate: (v: string) =>
        isValidAppPathInput(v) || t(lang, 'Format path tidak valid', 'Invalid path format'),
    });
    if (value === BACK) {
      step = 4;
      continue;
    }
    successPath = normalizeAppPath(value, defaultSuccess);

    const fields: RoleFields = {
      password,
      loginUrlPath: loginPath,
      successUrlPath: successPath,
    };
    fields[id] = identValue;
    fields.loginIdPref = id;
    return fields;
  }
}

/**
 * Prompt for which roles to configure.
 * Accepts user-specified roles (e.g. "admin,guru,murid" or "user").
 * Defaults to 'user' when nothing is specified.
 */
export async function promptRoles(lang: WizardLang, existingRoles?: string[]): Promise<string[]> {
  const defaultRoles = existingRoles && existingRoles.length > 0 ? existingRoles.join(',') : 'user';
  const { input } = await prompts(
    {
      type: 'text',
      name: 'input',
      message: t(
        lang,
        'Roles yang dikonfigurasi (pisahkan koma, mis. "admin,guru,murid" atau "user")',
        'Roles to configure (comma-separated, e.g. "admin,guru,murid" or "user")',
      ),
      initial: defaultRoles,
    },
    { onCancel },
  );

  const raw = String(input ?? '').trim();
  const rawList = raw.includes(',') ? raw.split(',') : [raw];
  const roles = rawList
    .map((r: string) => r.trim().toLowerCase())
    .filter((r: string) => r.length > 0);

  // Fallback to 'user' only if list is completely empty
  if (roles.length === 0) {
    return ['user'];
  }

  // De-duplicate while preserving order, mapping legacy aliases
  const uniqueRoles: string[] = [];
  for (const r of roles) {
    const canonical = r === 'default' || r === 'general' ? 'user' : r;
    if (!uniqueRoles.includes(canonical)) {
      uniqueRoles.push(canonical);
    }
  }

  return uniqueRoles;
}

/**
 * Prompt for AUTH_CHALLENGE_MODE.
 */
export async function promptChallengeMode(
  lang: WizardLang,
  existing?: string,
): Promise<ChallengeMode> {
  return promptNumberedChoice<ChallengeMode>({
    lang,
    message: t(lang, 'Mode challenge autentikasi', 'Auth challenge mode'),
    existing: existing ?? 'none',
    choices: CHALLENGE_MODES.map((m) => ({
      title: m,
      value: m as ChallengeMode,
      description:
        m === 'none'
          ? t(lang, 'Tanpa challenge (default)', 'No challenge (default)')
          : m === 'otp-browser'
            ? t(lang, 'OTP via browser (disarankan)', 'OTP via browser (recommended)')
            : m === 'otp-stdin'
              ? t(lang, 'OTP via terminal', 'OTP via terminal')
              : m === 'captcha-browser'
                ? t(lang, 'CAPTCHA via browser', 'CAPTCHA via browser')
                : m === 'auto'
                  ? t(lang, 'Otomatis deteksi', 'Auto detect')
                  : undefined,
    })),
  });
}

/**
 * Prompt to confirm overwriting an existing env file.
 */
export async function confirmOverwrite(lang: WizardLang, envFilePath: string): Promise<boolean> {
  const { overwrite } = await prompts(
    {
      type: 'confirm',
      name: 'overwrite',
      message: t(
        lang,
        `File env sudah ada: ${envFilePath}\n  Update?`,
        `Env file already exists: ${envFilePath}\n  Update it?`,
      ),
      initial: true,
    },
    { onCancel },
  );
  return overwrite as boolean;
}
