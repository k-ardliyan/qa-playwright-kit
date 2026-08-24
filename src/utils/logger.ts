/**
 * Structured Logger utility for the Playwright AI Agent Framework.
 *
 * Writes timestamped, levelled messages to the appropriate console stream
 * and appends every message to `logs/automation.log` for persistent tracing.
 *
 * @see Requirements 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7
 */

import * as fs from 'fs';
import * as path from 'path';

// ---------------------------------------------------------------------------
// Constants / helpers
// ---------------------------------------------------------------------------

type LogLevel = 'INFO' | 'WARN' | 'ERROR' | 'DEBUG';

/**
 * MCP stdio transport reserves stdout for JSON-RPC only.
 * When MCP_STDIO=1 (set by qa-playwright-kit / playwright-test launchers),
 * all console log lines go to stderr so the protocol is never corrupted.
 */
function isMcpStdioMode(): boolean {
  const flag = process.env['MCP_STDIO'];
  return flag === '1' || flag === 'true';
}

/** Resolve log paths at write-time so chdir() during MCP bootstrap is respected. */
function getLogPaths(): { logDir: string; logFile: string } {
  const logDir = path.resolve(process.cwd(), 'logs');
  return { logDir, logFile: path.join(logDir, 'automation.log') };
}

// ---------------------------------------------------------------------------
// Logger class
// ---------------------------------------------------------------------------

class Logger {
  /**
   * Log an informational message.
   * Writes to process.stdout (or stderr in MCP_STDIO mode) and logs/automation.log.
   */
  info(message: string, metadata?: Record<string, unknown>): void {
    this._write('INFO', message, metadata);
  }

  /**
   * Log a warning message.
   * Writes to process.stderr and logs/automation.log.
   */
  warn(message: string, metadata?: Record<string, unknown>): void {
    this._write('WARN', message, metadata);
  }

  /**
   * Log an error message.
   * Writes to process.stderr and logs/automation.log.
   */
  error(message: string, metadata?: Record<string, unknown>): void {
    this._write('ERROR', message, metadata);
  }

  /**
   * Log a debug message.
   * Only emitted when LOG_LEVEL env var equals "debug".
   */
  debug(message: string, metadata?: Record<string, unknown>): void {
    if (process.env['LOG_LEVEL'] !== 'debug') {
      return;
    }
    this._write('DEBUG', message, metadata);
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Build the formatted log line and route it to the correct stream + file.
   */
  private _write(level: LogLevel, message: string, metadata?: Record<string, unknown>): void {
    const timestamp = new Date().toISOString(); // ISO 8601 with ms precision
    const metaPart = metadata !== undefined ? ` ${JSON.stringify(metadata)}` : '';
    const line = `[${timestamp}] [${level}] ${message}${metaPart}`;

    // Route to the correct console stream.
    // MCP stdio: never touch stdout (breaks JSON-RPC framing).
    if (isMcpStdioMode()) {
      process.stderr.write(line + '\n');
    } else if (level === 'INFO' || level === 'DEBUG') {
      process.stdout.write(line + '\n');
    } else {
      // WARN, ERROR
      process.stderr.write(line + '\n');
    }

    // Append to the persistent log file
    this._appendToFile(line);
  }

  /**
   * Ensure the `logs/` directory exists, then append the log line to the file.
   * Uses fs.appendFileSync for thread-safe, synchronous writes.
   */
  private _appendToFile(line: string): void {
    try {
      const { logDir, logFile } = getLogPaths();
      // Auto-create logs/ directory on first write
      if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
      }
      fs.appendFileSync(logFile, line + '\n', 'utf8');
    } catch (err) {
      // If file writing fails, report to stderr without crashing the process
      process.stderr.write(`[Logger] Failed to write to log file: ${String(err)}\n`);
    }
  }
}

// ---------------------------------------------------------------------------
// Singleton export
// ---------------------------------------------------------------------------

export const logger = new Logger();
