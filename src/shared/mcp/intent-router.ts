import type { BrowserIntent } from '../types/browser-intent.types';
import type { McpIntent } from './mcp-runtime-config';
import type { McpCapability } from './capability-manifest';
import { getMcpProfile } from './profile';

export interface RoutedMcpConfiguration {
  profile: McpIntent;
  capabilities: McpCapability[];
  headless: boolean;
  isolated: boolean;
}

/**
 * Deterministically map a scenario's browser intent to the minimum required MCP profile and capabilities.
 */
export function resolveMcpProfileFromIntent(intent?: BrowserIntent): RoutedMcpConfiguration {
  const reqs = intent?.requires ?? {};

  // Vision fallback
  if (reqs.vision || intent?.mode === 'visual') {
    const prof = getMcpProfile('visual');
    return {
      profile: 'visual',
      capabilities: [...prof.capabilities],
      headless: prof.defaultHeadless,
      isolated: prof.defaultIsolated,
    };
  }

  // PDF document capture
  if (reqs.pdf) {
    const prof = getMcpProfile('artifact');
    return {
      profile: 'artifact',
      capabilities: [...prof.capabilities],
      headless: prof.defaultHeadless,
      isolated: prof.defaultIsolated,
    };
  }

  // Full DevTools / Debug
  if (reqs.devtools) {
    const prof = getMcpProfile('debug');
    return {
      profile: 'debug',
      capabilities: [...prof.capabilities],
      headless: prof.defaultHeadless,
      isolated: prof.defaultIsolated,
    };
  }

  // Author mode with optional Network
  const baseCaps: McpCapability[] = ['core', 'testing', 'storage', 'config'];
  if (reqs.network || intent?.mode === 'offline') {
    baseCaps.push('network');
  }

  return {
    profile: 'author',
    capabilities: Array.from(new Set(baseCaps)),
    headless: true,
    isolated: true,
  };
}
