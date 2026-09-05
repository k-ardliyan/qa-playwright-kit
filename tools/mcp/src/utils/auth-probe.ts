/**
 * AUTO-SYNCED from src/shared/mcp/auth-probe.ts — do not edit by hand.
 * Run: npm run sync:mcp-generated  (also runs inside npm run mcp:build)
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

export interface AuthStateProbeResult {
  valid: boolean;
  status: 'valid' | 'expired' | 'missing' | 'malformed';
  reason?: string;
  cookiesCount: number;
  expiredCookiesCount: number;
  originsCount: number;
}

interface StorageStatePayload {
  cookies?: Array<{
    name: string;
    expires?: number;
    value?: string;
  }>;
  origins?: Array<{
    origin: string;
    localStorage?: Array<{ name: string; value: string }>;
  }>;
}

// ─── Client-token TTL evidence (auto-discovery, zero app-specific config) ─────
//
// Many SPA apps keep sessions ONLY in localStorage (no cookie TTL), never
// redirect on expiry, and swallow 401s. The session file itself carries the
// expiry evidence: JWT `exp` claims (RFC 7519) and common expiry-record shapes
// ({loginTime, expiresIn}, {exp|expiresAt|expiry|expires}). Scanning it lets
// the framework prove session death statically — no per-app env keys.

const JWT_PATTERN = /^[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]*$/;
const TOKENISH_KEY = /token|auth|session|login|jwt|exp|sess/i;
const MAX_SCAN_VALUE_LENGTH = 64 * 1024;

/** Decode a base64url JWT payload `exp` claim → epoch ms. Null when not a JWT / no exp. */
export function decodeJwtExpiryMs(raw: string): number | null {
  const value = raw.trim();
  if (value.length < 32 || value.length > 8192 || !JWT_PATTERN.test(value)) return null;
  try {
    const payload = JSON.parse(Buffer.from(value.split('.')[1], 'base64url').toString('utf8')) as {
      exp?: unknown;
    };
    if (typeof payload.exp !== 'number' || payload.exp <= 0) return null;
    // JWT spec: exp in epoch SECONDS; tolerate epoch-ms values defensively.
    return payload.exp > 1e11 ? payload.exp : payload.exp * 1000;
  } catch {
    return null;
  }
}

/** Recognize common client expiry-record shapes in a JSON string → epoch ms. */
export function decodeExpiryRecordMs(raw: string): number | null {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    // Shape: { loginTime: epochMs, expiresIn: seconds|ms } (e.g. redux auth state)
    const loginTime = parsed.loginTime;
    const expiresIn = parsed.expiresIn;
    if (typeof loginTime === 'number' && typeof expiresIn === 'number') {
      return loginTime + (expiresIn > 1e7 ? expiresIn : expiresIn * 1000);
    }
    // Shape: single time field under a conventional name
    for (const key of ['exp', 'expiresAt', 'expiry', 'expires']) {
      const value = parsed[key];
      if (typeof value === 'number' && value > 1e9) {
        return value > 1e11 ? value : value * 1000;
      }
      if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) {
        const parsedDate = Date.parse(value);
        if (!Number.isNaN(parsedDate)) return parsedDate;
      }
    }
    return null;
  } catch {
    return null;
  }
}

/** JWTs nested one level inside JSON blobs (e.g. redux-persisted auth state). */
function decodeNestedJwtExpiryMs(raw: string): number | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return null;
    const stack: unknown[] = [parsed];
    for (let depth = 0; depth < 2 && stack.length > 0; depth++) {
      const current = stack.pop();
      if (typeof current === 'string') {
        const exp = decodeJwtExpiryMs(current);
        if (exp !== null) return exp;
      } else if (current && typeof current === 'object') {
        stack.push(...Object.values(current as Record<string, unknown>));
      }
    }
    return null;
  } catch {
    return null;
  }
}

export interface AuthStateExpiryScan {
  /** Expiry evidence items found (JWTs / expiry records). */
  evidence: number;
  /** How many of them are expired at scan time. */
  expired: number;
}

/** Scan cookies + localStorage of a storage state for TTL evidence. */
export function scanAuthStateExpiry(state: StorageStatePayload): AuthStateExpiryScan {
  let evidence = 0;
  let expired = 0;
  const note = (expiryMs: number | null): void => {
    if (expiryMs === null) return;
    evidence++;
    if (Date.now() >= expiryMs) expired++;
  };

  for (const cookie of state.cookies ?? []) {
    if (typeof cookie.value === 'string') note(decodeJwtExpiryMs(cookie.value));
  }
  for (const origin of state.origins ?? []) {
    for (const entry of origin.localStorage ?? []) {
      const value = entry.value;
      if (typeof value !== 'string' || value.length === 0 || value.length > MAX_SCAN_VALUE_LENGTH) {
        continue;
      }
      if (JWT_PATTERN.test(value.trim())) {
        note(decodeJwtExpiryMs(value));
      } else if (TOKENISH_KEY.test(entry.name)) {
        note(decodeExpiryRecordMs(value));
        if (decodeExpiryRecordMs(value) === null) note(decodeNestedJwtExpiryMs(value));
      }
    }
  }
  return { evidence, expired };
}

/**
 * Conservative verdict from client-token evidence:
 * - true  → ALL evidence proves expiry → session dead.
 * - false → at least one evidence alive → benefit of the doubt (other layers
 *           will catch real 401s/redirects at runtime).
 * - null  → no evidence found → other layers decide.
 */
export function authStateExpiryVerdict(state: StorageStatePayload): boolean | null {
  const { evidence, expired } = scanAuthStateExpiry(state);
  if (evidence === 0) return null;
  return expired === evidence;
}

/** Read a session file from disk and return its expiry verdict (null if unreadable). */
export function authStateFileExpiryVerdict(filePath: string): boolean | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as StorageStatePayload;
    return authStateExpiryVerdict(parsed);
  } catch {
    return null;
  }
}

/**
 * Probe a storage state JSON file for structural validity and cookie expiration.
 */
export function probeAuthStateFile(filePath: string): AuthStateProbeResult {
  if (!fs.existsSync(filePath)) {
    return {
      valid: false,
      status: 'missing',
      reason: `Auth state file does not exist at ${filePath}`,
      cookiesCount: 0,
      expiredCookiesCount: 0,
      originsCount: 0,
    };
  }

  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(content) as StorageStatePayload;

    if (!parsed || typeof parsed !== 'object') {
      return {
        valid: false,
        status: 'malformed',
        reason: 'Storage state is not a valid JSON object',
        cookiesCount: 0,
        expiredCookiesCount: 0,
        originsCount: 0,
      };
    }

    const cookies = Array.isArray(parsed.cookies) ? parsed.cookies : [];
    const origins = Array.isArray(parsed.origins) ? parsed.origins : [];

    const nowSeconds = Math.floor(Date.now() / 1000);
    let expiredCount = 0;

    for (const cookie of cookies) {
      if (cookie.expires && cookie.expires > 0 && cookie.expires < nowSeconds) {
        expiredCount++;
      }
    }

    if (cookies.length === 0 && origins.length === 0) {
      return {
        valid: false,
        status: 'malformed',
        reason: 'Storage state contains neither cookies nor origin storage',
        cookiesCount: 0,
        expiredCookiesCount: 0,
        originsCount: 0,
      };
    }

    if (expiredCount > 0 && expiredCount === cookies.length) {
      return {
        valid: false,
        status: 'expired',
        reason: `All ${cookies.length} session cookies are expired`,
        cookiesCount: cookies.length,
        expiredCookiesCount: expiredCount,
        originsCount: origins.length,
      };
    }

    // localStorage-backed sessions (no cookie TTL): the file itself carries
    // client-token expiry evidence — scan it before declaring "valid/unknown".
    if (cookies.length === 0) {
      const verdict = authStateExpiryVerdict(parsed);
      if (verdict === true) {
        return {
          valid: false,
          status: 'expired',
          reason: 'Client token evidence in localStorage (JWT exp / expiry record) proves expiry',
          cookiesCount: 0,
          expiredCookiesCount: 0,
          originsCount: origins.length,
        };
      }
    }

    return {
      valid: true,
      status: 'valid',
      cookiesCount: cookies.length,
      expiredCookiesCount: expiredCount,
      originsCount: origins.length,
    };
  } catch (err) {
    return {
      valid: false,
      status: 'malformed',
      reason: `Failed to parse storage state JSON: ${err instanceof Error ? err.message : String(err)}`,
      cookiesCount: 0,
      expiredCookiesCount: 0,
      originsCount: 0,
    };
  }
}

/** Per-role auth readiness for health_check / pipeline_status (static probe only). */
export interface AuthRoleStatus {
  role: string;
  status: AuthStateProbeResult['status'];
  /** Static probe verdict: expired/malformed/missing = not ready; valid = likely ready; unknown = needs live check (auth:verify). */
  ready: boolean | null;
  reason?: string;
}

/**
 * Probe every `{role}.json` in an auth dir. Ready = file exists, structurally
 * valid, and no TTL evidence proves expiry (cookie TTLs or client-token
 * evidence). `ready: null` means nothing decidable on disk — a live check
 * (`auth:verify`) or the runtime guard layers decide.
 */
export function probeAuthRoles(authDir: string): AuthRoleStatus[] {
  if (!fs.existsSync(authDir)) return [];
  return fs
    .readdirSync(authDir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => {
      const role = f.replace(/\.json$/, '');
      const probe = probeAuthStateFile(path.join(authDir, f));
      // ready: true   → cookies present and not expired (cookie-session apps)
      // ready: false  → all cookies expired (needs re-login via auth:setup)
      // ready: null   → nothing decidable on disk: no cookies (localStorage
      //                 session, no TTL) or structurally malformed file
      let ready: boolean | null;
      if (probe.valid && probe.cookiesCount > 0) {
        ready = true;
      } else if (probe.status === 'expired') {
        ready = false;
      } else {
        ready = null;
      }
      return {
        role,
        status: probe.status,
        ready,
        reason: probe.reason,
      };
    });
}
