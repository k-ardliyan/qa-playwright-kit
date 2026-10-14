import type { McpIntent, McpProfileDefinition } from './mcp-runtime-config';
import type { McpCapability } from './capability-manifest';

export const MCP_PROFILES: Record<McpIntent, McpProfileDefinition> = {
  minimal: {
    intent: 'minimal',
    capabilities: ['core'],
    defaultHeadless: true,
    defaultIsolated: true,
    description: 'Lightweight profile for fast page navigation and inspection',
  },
  author: {
    intent: 'author',
    capabilities: ['core', 'testing', 'storage', 'config'],
    defaultHeadless: true,
    defaultIsolated: true,
    description: 'Profile for requirement exploration and test generation with live verification',
  },
  debug: {
    intent: 'debug',
    capabilities: ['core', 'testing', 'storage', 'network', 'devtools', 'config'],
    defaultHeadless: true,
    defaultIsolated: true,
    description: 'Profile for reproducing failures with full network and devtools diagnostics',
  },
  auth: {
    intent: 'auth',
    capabilities: ['core', 'storage', 'config'],
    defaultHeadless: false,
    defaultIsolated: false,
    description: 'Profile for interactive authentication and session materialization',
  },
  visual: {
    intent: 'visual',
    capabilities: ['core', 'vision', 'config'],
    defaultHeadless: true,
    defaultIsolated: true,
    description: 'Profile for canvas, WebGL, or inaccessible visual elements fallback',
  },
  artifact: {
    intent: 'artifact',
    capabilities: ['core', 'pdf', 'config'],
    defaultHeadless: true,
    defaultIsolated: true,
    description: 'Profile for browser-rendered PDF export and document inspection',
  },
};

export function getMcpProfile(intent: McpIntent = 'author'): McpProfileDefinition {
  return MCP_PROFILES[intent] ?? MCP_PROFILES.author;
}

export function resolveCapabilitiesForIntent(intent: McpIntent): McpCapability[] {
  return [...getMcpProfile(intent).capabilities];
}
