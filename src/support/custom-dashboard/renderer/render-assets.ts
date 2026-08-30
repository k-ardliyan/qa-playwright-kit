import fs from 'node:fs';
import path from 'node:path';

const STYLES_DIR = path.resolve(__dirname, '../styles');

export const STYLE_FILES = [
  'tokens.css',
  'base.css',
  'dashboard.css',
  'table.css',
  'detail.css',
  'states.css',
  'responsive.css',
  'print.css',
] as const;

let cachedStyles: string | null = null;

/**
 * Reads and concatenates all CSS files in strict cascade order.
 * In production or CI, caches the result in-memory.
 */
export function getDashboardStyles(): string {
  if (cachedStyles && (process.env.NODE_ENV === 'production' || process.env.CI)) {
    return cachedStyles;
  }

  const cssParts = STYLE_FILES.map((file) => {
    const filePath = path.join(STYLES_DIR, file);
    if (fs.existsSync(filePath)) {
      return fs.readFileSync(filePath, 'utf-8');
    }
    return '';
  });

  cachedStyles = cssParts.join('\n');
  return cachedStyles;
}

/** Clear cached styles (used in testing or hot-reload environments). */
export function clearStylesCache(): void {
  cachedStyles = null;
}
