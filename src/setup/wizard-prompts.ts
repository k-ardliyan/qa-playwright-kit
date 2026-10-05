/**
 * Setup Wizard — interactive prompt UI for first-run and update flows.
 *
 * Built on @clack/prompts following its best practices:
 * - stage choices use `select` (arrow-key, descriptive labels) instead of a
 *   numbered-text picker;
 * - `PREV` ("<" / back) is offered as an explicit navigation option in the
 *   select list, so going back is a visible choice, not a hidden keystroke;
 * - validators come from `./prompts/clack` (pure, reusable by headless flags);
 * - every prompt funnels cancellation through the shared `abortIfCancelled`.
 *
 * TTY contract: `select` requires a real terminal. Non-TTY callers (CI, pipes,
 * agent sessions) must pass values via flags/env — the wizard's headless path
 * never calls these prompts. See ./prompts/clack `requireTty`.
 *
 * Messages are bilingual (id/en) — language is chosen at wizard start.
 *
 * @module src/setup/wizard-prompts
 */

import {
  abortIfCancelled,
  confirm as clackConfirm,
  password as clackPassword,
  select as clackSelect,
  text as clackText,
  validateRoleList,
  validateUrl,
} from './prompts/clack';
import { KNOWN_APP_ENVS, type AppEnv } from '../utils/app-env';
import { type ChallengeMode } from '../support/human-challenge';
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
  company?: string;
}

/** Sentinel returned when the user picks "back" on a numbered choice. */
export const BACK = Symbol('back');

/**
 * Sentinel returned when the user asks to go back to the PREVIOUS wizard stage
 * (not just the previous field). Returned only by stage-level prompts.
 */
export const PREV = Symbol('prev');

/** Inputs that mean "back one field". */
const BACK_INPUTS = new Set(['0', 'back', 'kembali']);
/** Inputs that mean "back one whole stage" (typed at a stage's first prompt). */
const PREV_INPUTS = new Set(['<', 'prev', 'sebelumnya']);

// ─── Internal helpers ────────────────────────────────────────────────────────

function isValidEmail(v: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
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

/**
 * Yes/no confirm on clack. Ctrl+C aborts.
 * Exported so other setup modules share one confirm implementation instead of
 * each importing the prompt library directly.
 */
export async function confirmPrompt(message: string, initialValue = true): Promise<boolean> {
  return abortIfCancelled(await clackConfirm({ message, initialValue }));
}

/**
 * Stage choice via clack `select` (arrow-key, descriptive labels). When
 * `allowPrev` is set the list gains an explicit "kembali" entry that resolves to
 * PREV — back navigation is a visible option, not a hidden keystroke.
 *
 * clack's `select` types options as `Option<T>` where T is a plain value type,
 * so PREV rides through as a private string token and is mapped back here —
 * this keeps the caller-facing return type `T | typeof PREV` without fighting
 * the library's generics with symbol unions.
 *
 * Requires a TTY (select does not block otherwise); callers are interactive-only.
 */
const PREV_TOKEN = '__wizard_prev__';

async function promptChoice<T extends string>(opts: {
  lang: WizardLang;
  message: string;
  choices: Array<{ title: string; value: T; description?: string }>;
  existing?: string;
  allowPrev?: boolean;
}): Promise<T | typeof PREV> {
  const { lang, choices, message, existing, allowPrev } = opts;

  const options = choices.map((c) => ({
    value: c.value as string,
    label: `${c.title}${c.value === existing ? t(lang, ' (saat ini)', ' (current)') : ''}`,
    hint: c.description,
  }));
  if (allowPrev) {
    options.push({
      value: PREV_TOKEN,
      label: t(lang, '← Kembali ke langkah sebelumnya', '← Back to previous step'),
      hint: undefined,
    });
  }

  const chosen = abortIfCancelled(
    await clackSelect<string>({
      message,
      options,
      initialValue: String(choices.find((c) => c.value === existing)?.value ?? choices[0]!.value),
    }),
  );
  return chosen === PREV_TOKEN ? PREV : (chosen as T);
}

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
  const run = isSecret ? clackPassword : clackText;
  const value = abortIfCancelled(
    await run({
      message,
      // initialValue (NOT defaultValue): pre-fills the buffer so the previous
      // env value is visible and editable. Passwords pass no initial (secrets
      // stay encrypted on disk and are never echoed back into a prompt).
      initialValue: isSecret ? undefined : initial,
      validate: (v) => {
        if (BACK_INPUTS.has((v ?? '').trim().toLowerCase())) return undefined;
        const r = validate ? validate(v ?? '') : true;
        return r === true ? undefined : r;
      },
    }),
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
  const picked = await promptChoice<WizardLang>({
    lang: 'id',
    message: t('id', 'Pilih bahasa', 'Choose language'),
    choices: KNOWN_LANGS.map((l) => ({ title: LANG_LABELS[l], value: l })),
    existing: existing ?? 'id',
  });
  return picked as WizardLang;
}

/**
 * Prompt for APP_ENV selection.
 * Pre-fills existing value if provided. `allowPrev` lets QA go back to Language.
 */
export async function promptAppEnv(
  lang: WizardLang,
  existing?: string,
  allowPrev = false,
): Promise<AppEnv | typeof PREV> {
  return promptChoice<AppEnv>({
    lang,
    message: t(lang, 'Pilih environment (APP_ENV)', 'Select environment (APP_ENV)'),
    choices: KNOWN_APP_ENVS.map((env) => ({ title: env, value: env as AppEnv })),
    existing,
    allowPrev,
  });
}

/**
 * Prompt for BASE_URL.
 * Validates: HTTP/HTTPS, no trailing slash, optionally reachable.
 * `allowPrev` lets QA go back to the APP_ENV stage before entering a value.
 */
export async function promptBaseUrl(
  lang: WizardLang,
  existing?: string,
  allowPrev = false,
): Promise<string | typeof PREV> {
  let attempts = 0;
  const maxAttempts = 3;

  while (attempts < maxAttempts) {
    attempts += 1;
    // initialValue (NOT defaultValue): it writes the previous env value into the
    // readline buffer so QA SEES and can edit it. defaultValue is applied only
    // at finalize, so the value stays invisible behind a generic placeholder.
    const fallbackUrl = 'http://localhost:3000';
    const value = abortIfCancelled(
      await clackText({
        message:
          t(lang, 'Base URL aplikasi yang akan ditest', 'Base URL of the application under test') +
          (allowPrev
            ? ` — ${t(lang, 'atau ketik "<" untuk kembali', 'or type "<" to go back')}`
            : ''),
        placeholder: fallbackUrl,
        initialValue: existing && existing.length > 0 ? existing : fallbackUrl,
        validate: (v) => {
          if (allowPrev && PREV_INPUTS.has((v ?? '').trim().toLowerCase())) return undefined;
          return validateUrl(v);
        },
      }),
    );

    const raw = stripControlChars(value);
    if (allowPrev && PREV_INPUTS.has(raw.trim().toLowerCase())) return PREV;

    const url = stripTrailingSlash(raw);

    // Reachability is tested automatically (no confirmation prompt).
    // On failure the user chooses: continue anyway or re-enter the URL.
    const reachable = await checkReachable(url);

    if (!reachable) {
      const proceed = abortIfCancelled(
        await clackConfirm({
          message: t(
            lang,
            `⚠ ${url} tidak bisa diakses. Lanjutkan saja? (pilih "tidak" untuk ganti URL)`,
            `⚠ ${url} is not reachable. Continue anyway? (choose "no" to change the URL)`,
          ),
          initialValue: false,
        }),
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
 * Keep whatever shape QA pasted. Tenant can be a path, a query, a host, or an SPA hash.
 * Empty → fallback. Trailing slash and duplicate slashes collapse. A bare `#anchor` is dropped.
 * A hash that starts a route (`#/` or `/#/`) stays — that is the page.
 * Absolute and protocol-relative URLs stay absolute (host is the tenant).
 */
export function normalizeAppPath(raw: string, fallback: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return fallback;

  if (/^https?:\/\//i.test(trimmed) || isProtocolRelativeHost(trimmed)) {
    const absolute = trimmed.startsWith('//') ? `https:${trimmed}` : trimmed;
    try {
      const parsed = new URL(absolute);
      parsed.hash = spaHash(parsed.hash);
      const path = parsed.pathname.replace(/\/{2,}/g, '/').replace(/\/+$/, '') || '/';
      if (path === '/' && !parsed.search && !parsed.hash) return fallback;
      if (path !== '/') parsed.pathname = path;
      return parsed.toString();
    } catch {
      return fallback;
    }
  }

  const hashAt = trimmed.indexOf('#');
  const hash = hashAt >= 0 ? spaHash(trimmed.slice(hashAt)) : '';
  const beforeHash = hashAt >= 0 ? trimmed.slice(0, hashAt) : trimmed;
  const q = beforeHash.indexOf('?');
  const query = q >= 0 ? beforeHash.slice(q) : '';
  let path = (q >= 0 ? beforeHash.slice(0, q) : beforeHash).trim();

  // `#/route` is the whole page. Do not glue it onto the fallback path.
  if (hash.startsWith('#/') && !path) return hash;

  if (!path) {
    if (!query && !hash) return fallback;
    const base = fallback.split('?')[0]!.split('#')[0]!;
    return `${base}${query}${hash}`;
  }

  path = '/' + path.replace(/^\/+/, '').replace(/\/+/g, '/').replace(/\/+$/, '');
  if (path === '/' && !query && !hash) return fallback;
  return `${path}${query}${hash}`;
}

/** `#/route` is the page. `#section` is an anchor — drop it. */
function spaHash(hash: string): string {
  if (hash === '#' || hash === '') return '';
  return hash.startsWith('#/') ? hash.replace(/\/+$/, '') : '';
}

/** `//acme.app.com/login` is a host. `//nested//path` is a sloppy path. `localhost` has no dot. */
function isProtocolRelativeHost(value: string): boolean {
  if (!value.startsWith('//')) return false;
  const host = (value.slice(2).split('/')[0] ?? '').toLowerCase();
  return host.includes('.') || host === 'localhost' || host.startsWith('localhost:');
}

/** Prompt validator for path inputs: empty (default) or a path / full URL. */
export function isValidAppPathInput(v: string): boolean {
  const t = v.trim();
  if (!t) return true;
  if (/^https?:\/\//i.test(t) || t.startsWith('//')) return true;
  if (t.startsWith('#/') || t.startsWith('/#')) return !/\s/.test(t);
  return !/\s/.test(t) && !t.includes('#');
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

  // 7-step loop:
  // 0 = method picker (username/email/phone)
  // 1 = identifier value
  // 2 = password
  // 3 = password confirm
  // 4 = loginUrlPath (e.g. /login or /admin/login)
  // 5 = successUrlPath (e.g. /dashboard or /guru/kelas)
  // 6 = company/tenant code (opsional, Enter = tidak ada)
  let step: 0 | 1 | 2 | 3 | 4 | 5 | 6 = 0;
  let id: 'email' | 'username' | 'phone' = pickId;
  let identValue = '';
  let password = '';
  let loginPath = '';
  // Pre-seeded with the step-5 default: step 6 always runs after step 5, but
  // TypeScript cannot prove that across the block boundary.
  let successPath = existing?.successUrlPath || '/dashboard';

  for (;;) {
    if (step === 0) {
      id = (await promptChoice<'username' | 'email' | 'phone'>({
        lang,
        message: t(lang, `Metode login untuk role "${role}"`, `Login method for role "${role}"`),
        choices: [
          { title: 'Username', value: 'username' },
          { title: 'Email', value: 'email' },
          { title: 'Phone', value: 'phone' },
        ],
        existing: pickId,
      })) as 'username' | 'email' | 'phone';
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
          `Path halaman login untuk ${role} (Enter = ${defaultLogin}). Path, ?query, URL penuh, #/route tetap utuh.`,
          `Login page path for ${role} (Enter = ${defaultLogin}). Path, ?query, full URL, #/route stay as pasted.`,
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

    if (step === 5) {
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
      step = 6;
      continue;
    }

    // step === 6: company/tenant code
    // ponytail: selector override stays a manual env key; add a prompt when QA hits a non-matching field name more than once.
    const companyValue = await promptTextWithBack({
      lang,
      message: t(
        lang,
        `Kode company/tenant untuk ${role} (opsional, Enter = kosong)`,
        `Company/tenant code for ${role} (optional, Enter = blank)`,
      ),
      initial: existing?.company ?? '',
    });
    if (companyValue === BACK) {
      step = 5;
      continue;
    }
    const company = normalizeCompanyCode(companyValue);

    const fields: RoleFields = {
      password,
      loginUrlPath: loginPath,
      successUrlPath: successPath,
    };
    fields[id] = identValue;
    fields.loginIdPref = id;
    if (company) fields.company = company;
    return fields;
  }
}

/**
 * Prompt for which roles to configure.
 * Accepts user-specified roles (e.g. "admin,guru,murid" or "user").
 * Defaults to 'user' when nothing is specified.
 */
export async function promptRoles(
  lang: WizardLang,
  existingRoles?: string[],
  allowPrev = false,
): Promise<string[] | typeof PREV> {
  const defaultRoles = existingRoles && existingRoles.length > 0 ? existingRoles.join(',') : 'user';
  const input = abortIfCancelled(
    await clackText({
      message:
        t(
          lang,
          'Roles yang dikonfigurasi (pisahkan koma, mis. "admin,guru,murid" atau "user")',
          'Roles to configure (comma-separated, e.g. "admin,guru,murid" or "user")',
        ) +
        (allowPrev
          ? ` — ${t(lang, 'atau ketik "<" untuk kembali', 'or type "<" to go back')}`
          : ''),
      placeholder: 'user',
      // initialValue (NOT defaultValue): the roles already configured in the
      // active env are pre-filled and visible so QA can edit them in place.
      initialValue: defaultRoles,
      validate: (v) => {
        if (allowPrev && PREV_INPUTS.has((v ?? '').trim().toLowerCase())) return undefined;
        return validateRoleList(v);
      },
    }),
  );

  const raw = String(input ?? '').trim();
  if (allowPrev && PREV_INPUTS.has(raw.toLowerCase())) return PREV;
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

export interface ChallengeChoice {
  title: string;
  value: ChallengeMode;
  description: string;
}

/**
 * Every mode states its real cost. `auto` used to be labelled "(disarankan)"
 * while it silently forces HEADLESS=false and stretches the post-login redirect
 * wait to AUTH_CHALLENGE_TIMEOUT_MS (default 3 minutes) — for an app without
 * OTP/CAPTCHA, `none` is the correct answer, so `none` is first.
 */
const CHALLENGE_DESCRIPTIONS: Record<ChallengeMode, { id: string; en: string }> = {
  none: {
    id: 'tanpa OTP/CAPTCHA — paling cepat, HEADLESS=true (disarankan)',
    en: 'no OTP/CAPTCHA — fastest, HEADLESS=true (recommended)',
  },
  auto: {
    id: 'deteksi otomatis; HEADLESS=false & tunggu redirect s/d AUTH_CHALLENGE_TIMEOUT_MS (default 3 menit)',
    en: 'auto-detect; HEADLESS=false & redirect wait up to AUTH_CHALLENGE_TIMEOUT_MS (default 3 minutes)',
  },
  'otp-browser': {
    id: 'OTP diisi manual di browser; HEADLESS=false',
    en: 'OTP entered manually in the browser; HEADLESS=false',
  },
  'otp-stdin': {
    id: 'OTP diketik di terminal; HEADLESS=true',
    en: 'OTP typed in the terminal; HEADLESS=true',
  },
  'captcha-browser': {
    id: 'CAPTCHA diselesaikan di browser; HEADLESS=false',
    en: 'CAPTCHA solved in the browser; HEADLESS=false',
  },
};

/** Ordered challenge-mode choices — `none` first because it is the recommended default. */
export function challengeModeChoices(lang: WizardLang): ChallengeChoice[] {
  const order: ChallengeMode[] = ['none', 'auto', 'otp-browser', 'otp-stdin', 'captcha-browser'];
  return order.map((m) => ({
    title: m,
    value: m,
    description: t(lang, CHALLENGE_DESCRIPTIONS[m].id, CHALLENGE_DESCRIPTIONS[m].en),
  }));
}

export function normalizeCompanyCode(raw: string): string | undefined {
  const company = raw.trim();
  return company.length > 0 ? company : undefined;
}

/**
 * Prompt for AUTH_CHALLENGE_MODE. `allowPrev` lets QA go back to the Roles stage.
 */
export async function promptChallengeMode(
  lang: WizardLang,
  existing?: string,
  allowPrev = false,
): Promise<ChallengeMode | typeof PREV> {
  return promptChoice<ChallengeMode>({
    lang,
    message: t(lang, 'Mode challenge autentikasi', 'Auth challenge mode'),
    existing: existing ?? 'none',
    choices: challengeModeChoices(lang),
    allowPrev,
  });
}

/**
 * Prompt to confirm overwriting an existing env file.
 */
export async function confirmOverwrite(lang: WizardLang, envFilePath: string): Promise<boolean> {
  const overwrite = abortIfCancelled(
    await clackConfirm({
      message: t(
        lang,
        `File env sudah ada: ${envFilePath}\n  Update?`,
        `Env file already exists: ${envFilePath}\n  Update it?`,
      ),
      initialValue: true,
    }),
  );
  return overwrite;
}
