/// <reference types="node" />

import { spawn } from 'node:child_process';
import { bootstrapMcpEnvironment } from './mcp-bootstrap';
import { getMcpProfile } from '../../src/shared/mcp/profile';
import { resolveAllowedOrigins } from '../../src/shared/mcp/origin-resolver';
import { resolveMcpOutputDir } from '../../src/shared/mcp/output-resolver';
import { buildPlaywrightMcpArgs } from '../../src/shared/mcp/arg-builder';
import { PLAYWRIGHT_MCP_BASELINE_VERSION } from '../../src/shared/mcp/version';
import { authStatePath } from '../../src/support/auth-paths';
import type { McpIntent, McpRuntimeConfig } from '../../src/shared/mcp/types';
import type { McpCapability } from '../../src/shared/mcp/capability-manifest';

export function parseLauncherArgs(argv: string[]): {
  profile: McpIntent;
  role?: string;
  browser: string;
  headless?: boolean;
  isolated?: boolean;
  caps?: string[];
  help?: boolean;
} {
  let profile: McpIntent = 'author';
  let role: string | undefined;
  let browser = 'chromium';
  let headless: boolean | undefined;
  let isolated: boolean | undefined;
  let caps: string[] | undefined;
  let help = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      help = true;
    } else if (arg.startsWith('--profile=')) {
      profile = arg.split('=')[1] as McpIntent;
    } else if (arg === '--profile' && i + 1 < argv.length) {
      profile = argv[++i] as McpIntent;
    } else if (arg.startsWith('--role=')) {
      role = arg.split('=')[1];
    } else if (arg === '--role' && i + 1 < argv.length) {
      role = argv[++i];
    } else if (arg.startsWith('--browser=')) {
      browser = arg.split('=')[1];
    } else if (arg === '--browser' && i + 1 < argv.length) {
      browser = argv[++i];
    } else if (arg === '--headless') {
      headless = true;
    } else if (arg === '--headed') {
      headless = false;
    } else if (arg === '--isolated') {
      isolated = true;
    } else if (arg === '--persistent') {
      isolated = false;
    } else if (arg.startsWith('--caps=')) {
      caps = arg.split('=')[1].split(',');
    }
  }

  return { profile, role, browser, headless, isolated, caps, help };
}

export function resolveLauncherConfig(argv: string[]): McpRuntimeConfig {
  const parsed = parseLauncherArgs(argv);
  const profileDef = getMcpProfile(parsed.profile);

  const capabilities = parsed.caps ? (parsed.caps as McpCapability[]) : profileDef.capabilities;
  const headless = parsed.headless ?? profileDef.defaultHeadless;
  const isolated = parsed.isolated ?? profileDef.defaultIsolated;
  const appEnv = process.env.APP_ENV ?? 'local';

  let storageStatePath: string | undefined;
  if (parsed.role) {
    storageStatePath = authStatePath(parsed.role, appEnv);
  }

  const allowedOrigins = resolveAllowedOrigins();
  const outputDir = resolveMcpOutputDir();

  return {
    intent: parsed.profile,
    environment: appEnv,
    role: parsed.role,
    browser: parsed.browser,
    headless,
    isolated,
    capabilities,
    allowedOrigins,
    outputDir,
    storageStatePath,
  };
}

async function main(): Promise<void> {
  // CLI entry only — importing this module must stay side-effect free
  // (pure helpers are unit-tested; bootstrap loads real env into process.env).
  bootstrapMcpEnvironment(__dirname);
  const rawArgs = process.argv.slice(2);
  const parsed = parseLauncherArgs(rawArgs);

  if (parsed.help) {
    process.stdout.write(`
QA Playwright Kit — MCP Launcher
Usage: npx tsx scripts/playwright-mcp-launch.ts [options]

Options:
  --profile=<minimal|author|debug|auth|visual|artifact>   MCP Intent Profile (default: author)
  --role=<role>                                           Attach storage state for role
  --browser=<chromium|firefox|webkit>                     Browser engine (default: chromium)
  --headless / --headed                                   Headless or headed mode
  --isolated / --persistent                               Session isolation mode (default: isolated)
  --caps=<cap1,cap2>                                      Override capabilities
  --help                                                  Show this help message
\n`);
    process.exit(0);
  }

  const config = resolveLauncherConfig(rawArgs);
  const mcpCliArgs = buildPlaywrightMcpArgs(config);
  const packageSpecifier = `@playwright/mcp@${PLAYWRIGHT_MCP_BASELINE_VERSION}`;

  const child = spawn('npx', ['-y', packageSpecifier, ...mcpCliArgs], {
    stdio: 'inherit',
    shell: true,
    cwd: process.cwd(),
    env: process.env,
  });

  child.on('exit', (code, signal) => {
    if (signal) process.exit(1);
    process.exit(code ?? 0);
  });

  child.on('error', (err) => {
    process.stderr.write(`Playwright MCP launch failed: ${err.message}\n`);
    process.exit(1);
  });
}

if (require.main === module) {
  main().catch((err) => {
    process.stderr.write(`Launcher error: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
}
