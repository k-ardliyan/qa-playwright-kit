import * as http from 'node:http';
import { dispatchTool } from './tools/dispatch';
import { TOOL_ROUTES } from './tools/registry';
import { logger } from './utils/logger';

const DEFAULT_MCP_SERVER_PORT = 3100;
const rawPort = process.env.MCP_SERVER_PORT ?? String(DEFAULT_MCP_SERVER_PORT);
const MCP_SERVER_PORT = Number(rawPort);

// Loopback by default — the HTTP surface is a local development convenience and
// has no auth. Opt out only for container/VM setups via MCP_SERVER_HOST=0.0.0.0.
const MCP_SERVER_HOST = process.env.MCP_SERVER_HOST?.trim() || '127.0.0.1';
const MAX_HTTP_BODY_BYTES = 1_048_576;

if (!Number.isInteger(MCP_SERVER_PORT) || MCP_SERVER_PORT < 0 || MCP_SERVER_PORT > 65535) {
  throw new Error(
    `[mcp-server] Invalid port configuration: MCP_SERVER_PORT='${rawPort}'. ` +
      'Set MCP_SERVER_PORT to an integer between 1 and 65535.',
  );
}

if (MCP_SERVER_PORT === 0) {
  throw new Error(
    '[mcp-server] Invalid port configuration: MCP_SERVER_PORT is 0. ' +
      'Set MCP_SERVER_PORT to a fixed valid port (e.g. 3100).',
  );
}

function sendJson(res: http.ServerResponse, statusCode: number, payload: unknown): void {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

async function readJsonBody(req: http.IncomingMessage): Promise<Record<string, unknown> | null> {
  const declaredLength = Number(req.headers['content-length'] ?? 0);
  if (declaredLength > MAX_HTTP_BODY_BYTES) {
    return null;
  }

  const chunks: Buffer[] = [];
  let total = 0;

  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buf.length;
    if (total > MAX_HTTP_BODY_BYTES) {
      return null;
    }
    chunks.push(buf);
  }

  if (chunks.length === 0) {
    return {};
  }

  const raw = Buffer.concat(chunks).toString('utf-8').trim();
  if (!raw) {
    return {};
  }

  return JSON.parse(raw) as Record<string, unknown>;
}

const server = http.createServer(async (req: http.IncomingMessage, res: http.ServerResponse) => {
  try {
    const method = req.method ?? 'GET';
    const url = req.url ?? '/';

    if (method === 'GET' && url === '/health') {
      sendJson(res, 200, { status: 'ok', server: 'qa-playwright-kit' });
      return;
    }

    if (method === 'POST') {
      const toolName = TOOL_ROUTES[url];
      if (toolName) {
        const body = await readJsonBody(req);
        if (body === null) {
          sendJson(res, 413, {
            status: 'error',
            error: {
              code: 'PAYLOAD_TOO_LARGE',
              message: `Request body exceeds ${MAX_HTTP_BODY_BYTES} bytes.`,
            },
          });
          return;
        }
        const result = await dispatchTool(toolName, body);
        const statusCode =
          result.isError && (result.payload as { status?: string }).status === 'error' ? 400 : 200;
        sendJson(res, statusCode, result.payload);
        return;
      }
    }

    sendJson(res, 404, {
      status: 'error',
      error: {
        code: 'NOT_FOUND',
        message: `Route not found: ${method} ${url}`,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected server error';
    logger.error('Unhandled MCP server error.', { message });

    sendJson(res, 500, {
      status: 'error',
      error: {
        code: 'INTERNAL_ERROR',
        message,
      },
    });
  }
});

server.listen(MCP_SERVER_PORT, MCP_SERVER_HOST, () => {
  logger.info('Custom MCP server listening.', {
    host: MCP_SERVER_HOST,
    port: MCP_SERVER_PORT,
  });
});

export default server;
