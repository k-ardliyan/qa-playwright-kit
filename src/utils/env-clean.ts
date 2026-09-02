/**
 * Clean env file generator — minimal, sectioned, no placeholder comments.
 *
 * `.env.example` is documentation (rich comments, commented-out optional keys).
 * The derived `{APP_ENV}.env` is data: only keys that are actually set,
 * grouped in sections, with a short provenance header. Comments and
 * commented-out placeholders from the example never leak into it.
 *
 * Pure string builder — no I/O. Shared by the setup wizard writer and the
 * env:edit "tidy" action so both produce the same layout.
 *
 * @module src/utils/env-clean
 */

import { encodeEnvValue } from './env-text';

/**
 * Non-secret defaults a fresh env file starts with (mirror the active keys
 * documented in `*.env.example`). Wizard-managed keys always win over these.
 */
export const ENV_FILE_DEFAULTS: Record<string, string> = {
  SLOW_MO: '0',
  PLAYWRIGHT_CONFIG: 'playwright.config.ts',
};

/** Role credential suffixes, in the order they appear in a role section. */
const ROLE_SUFFIX_ORDER = [
  'EMAIL',
  'USERNAME',
  'PHONE',
  'PASSWORD',
  'LOGIN_ID_PREF',
  'LOGIN_URL_PATH',
  'SUCCESS_URL_PATH',
];

const ROLE_KEY_RE =
  /^([A-Z0-9_]+)_(EMAIL|USERNAME|PHONE|PASSWORD|LOGIN_ID_PREF|LOGIN_URL_PATH|SUCCESS_URL_PATH)$/;

/** Keys shown under "URL Aplikasi". */
const URL_KEYS = ['BASE_URL', 'AUTH_LOGIN_URL_PATH', 'AUTH_SUCCESS_URL_PATH'];

/** Keys shown under "Challenge login (OTP/CAPTCHA)". */
const CHALLENGE_KEYS = [
  'AUTH_CHALLENGE_MODE',
  'AUTH_CHALLENGE_TIMEOUT_MS',
  'AUTH_OTP_INPUT_SELECTOR',
  'AUTH_OTP_SUBMIT_SELECTOR',
];

/** Keys shown under "Browser". */
const BROWSER_KEYS = ['HEADLESS', 'SLOW_MO'];

/** Key prefixes shown under "Playwright". */
const PLAYWRIGHT_PREFIX = 'PLAYWRIGHT_';

/** Role display name from env prefix. TEST_USER → user, SUPER_ADMIN → super-admin. */
function prefixToRoleName(prefix: string): string {
  if (prefix === 'TEST_USER') return 'user';
  return prefix.toLowerCase().replace(/_/g, '-');
}

function sectionHeader(title: string): string {
  return `# ── ${title} ${'─'.repeat(Math.max(2, 52 - title.length))}`;
}

/** Render one section, or null when it has no keys. */
function renderSection(
  title: string,
  keys: string[],
  values: Record<string, string>,
): string | null {
  if (keys.length === 0) return null;
  const lines = [sectionHeader(title)];
  for (const key of keys) lines.push(`${key}=${encodeEnvValue(values[key] ?? '')}`);
  return lines.join('\n');
}

/**
 * Build a clean env file from active key→value pairs.
 *
 * - `DOTENV_PUBLIC_KEY*` lines are kept at the top (dotenvx decryption metadata).
 * - Other `DOTENV_*` keys are dropped — private keys must never be written to
 *   an env file, and `DOTENV_CONFIG_*` is dotenvx runtime noise.
 * - Empty values are omitted (unset is unset).
 * - Unknown keys land in "Lainnya (dipertahankan)" so nothing is silently lost.
 */
export function buildCleanEnvContent(opts: {
  appEnv: string;
  values: Record<string, string>;
}): string {
  const { appEnv, values } = opts;

  const metaKeys = Object.keys(values)
    .filter((k) => k.startsWith('DOTENV_PUBLIC_KEY'))
    .sort();
  const metaBlock =
    metaKeys.length > 0
      ? metaKeys.map((k) => `${k}=${encodeEnvValue(values[k] ?? '')}`).join('\n')
      : null;

  const active: Record<string, string> = {};
  for (const [key, val] of Object.entries(values)) {
    if (key.startsWith('DOTENV_')) continue;
    if (typeof val !== 'string' || val.trim() === '') continue;
    active[key] = val;
  }
  const activeKeys = Object.keys(active);

  // ── Classify keys into sections ──
  const used = new Set<string>();
  const take = (wanted: string[]): string[] => {
    const found = wanted.filter((k) => activeKeys.includes(k) && !used.has(k));
    for (const k of found) used.add(k);
    return found;
  };

  const urlKeys = take(URL_KEYS);
  const browserKeys = take(BROWSER_KEYS);
  const challengeKeys = take(CHALLENGE_KEYS);

  const playwrightKeys = activeKeys
    .filter((k) => k.startsWith(PLAYWRIGHT_PREFIX) && !used.has(k))
    .sort();
  for (const k of playwrightKeys) used.add(k);

  // Role sections: group credential keys by prefix, TEST_USER first.
  const roles = new Map<string, string[]>();
  for (const key of activeKeys) {
    const m = ROLE_KEY_RE.exec(key);
    if (!m || used.has(key)) continue;
    const prefix = m[1];
    if (prefix === 'DOTENV_PUBLIC_KEY') continue;
    used.add(key);
    if (!roles.has(prefix)) roles.set(prefix, []);
    roles.get(prefix)!.push(key);
  }
  const rolePrefixes = [...roles.keys()].sort((a, b) => {
    if (a === 'TEST_USER') return -1;
    if (b === 'TEST_USER') return 1;
    return a.localeCompare(b);
  });
  for (const prefix of rolePrefixes) {
    roles.get(prefix)!.sort((a, b) => {
      const ia = ROLE_SUFFIX_ORDER.indexOf(a.slice(prefix.length + 1));
      const ib = ROLE_SUFFIX_ORDER.indexOf(b.slice(prefix.length + 1));
      return (ia < 0 ? ROLE_SUFFIX_ORDER.length : ia) - (ib < 0 ? ROLE_SUFFIX_ORDER.length : ib);
    });
  }

  const otherKeys = activeKeys.filter((k) => !used.has(k)).sort();

  // ── Render ──
  const blocks: string[] = [];
  if (metaBlock) blocks.push(metaBlock);
  const urlSection = renderSection('URL Aplikasi', urlKeys, active);
  if (urlSection) blocks.push(urlSection);

  for (const prefix of rolePrefixes) {
    const section = renderSection(`Role: ${prefixToRoleName(prefix)}`, roles.get(prefix)!, active);
    if (section) blocks.push(section);
  }

  const browserSection = renderSection('Browser', browserKeys, active);
  if (browserSection) blocks.push(browserSection);
  const challengeSection = renderSection('Challenge login (OTP/CAPTCHA)', challengeKeys, active);
  if (challengeSection) blocks.push(challengeSection);
  const playwrightSection = renderSection('Playwright', playwrightKeys, active);
  if (playwrightSection) blocks.push(playwrightSection);
  const otherSection = renderSection('Lainnya (dipertahankan)', otherKeys, active);
  if (otherSection) blocks.push(otherSection);

  const header = [
    `# ${appEnv}.env — di-generate oleh \`npm run setup\`. Edit via: npm run env:edit`,
    `# Dokumentasi lengkap key: config/environments/${appEnv}.env.example`,
  ].join('\n');

  return [header, ...blocks].join('\n\n') + '\n';
}
