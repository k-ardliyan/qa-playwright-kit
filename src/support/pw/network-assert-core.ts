/**
 * Pure network-assert helpers (no Playwright).
 *
 * Matching is **scenario-driven**: callers pass method/url/status/keys from the
 * requirement. This module does not patent business domain fields.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { workspace } from '../../shared/workspace-paths';

export interface NetworkHit {
  method: string;
  url: string;
  status: number;
  requestHeaders?: Record<string, string>;
  responseHeaders?: Record<string, string>;
  requestBody?: unknown;
  responseBody?: unknown;
  timingMs?: number;
}

export interface NetworkBodyMatch {
  requiredKeys?: string[];
  matchObject?: Record<string, unknown>;
  forbidKeys?: string[];
}

export interface NetworkMatchSpec {
  method?: string | string[];
  urlIncludes?: string;
  urlRegex?: string;
  status?: number | number[];
  request?: NetworkBodyMatch;
  response?: NetworkBodyMatch;
}

export interface NetworkContractFile {
  id: string;
  match: {
    method?: string | string[];
    urlIncludes?: string;
    urlRegex?: string;
    status?: number | number[];
  };
  request?: NetworkBodyMatch;
  response?: NetworkBodyMatch;
  redact?: {
    headers?: string[];
    bodyPaths?: string[];
  };
}

export const DEFAULT_REDACT_HEADERS = [
  'authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
] as const;

export const DEFAULT_REDACT_BODY_PATHS = [
  'token',
  'accessToken',
  'refreshToken',
  'password',
  'secret',
] as const;

const REDACTED = '[REDACTED]';

export function redactHeaders(
  headers: Record<string, string> | undefined,
  keys: readonly string[] = DEFAULT_REDACT_HEADERS,
): Record<string, string> | undefined {
  if (!headers) return headers;
  const lower = new Set(keys.map((k) => k.toLowerCase()));
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    out[k] = lower.has(k.toLowerCase()) ? REDACTED : v;
  }
  return out;
}

function setPathRedacted(root: unknown, dotted: string): unknown {
  if (root === null || root === undefined || typeof root !== 'object') return root;
  const parts = dotted.split('.').filter(Boolean);
  if (parts.length === 0) return root;

  const clone: unknown = Array.isArray(root)
    ? [...(root as unknown[])]
    : { ...(root as Record<string, unknown>) };

  let cursor: unknown = clone;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const key = parts[i];
    if (cursor === null || typeof cursor !== 'object') return clone;
    const record = cursor as Record<string, unknown>;
    const next = record[key];
    if (next === null || next === undefined || typeof next !== 'object') {
      return clone;
    }
    const nextClone = Array.isArray(next) ? [...next] : { ...(next as Record<string, unknown>) };
    record[key] = nextClone;
    cursor = nextClone;
  }

  if (cursor !== null && typeof cursor === 'object' && !Array.isArray(cursor)) {
    const leaf = parts[parts.length - 1];
    if (leaf in (cursor as Record<string, unknown>)) {
      (cursor as Record<string, unknown>)[leaf] = REDACTED;
    }
  }
  return clone;
}

function redactTopLevelSensitive(body: unknown, leafNames: readonly string[]): unknown {
  if (body === null || body === undefined || typeof body !== 'object') return body;
  if (Array.isArray(body)) {
    return body.map((item) => redactTopLevelSensitive(item, leafNames));
  }
  const out: Record<string, unknown> = { ...(body as Record<string, unknown>) };
  const lowerLeaves = new Set(leafNames.map((n) => n.toLowerCase()));
  for (const key of Object.keys(out)) {
    if (lowerLeaves.has(key.toLowerCase())) {
      out[key] = REDACTED;
    } else if (out[key] !== null && typeof out[key] === 'object') {
      out[key] = redactTopLevelSensitive(out[key], leafNames);
    }
  }
  return out;
}

export function redactBody(
  body: unknown,
  paths: readonly string[] = DEFAULT_REDACT_BODY_PATHS,
): unknown {
  if (body === null || body === undefined) return body;
  // First redact by leaf name recursively, then apply explicit dotted paths.
  let next = redactTopLevelSensitive(body, paths);
  for (const p of paths) {
    if (p.includes('.')) {
      next = setPathRedacted(next, p);
    }
  }
  return next;
}

export function redactHit(hit: NetworkHit, contract?: NetworkContractFile): NetworkHit {
  const headerKeys = contract?.redact?.headers ?? DEFAULT_REDACT_HEADERS;
  const bodyPaths = contract?.redact?.bodyPaths ?? DEFAULT_REDACT_BODY_PATHS;
  return {
    ...hit,
    requestHeaders: redactHeaders(hit.requestHeaders, headerKeys),
    responseHeaders: redactHeaders(hit.responseHeaders, headerKeys),
    requestBody: redactBody(hit.requestBody, bodyPaths),
    responseBody: redactBody(hit.responseBody, bodyPaths),
  };
}

export function hasRequiredKeys(obj: unknown, keys: string[]): string[] {
  if (obj === null || obj === undefined || typeof obj !== 'object' || Array.isArray(obj)) {
    return [...keys];
  }
  const record = obj as Record<string, unknown>;
  return keys.filter((k) => !(k in record));
}

export function objectContainsMatch(
  actual: unknown,
  expected: Record<string, unknown>,
  pathPrefix = '',
): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  if (
    actual === null ||
    actual === undefined ||
    typeof actual !== 'object' ||
    Array.isArray(actual)
  ) {
    errors.push(`${pathPrefix || '(root)'}: expected object, got ${describeType(actual)}`);
    return { ok: false, errors };
  }
  const record = actual as Record<string, unknown>;
  for (const [key, expVal] of Object.entries(expected)) {
    const p = pathPrefix ? `${pathPrefix}.${key}` : key;
    if (!(key in record)) {
      errors.push(`${p}: missing key`);
      continue;
    }
    const actVal = record[key];
    if (
      expVal !== null &&
      typeof expVal === 'object' &&
      !Array.isArray(expVal) &&
      actVal !== null &&
      typeof actVal === 'object' &&
      !Array.isArray(actVal)
    ) {
      const nested = objectContainsMatch(actVal, expVal as Record<string, unknown>, p);
      errors.push(...nested.errors);
      continue;
    }
    if (!Object.is(actVal, expVal) && JSON.stringify(actVal) !== JSON.stringify(expVal)) {
      errors.push(`${p}: expected ${JSON.stringify(expVal)}, got ${JSON.stringify(actVal)}`);
    }
  }
  return { ok: errors.length === 0, errors };
}

function describeType(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}

function methodsMatch(actual: string, expected?: string | string[]): boolean {
  if (!expected) return true;
  const list = Array.isArray(expected) ? expected : [expected];
  return list.map((m) => m.toUpperCase()).includes(actual.toUpperCase());
}

function statusMatch(actual: number, expected?: number | number[]): boolean {
  if (expected === undefined) return true;
  const list = Array.isArray(expected) ? expected : [expected];
  return list.includes(actual);
}

function matchBodySide(
  label: 'request' | 'response',
  body: unknown,
  spec?: NetworkBodyMatch,
): string[] {
  if (!spec) return [];
  const errors: string[] = [];
  if (spec.requiredKeys?.length) {
    const missing = hasRequiredKeys(body, spec.requiredKeys);
    for (const k of missing) {
      errors.push(`${label}: missing required key "${k}"`);
    }
  }
  if (spec.forbidKeys?.length && body && typeof body === 'object' && !Array.isArray(body)) {
    const record = body as Record<string, unknown>;
    for (const k of spec.forbidKeys) {
      if (k in record) {
        errors.push(`${label}: forbidden key "${k}" is present`);
      }
    }
  }
  if (spec.matchObject) {
    const nested = objectContainsMatch(body, spec.matchObject, label);
    errors.push(...nested.errors);
  }
  return errors;
}

export function matchNetworkHit(
  hit: NetworkHit,
  spec: NetworkMatchSpec,
): { ok: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!methodsMatch(hit.method, spec.method)) {
    errors.push(`method: expected ${JSON.stringify(spec.method)}, got ${hit.method}`);
  }
  if (spec.urlIncludes && !hit.url.includes(spec.urlIncludes)) {
    errors.push(`url: expected to include "${spec.urlIncludes}", got ${hit.url}`);
  }
  if (spec.urlRegex) {
    const re = new RegExp(spec.urlRegex);
    if (!re.test(hit.url)) {
      errors.push(`url: expected to match /${spec.urlRegex}/, got ${hit.url}`);
    }
  }
  if (!statusMatch(hit.status, spec.status)) {
    errors.push(`status: expected ${JSON.stringify(spec.status)}, got ${hit.status}`);
  }

  errors.push(...matchBodySide('request', hit.requestBody, spec.request));
  errors.push(...matchBodySide('response', hit.responseBody, spec.response));

  return { ok: errors.length === 0, errors };
}

/**
 * Resolve a contract path inside the configured workspace test-data root.
 * Absolute paths and traversal are rejected; callers can still pass either
 * `tests/data/network/...` or the convenient `network/...` form.
 */
export function resolveNetworkContractPath(relativePath: string): string {
  const raw = relativePath.trim();
  if (!raw) throw new Error('Network contract path must be a non-empty string');
  if (path.isAbsolute(raw)) {
    throw new Error('Network contract path must be relative to the workspace test-data directory');
  }
  const normalized = raw.replace(/\\/g, '/');
  const relative =
    normalized === workspace.testDataRel
      ? ''
      : normalized.startsWith(`${workspace.testDataRel}/`)
        ? normalized.slice(workspace.testDataRel.length + 1)
        : normalized.startsWith('network/')
          ? normalized
          : normalized;
  const root = path.resolve(workspace.testDataDir);
  const resolved = path.resolve(root, relative);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error('Network contract path must stay inside the workspace test-data directory');
  }
  return resolved;
}

export function loadNetworkContract(relativeOrAbsolute: string): NetworkContractFile {
  const p = resolveNetworkContractPath(relativeOrAbsolute);
  if (!fs.existsSync(p)) {
    throw new Error(`Network contract not found: ${p}`);
  }
  const raw = fs.readFileSync(p, 'utf-8');
  const parsed = JSON.parse(raw) as NetworkContractFile;
  if (!parsed?.id || !parsed?.match) {
    throw new Error(`Invalid network contract (need id + match): ${p}`);
  }
  return parsed;
}

export function assertNetworkContractHit(
  hit: NetworkHit,
  contract: NetworkContractFile | string,
  overlays?: Partial<NetworkMatchSpec>,
): void {
  const c = typeof contract === 'string' ? loadNetworkContract(contract) : contract;
  const redacted = redactHit(hit, c);
  const spec: NetworkMatchSpec = {
    method: overlays?.method ?? c.match.method,
    urlIncludes: overlays?.urlIncludes ?? c.match.urlIncludes,
    urlRegex: overlays?.urlRegex ?? c.match.urlRegex,
    status: overlays?.status ?? c.match.status,
    request: {
      ...c.request,
      ...overlays?.request,
      requiredKeys: overlays?.request?.requiredKeys ?? c.request?.requiredKeys,
      matchObject: {
        ...(c.request?.matchObject ?? {}),
        ...(overlays?.request?.matchObject ?? {}),
      },
      forbidKeys: overlays?.request?.forbidKeys ?? c.request?.forbidKeys,
    },
    response: {
      ...c.response,
      ...overlays?.response,
      requiredKeys: overlays?.response?.requiredKeys ?? c.response?.requiredKeys,
      matchObject: {
        ...(c.response?.matchObject ?? {}),
        ...(overlays?.response?.matchObject ?? {}),
      },
      forbidKeys: overlays?.response?.forbidKeys ?? c.response?.forbidKeys,
    },
  };

  // Drop empty matchObject if both empty
  if (spec.request && Object.keys(spec.request.matchObject ?? {}).length === 0) {
    delete spec.request.matchObject;
  }
  if (spec.response && Object.keys(spec.response.matchObject ?? {}).length === 0) {
    delete spec.response.matchObject;
  }

  const result = matchNetworkHit(redacted, spec);
  if (!result.ok) {
    throw new Error(`Network contract failed (${c.id}):\n- ${result.errors.join('\n- ')}`);
  }
}
