import type * as http from 'node:http';

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
