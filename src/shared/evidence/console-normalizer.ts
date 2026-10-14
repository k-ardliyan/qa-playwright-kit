import type { NormalizedConsoleEntry } from './evidence-types';
import { redactSensitiveData } from '../utils/redaction';

export interface RawConsoleMessage {
  type: string;
  text: string;
  location?: { url?: string; lineNumber?: number; columnNumber?: number };
}

/**
 * Normalize and sanitize raw browser console messages into standard evidence entries.
 */
export function normalizeConsoleMessages(
  messages: (RawConsoleMessage | string)[],
): NormalizedConsoleEntry[] {
  return messages
    .filter((msg) => typeof msg !== 'string' || msg.trim().length > 0)
    .map((msg) => {
      if (typeof msg === 'string') {
        // Word-boundary match so "ErrorHandler"-style identifiers / empty text
        // are not misclassified as errors.
        return {
          type: /\berror\b/i.test(msg) ? 'error' : 'info',
          text: redactSensitiveData(msg),
          timestamp: new Date().toISOString(),
        };
      }

      const typeStr = (msg.type || 'log').toLowerCase();
      let type: 'error' | 'warning' | 'info' | 'log' = 'log';
      if (typeStr === 'error') type = 'error';
      else if (typeStr === 'warning' || typeStr === 'warn') type = 'warning';
      else if (typeStr === 'info') type = 'info';

      let location: string | undefined;
      if (msg.location?.url) {
        location = `${msg.location.url}${msg.location.lineNumber ? `:${msg.location.lineNumber}` : ''}`;
      }

      return {
        type,
        text: redactSensitiveData(msg.text || ''),
        timestamp: new Date().toISOString(),
        location,
      };
    });
}
