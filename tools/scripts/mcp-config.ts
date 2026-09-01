/**
 * CLI wrapper for the cross-platform MCP config generator.
 *
 * Usage:
 *   tsx tools/scripts/mcp-config.ts            # generate claude/cursor/kiro configs (copilot is source)
 *   tsx tools/scripts/mcp-config.ts --platform=claude
 *   tsx tools/scripts/mcp-config.ts --check    # drift check only (exit 2 when outdated)
 *
 * `--check` is CI-friendly: exit 0 when all generated configs are up-to-date,
 * exit 2 (framework ESCALATE convention) listing outdated platforms otherwise.
 */

import {
  generateConfig,
  detectDrift,
  ALL_PLATFORMS,
} from '../../src/agents/integration/mcp-config-generator';
import type { Platform } from '../../src/agents/integration/mcp-config-generator';

function parseArgs(argv: string[]): { platform?: string; check: boolean } {
  const args: { platform?: string; check: boolean } = { check: false };
  for (const arg of argv.slice(2)) {
    if (arg === '--check') args.check = true;
    else if (arg.startsWith('--platform=')) args.platform = arg.slice('--platform='.length);
  }
  return args;
}

function main(): void {
  const args = parseArgs(process.argv);

  if (args.platform && !ALL_PLATFORMS.includes(args.platform as Platform)) {
    console.error(
      `Unknown platform '${args.platform}'. Expected one of: ${ALL_PLATFORMS.join(', ')}`,
    );
    process.exit(2);
  }

  if (args.check) {
    const { outdated, upToDate } = detectDrift({});
    for (const p of upToDate) console.log(`  up-to-date  ${p}`);
    if (outdated.length === 0) {
      console.log('All generated MCP platform configs are up-to-date.');
      return;
    }
    console.error(`Outdated platform configs: ${outdated.join(', ')}`);
    console.error(`Run: npm run mcp:config`);
    process.exit(2);
  }

  if (args.platform) {
    generateConfig({ platform: args.platform as Platform });
    console.log(`Generated ${args.platform} config.`);
  } else {
    generateConfig();
    console.log('Generated claude/cursor/kiro/codex configs from .mcp.json.');
  }
}

main();
