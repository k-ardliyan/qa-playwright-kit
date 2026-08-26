/// <reference types="node" />
/**
 * Back-compat wrapper. Canonical implementation:
 * tools/scripts/sync-mcp-generated.ts
 *
 * Copies SoT files (file-content-core + contracts) into the MCP package.
 */
import { syncMcpGenerated } from './sync-mcp-generated';

const result = syncMcpGenerated(process.cwd(), false);
if (!result.ok) {
  for (const src of result.missingSources) {
    process.stderr.write(`Source missing: ${src}\n`);
  }
  process.exit(1);
}
process.stdout.write('✓ Synced MCP generated copies (via sync:file-core wrapper)\n');
