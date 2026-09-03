import * as path from 'node:path';
import { findRepoRoot } from '../mcp/version-resolver';

export interface TraceSession {
  runId: string;
  testId: string;
  tracePath: string;
  active: boolean;
  startedAt: string;
}

/**
 * Manage on-demand MCP trace recording sessions for debugging and failure reproduction.
 */
export class McpTraceWorkflow {
  public static startTraceSession(
    runId: string,
    testId: string,
    customOutDir?: string,
  ): TraceSession {
    const root = findRepoRoot();
    const dir =
      customOutDir ?? path.join(root, 'artifacts', 'test-results', 'mcp', runId, 'traces');
    const safeTestId = testId.replace(/[^a-zA-Z0-9_-]/g, '_');
    const tracePath = path.join(dir, `${safeTestId}-trace.zip`);

    return {
      runId,
      testId,
      tracePath,
      active: true,
      startedAt: new Date().toISOString(),
    };
  }

  public static stopTraceSession(session: TraceSession): string {
    session.active = false;
    return session.tracePath;
  }
}
