import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { dispatchTool } from './tools/dispatch';
import { getActiveMcpProfile, getToolsForProfile } from './tools/registry';
import { bootstrapMcpEnvironment } from './utils/mcp-env-bootstrap';
import { logger } from './utils/logger';

const server = new Server(
  {
    name: 'qa-playwright-kit-mcp-server',
    version: '2.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  },
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  const activeProfile = getActiveMcpProfile();
  logger.info('ListTools request received.', { profile: activeProfile });
  const activeTools = getToolsForProfile(activeProfile);
  return {
    tools: activeTools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    })),
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  logger.info('CallTool request received.', { toolName: name });

  try {
    const result = await dispatchTool(name, (args ?? {}) as Record<string, unknown>);
    return {
      content: [{ type: 'text', text: JSON.stringify(result.payload, null, 2) }],
      isError: result.isError,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Tool execution failed.', { toolName: name, message });

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              status: 'error',
              error: { code: 'TOOL_ERROR', message },
            },
            null,
            2,
          ),
        },
      ],
      isError: true,
    };
  }
});

async function main() {
  bootstrapMcpEnvironment(__dirname);
  process.stderr.write('[qa-playwright-kit-mcp] Starting MCP server (stdio transport)...\n');
  logger.info('Starting QA Playwright Kit MCP Server...');
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write('[qa-playwright-kit-mcp] Server ready. Waiting for JSON-RPC on stdin...\n');
  logger.info('QA Playwright Kit MCP Server running with stdio transport.');
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : 'Unknown error';
  logger.error('MCP server failed to start.', { message });
  process.exit(1);
});
