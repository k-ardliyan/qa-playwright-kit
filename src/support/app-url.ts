/**
 * Application URL resolver — canonical helper for joining paths against BASE_URL.
 *
 * Rule:
 * - Absolute URLs (`http://`, `https://`) are returned as-is.
 * - Relative paths are concatenated to `BASE_URL` (stripped of trailing slash).
 * - Avoids the `new URL('/path', base)` trap which treats leading slashes as
 *   root-absolute, stripping subpaths from base URLs (e.g. `https://host/subpath`).
 *
 * @module src/support/app-url
 */

export function resolveAppUrl(pathOrUrl: string, baseUrlOverride?: string): string {
  if (!pathOrUrl) return pathOrUrl;

  // If already absolute URL, return as-is
  if (/^https?:\/\//i.test(pathOrUrl)) {
    return pathOrUrl;
  }

  const rawBase = (baseUrlOverride ?? process.env.BASE_URL ?? '').trim();
  if (!rawBase) {
    return pathOrUrl;
  }

  const baseTrimmed = rawBase.replace(/\/+$/, '');
  const pathWithLeading = pathOrUrl.startsWith('/') ? pathOrUrl : `/${pathOrUrl}`;

  return `${baseTrimmed}${pathWithLeading}`;
}
