/**
 * AUTO-SYNCED from src/shared/utils/role-credentials.ts — do not edit by hand.
 * Run: npm run sync:mcp-generated  (also runs inside npm run mcp:build)
 */

/**
 * Uniform role credential schema + login identifier resolution.
 *
 * Sole product rules:
 * - Every role: PASSWORD + ≥1 of EMAIL | USERNAME | PHONE
 * - Optional LOGIN_ID_PREF: email | username | phone
 * - Default resolve order: pref → email → username → phone
 * - Role `user` uses TEST_USER_* prefix; public name is never `default` / `general`
 *
 * @module src/shared/utils/role-credentials
 */

export type LoginIdKind = 'email' | 'username' | 'phone';

export interface RoleCredentialRef {
  /** Public role id (kebab). Always `user` for default account — never `default`/`general`. */
  name: string;
  authFile: string;
  emailKey: string;
  usernameKey: string;
  phoneKey: string;
  passwordKey: string;
  loginIdPrefKey: string;
  /** Key for role-specific login page path (e.g. ADMIN_LOGIN_URL_PATH). */
  loginUrlPathKey: string;
  /** Key for role-specific post-login redirect path (e.g. ADMIN_SUCCESS_URL_PATH). */
  successUrlPathKey: string;
}

export interface ResolvedLoginId {
  kind: LoginIdKind;
  value: string;
  source: 'pref' | 'email' | 'username' | 'phone';
  warned?: string;
}

export type ResolveLoginIdResult = ResolvedLoginId | { error: string };

export interface WizardRoleInput {
  name: string;
  /** Plain field bag: email?, username?, phone?, password, loginIdPref?, loginUrlPath?, successUrlPath? */
  fields: {
    email?: string;
    username?: string;
    phone?: string;
    password: string;
    loginIdPref?: string;
    loginUrlPath?: string;
    successUrlPath?: string;
  };
}

export interface NormalizeWizardRolesResult {
  roles: Array<{ name: string; authFile: string }>;
  envUpserts: Record<string, string>;
  warnings: string[];
  collapsedToSingle: boolean;
}

/** Map legacy / forbidden names to public role id. */
export function canonicalRoleName(name: string): string {
  const n = name.trim().toLowerCase();
  if (n === 'default' || n === 'general') return 'user';
  return n;
}

/** Role name: lowercase letters, digits, hyphens. Reject empty. */
export function isValidRoleName(name: string): boolean {
  const n = name.trim().toLowerCase();
  if (n === 'general') return false; // pipeline mode only
  return /^[a-z0-9-]+$/.test(n);
}

/**
 * Map role name to env key prefix.
 * user|default → TEST_USER; super-admin → SUPER_ADMIN
 */
export function roleToEnvPrefix(roleName: string): string {
  const n = canonicalRoleName(roleName);
  if (n === 'user') return 'TEST_USER';
  return n.toUpperCase().replace(/-/g, '_');
}

/** Map env prefix back to role name. TEST_USER → user */
export function envPrefixToRole(prefix: string): string {
  const p = prefix.trim().toUpperCase();
  if (p === 'TEST_USER') return 'user';
  return p.toLowerCase().replace(/_/g, '-');
}

/** Auth storage path scoped by APP_ENV. */
export function roleAuthFile(roleName: string, appEnv?: string): string {
  const role = canonicalRoleName(roleName);
  const env = (appEnv ?? process.env.APP_ENV ?? 'local').trim() || 'local';
  return `.auth/${env}/${role}.json`;
}

/** Build uniform credential key refs for any role. */
export function roleCredentialKeys(roleName: string, appEnv?: string): RoleCredentialRef {
  const name = canonicalRoleName(roleName);
  const prefix = roleToEnvPrefix(name);
  return {
    name,
    authFile: roleAuthFile(name, appEnv),
    emailKey: `${prefix}_EMAIL`,
    usernameKey: `${prefix}_USERNAME`,
    phoneKey: `${prefix}_PHONE`,
    passwordKey: `${prefix}_PASSWORD`,
    loginIdPrefKey: `${prefix}_LOGIN_ID_PREF`,
    loginUrlPathKey: `${prefix}_LOGIN_URL_PATH`,
    successUrlPathKey: `${prefix}_SUCCESS_URL_PATH`,
  };
}

function nonEmpty(map: Record<string, string>, key: string): string {
  return (map[key] ?? '').trim();
}

/**
 * Values that look like template/example credentials — never treat as login-ready.
 * Keep in sync with docs templates (your_password_here, test@example.com, …).
 */
const PLACEHOLDER_CREDENTIAL_VALUES = new Set([
  '',
  'changeme',
  'change-me',
  'your_email',
  'your_password',
  'your_password_here',
  'test@example.com',
  'qa@example.com',
  'invalid-password-placeholder',
]);

/** True when a credential field is empty or still a template placeholder. */
export function isPlaceholderCredential(value: string | undefined | null): boolean {
  if (value === undefined || value === null) return true;
  const v = value.trim();
  if (!v) return true;
  if (PLACEHOLDER_CREDENTIAL_VALUES.has(v.toLowerCase())) return true;
  // Common template patterns from *.env.example
  if (/^your[_-]?/i.test(v)) return true;
  if (/placeholder/i.test(v)) return true;
  return false;
}

/**
 * True when BASE_URL is missing or still the kit dummy host
 * (e.g. https://staging.your-app.example.com/).
 */
export function isPlaceholderBaseUrl(value: string | undefined | null): boolean {
  if (value === undefined || value === null) return true;
  const u = value.trim().toLowerCase();
  if (!u) return true;
  return u.includes('your-app.example.com') || u.includes('your-app.example.');
}

export function isRoleLoginReady(map: Record<string, string>, role: RoleCredentialRef): boolean {
  const password = nonEmpty(map, role.passwordKey);
  if (isPlaceholderCredential(password)) return false;
  const email = nonEmpty(map, role.emailKey);
  const username = nonEmpty(map, role.usernameKey);
  const phone = nonEmpty(map, role.phoneKey);
  const id =
    (!isPlaceholderCredential(email) && email) ||
    (!isPlaceholderCredential(username) && username) ||
    (!isPlaceholderCredential(phone) && phone);
  return Boolean(id);
}

/**
 * Resolve which identifier to type into a single login field.
 * PREF wins when that field is non-empty; else username → email → phone.
 */
export function resolveLoginIdentifier(
  map: Record<string, string>,
  role: RoleCredentialRef,
): ResolveLoginIdResult {
  const email = nonEmpty(map, role.emailKey);
  const username = nonEmpty(map, role.usernameKey);
  const phone = nonEmpty(map, role.phoneKey);
  const password = nonEmpty(map, role.passwordKey);
  const prefRaw = nonEmpty(map, role.loginIdPrefKey).toLowerCase();

  if (!password) {
    return { error: `Missing ${role.passwordKey}` };
  }
  if (!email && !username && !phone) {
    return {
      error: `Role "${role.name}" needs at least one of USERNAME / EMAIL / PHONE`,
    };
  }

  const pick = (
    kind: LoginIdKind,
    value: string,
    source: ResolvedLoginId['source'],
    warned?: string,
  ): ResolvedLoginId => ({ kind, value, source, warned });

  if (prefRaw === 'username' || prefRaw === 'email' || prefRaw === 'phone') {
    const v = prefRaw === 'username' ? username : prefRaw === 'email' ? email : phone;
    if (v) return pick(prefRaw, v, 'pref');
    // fall through
    const warned = `${role.loginIdPrefKey}=${prefRaw} but field empty — using default order`;
    if (username) return pick('username', username, 'username', warned);
    if (email) return pick('email', email, 'email', warned);
    return pick('phone', phone, 'phone', warned);
  }

  if (username) return pick('username', username, 'username');
  if (email) return pick('email', email, 'email');
  return pick('phone', phone, 'phone');
}

/** Build env key upserts from role field bag. */
export function roleFieldsToEnvUpserts(
  roleName: string,
  fields: WizardRoleInput['fields'],
): Record<string, string> {
  const ref = roleCredentialKeys(roleName);
  const out: Record<string, string> = {
    [ref.passwordKey]: fields.password,
  };
  if (fields.email?.trim()) out[ref.emailKey] = fields.email.trim();
  if (fields.username?.trim()) out[ref.usernameKey] = fields.username.trim();
  if (fields.phone?.trim()) out[ref.phoneKey] = fields.phone.trim();
  const pref = (fields.loginIdPref ?? '').trim().toLowerCase();
  if (pref && pref !== 'auto' && (pref === 'email' || pref === 'username' || pref === 'phone')) {
    out[ref.loginIdPrefKey] = pref;
  }
  if (fields.loginUrlPath?.trim()) {
    out[ref.loginUrlPathKey] = fields.loginUrlPath.trim();
  }
  if (fields.successUrlPath?.trim()) {
    out[ref.successUrlPathKey] = fields.successUrlPath.trim();
  }
  return out;
}

/**
 * Normalize wizard multi/single role list.
 * - canonical names
 * - multi N=1 user → collapse single
 * - multi N=1 other + mirrorToUser → TEST_USER_* + role keys
 */
export function normalizeWizardRoles(
  input: WizardRoleInput[],
  opts: { mirrorToUser?: boolean; mirrorFromRole?: string; appEnv?: string } = {},
): NormalizeWizardRolesResult {
  const warnings: string[] = [];
  const envUpserts: Record<string, string> = {};
  const appEnv = opts.appEnv;

  const normalized = input.map((r) => ({
    name: canonicalRoleName(r.name),
    fields: r.fields,
  }));

  if (normalized.length === 0) {
    return { roles: [], envUpserts: {}, warnings: ['No roles provided'], collapsedToSingle: true };
  }

  if (normalized.length === 1) {
    const only = normalized[0];
    if (only.name === 'user') {
      Object.assign(envUpserts, roleFieldsToEnvUpserts('user', only.fields));
      return {
        roles: [{ name: 'user', authFile: roleAuthFile('user', appEnv) }],
        envUpserts,
        warnings,
        collapsedToSingle: true,
      };
    }

    // Named role only
    Object.assign(envUpserts, roleFieldsToEnvUpserts(only.name, only.fields));
    const roles: Array<{ name: string; authFile: string }> = [
      { name: only.name, authFile: roleAuthFile(only.name, appEnv) },
    ];

    if (opts.mirrorToUser !== false) {
      // default true for safety when caller sets mirrorToUser: true; if undefined treat as false for pure fn
      if (opts.mirrorToUser === true) {
        Object.assign(envUpserts, roleFieldsToEnvUpserts('user', only.fields));
        roles.unshift({ name: 'user', authFile: roleAuthFile('user', appEnv) });
      } else {
        warnings.push(
          `No default role "user" — pipeline mode general (authenticated) will fail auth setup until TEST_USER_* is set`,
        );
      }
    } else {
      warnings.push(
        `No default role "user" — pipeline mode general (authenticated) will fail auth setup until TEST_USER_* is set`,
      );
    }

    return { roles, envUpserts, warnings, collapsedToSingle: false };
  }

  // N >= 2
  for (const r of normalized) {
    Object.assign(envUpserts, roleFieldsToEnvUpserts(r.name, r.fields));
  }
  let roles = normalized.map((r) => ({
    name: r.name,
    authFile: roleAuthFile(r.name, appEnv),
  }));

  const hasUser = roles.some((r) => r.name === 'user');
  if (!hasUser) {
    if (opts.mirrorToUser && opts.mirrorFromRole) {
      const src = normalized.find((r) => r.name === canonicalRoleName(opts.mirrorFromRole!));
      if (src) {
        Object.assign(envUpserts, roleFieldsToEnvUpserts('user', src.fields));
        roles = [{ name: 'user', authFile: roleAuthFile('user', appEnv) }, ...roles];
      } else {
        warnings.push(`mirrorFromRole "${opts.mirrorFromRole}" not found`);
      }
    } else {
      warnings.push(
        'Multi-role without "user" — add default user or mirror a role for pipeline mode general',
      );
    }
  }

  // de-dupe role names keeping first
  const seen = new Set<string>();
  roles = roles.filter((r) => {
    if (seen.has(r.name)) return false;
    seen.add(r.name);
    return true;
  });

  return { roles, envUpserts, warnings, collapsedToSingle: false };
}

/**
 * Discover roles from a flat env map.
 * A role is present if password set OR any identity key set for that prefix.
 */
export function parseRolesFromEnvMap(map: Record<string, string>): RoleCredentialRef[] {
  const roles: RoleCredentialRef[] = [];
  const seen = new Set<string>();

  const consider = (roleName: string) => {
    const name = canonicalRoleName(roleName);
    if (seen.has(name)) return;
    const ref = roleCredentialKeys(name);
    const hasAny =
      nonEmpty(map, ref.passwordKey) ||
      nonEmpty(map, ref.emailKey) ||
      nonEmpty(map, ref.usernameKey) ||
      nonEmpty(map, ref.phoneKey);
    if (!hasAny) return;
    roles.push(ref);
    seen.add(name);
  };

  // Always check user via TEST_USER_*
  consider('user');

  for (const key of Object.keys(map)) {
    const m =
      /^([A-Z0-9_]+)_(EMAIL|USERNAME|PHONE|PASSWORD|LOGIN_ID_PREF|LOGIN_URL_PATH|SUCCESS_URL_PATH)$/.exec(
        key,
      );
    if (!m) continue;
    const prefix = m[1];
    if (prefix === 'TEST_USER' || prefix === 'DOTENV_PUBLIC_KEY' || prefix === 'DOTENV') continue;
    if (prefix.endsWith('_LOGIN_ID')) continue;
    consider(envPrefixToRole(prefix));
  }

  return roles.sort((a, b) => a.name.localeCompare(b.name));
}

/** Whether default user credentials exist (for general pipeline). */
export function hasDefaultUserCredentials(map: Record<string, string>): boolean {
  return isRoleLoginReady(map, roleCredentialKeys('user'));
}
