/// <reference types="node" />
/**
 * Back-compat wrapper. Canonical implementation:
 * tools/scripts/sync-mcp-generated.ts
 *
 * Copies every AUTO-SYNCED source-of-truth file (contracts + shared cores)
 * into the MCP package. Named "compat" because it only exists to keep the
 * legacy `sync:file-core` script name working — it is NOT limited to
 * file-content-core, despite what the old name implied.
 */
import { syncMcpGenerated } from './sync-mcp-generated';

const result = syncMcpGenerated(process.cwd(), false);
if (!result.ok) {
  for (const src of result.missingSources) {
    process.stderr.write(`Source missing: ${src}\n`);
  }
  process.exit(1);
}
process.stdout.write('✓ Synced MCP generated copies (via sync-mcp-generated-compat)\n');
