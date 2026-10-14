import type * as http from 'node:http';

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
  'X-Frame-Options': 'DENY',
};

export function dashboardRequestError(req: http.IncomingMessage): string | null {
  const host = req.headers.host;
  if (!host || host.trim() !== host) return 'A valid Host header is required';

  let hostUrl: URL;
  try {
    hostUrl = new URL(`http://${host}`);
  } catch {
    return 'Invalid Host header';
  }
  const hostname = hostUrl.hostname.toLowerCase();
  if (
    hostUrl.username ||
    hostUrl.password ||
    hostUrl.pathname !== '/' ||
    hostUrl.search ||
    hostUrl.hash ||
    hostUrl.port !== String(req.socket.localPort) ||
    !['localhost', '127.0.0.1', '[::1]'].includes(hostname)
  ) {
    return 'Host must match the local dashboard authority';
  }

  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method ?? 'GET')) return null;
  const source = req.headers.origin || req.headers.referer;
  if (!source) return 'Origin or Referer header is required for state-changing requests';
  try {
    const sourceUrl = new URL(source);
    if (sourceUrl.origin !== hostUrl.origin) return 'Cross-origin state-changing request rejected';
  } catch {
    return 'Invalid Origin or Referer header';
  }
  if (req.headers['sec-fetch-site'] === 'cross-site') {
    return 'Cross-site state-changing request rejected';
  }
  return null;
}

import { isIP } from 'node:net';

export function sameOriginRequestError(
  req: http.IncomingMessage,
  localPort: number,
): string | null {
  const hostHeader = req.headers.host;
  if (!hostHeader) return 'Host header is required';

  let hostUrl: URL;
  try {
    hostUrl = new URL(`http://${hostHeader}`);
  } catch {
    return 'Invalid Host header';
  }
  const hostname = hostUrl.hostname.toLowerCase();
  if (
    hostUrl.port !== String(localPort) ||
    (hostname !== 'localhost' && hostname !== '127.0.0.1' && hostname !== '[::1]')
  ) {
    return 'Host must match the local dashboard authority';
  }

  const source = req.headers.origin || req.headers.referer;
  if (!source) return 'Origin or Referer header is required for state-changing requests';
  let sourceUrl: URL;
  try {
    sourceUrl = new URL(source);
  } catch {
    return 'Invalid Origin or Referer header';
  }
  const sourceHostname = sourceUrl.hostname.toLowerCase();
  if (
    sourceUrl.protocol !== 'http:' ||
    sourceUrl.host.toLowerCase() !== hostHeader.toLowerCase() ||
    (sourceHostname !== 'localhost' && sourceHostname !== '127.0.0.1' && sourceHostname !== '[::1]')
  ) {
    return 'Cross-origin state-changing request rejected';
  }
  return null;
}

export function securityHeaders(): Record<string, string> {
  return { ...SECURITY_HEADERS };
}

export function readBody(req: http.IncomingMessage): Promise<unknown> {
  const MAX_BYTES = 64 * 1024; // 64 KB — more than enough for decision+notes JSON
  return new Promise((resolve, reject) => {
    let data = '';
    let bytes = 0;
    req.on('data', (chunk: Buffer | string) => {
      bytes += Buffer.byteLength(chunk);
      if (bytes > MAX_BYTES) {
        req.destroy();
        reject(Object.assign(new Error('Request body too large'), { code: 413 }));
        return;
      }
      data += chunk;
    });
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

export function jsonResponse(res: http.ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body, null, 2);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
  });
  res.end(json);
}

export function htmlResponse(res: http.ServerResponse, status: number, html: string): void {
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(html);
}

export function validationError(
  res: http.ServerResponse,
  field: string,
  code: string,
  message: string,
): void {
  jsonResponse(res, 400, { error: message, code, field });
}

export function hasOwn(body: Record<string, unknown>, key: string): boolean {
  return Object.hasOwn(body, key);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
