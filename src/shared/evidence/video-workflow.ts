import * as path from 'node:path';
import type { VideoChapter } from './types';
import { workspace } from '../workspace-paths';

export interface VideoSession {
  runId: string;
  testId: string;
  videoPath: string;
  chapters: VideoChapter[];
  startedAt: number;
}

/**
 * Manage optional reproduction video recording with chapter markers for QA review.
 */
export class McpVideoWorkflow {
  public static startVideoSession(
    runId: string,
    testId: string,
    customOutDir?: string,
  ): VideoSession {
    const dir = customOutDir ?? path.join(workspace.testResultsDir, 'mcp', runId, 'videos');
    const safeTestId = testId.replace(/[^a-zA-Z0-9_-]/g, '_');
    const videoPath = path.join(dir, `${safeTestId}-reproduction.webm`);

    const session: VideoSession = {
      runId,
      testId,
      videoPath,
      chapters: [],
      startedAt: Date.now(),
    };

    this.addChapter(session, 'Precondition');
    return session;
  }

  public static addChapter(session: VideoSession, title: string): void {
    const elapsedMs = Date.now() - session.startedAt;
    session.chapters.push({
      title,
      timestampMs: elapsedMs,
    });
  }

  public static stopVideoSession(session: VideoSession): {
    videoPath: string;
    chapters: VideoChapter[];
  } {
    return {
      videoPath: session.videoPath,
      chapters: [...session.chapters],
    };
  }
}
