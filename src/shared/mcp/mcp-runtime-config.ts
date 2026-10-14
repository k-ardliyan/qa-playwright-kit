import type { McpCapability } from './capability-manifest';

export type McpIntent = 'minimal' | 'author' | 'debug' | 'auth' | 'visual' | 'artifact';

export interface McpRuntimeConfig {
  intent: McpIntent;
  environment: string;
  role?: string;
  browser: 'chromium' | 'firefox' | 'webkit' | string;
  headless: boolean;
  isolated: boolean;
  capabilities: McpCapability[];
  allowedOrigins: string[];
  blockedOrigins?: string[];
  outputDir: string;
  storageStatePath?: string;
}

export interface McpProfileDefinition {
  intent: McpIntent;
  capabilities: McpCapability[];
  defaultHeadless: boolean;
  defaultIsolated: boolean;
  description: string;
}
