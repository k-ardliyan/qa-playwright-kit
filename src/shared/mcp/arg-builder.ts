import type { McpRuntimeConfig } from './types';

/**
 * Build official @playwright/mcp CLI arguments from typed runtime configuration.
 * Contract facts verified against the installed @playwright/mcp 0.0.83 `--help`
 * and a live `tools/list` probe per `--caps` set:
 * - `--caps` accepts EVERY capability name (core, network, storage, testing,
 *   vision, pdf, devtools, config) — the help text only advertises the additive
 *   ones. Verified: `--caps=storage` exposes 17 storage tools, `--caps=testing`
 *   5 testing tools, `--caps=config` browser_get_config, `--caps=network` 4
 *   route tools. Unknown values are ignored silently (exit 0).
 * - `--allowed-origins` is a semicolon-separated list.
 * - `--browser` accepts chrome|firefox|webkit|msedge (framework default
 *   'chromium' maps to the CLI default and is omitted).
 */
export function buildPlaywrightMcpArgs(config: McpRuntimeConfig): string[] {
  const args: string[] = [];

  // Headless mode
  if (config.headless) {
    args.push('--headless');
  }

  // Browser selection (omit the framework default; CLI default is used)
  if (config.browser && config.browser !== 'chromium') {
    args.push(`--browser=${config.browser}`);
  }

  // Capabilities: pass the profile's full capability set. Restricting this to
  // the advertised additive values silently dropped testing/storage/network/
  // config, so `author` ran WITHOUT browser_generate_locator and
  // browser_verify_* while agent instructions called them.
  if (config.capabilities.length > 0) {
    args.push(`--caps=${config.capabilities.join(',')}`);
  }

  // Output Directory
  if (config.outputDir) {
    args.push(`--output-dir=${config.outputDir}`);
  }

  // Allowed Origins (semicolon-separated list)
  if (config.allowedOrigins && config.allowedOrigins.length > 0) {
    args.push(`--allowed-origins=${config.allowedOrigins.join(';')}`);
  }

  // Storage State
  if (config.storageStatePath) {
    args.push(`--storage-state=${config.storageStatePath}`);
  }

  // Isolation
  if (config.isolated) {
    args.push('--isolated');
  }

  return args;
}
