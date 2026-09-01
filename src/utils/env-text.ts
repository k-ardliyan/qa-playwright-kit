/**
 * Dotenv text helpers — parse, upsert, encode. No I/O.
 *
 * Shared by the setup wizard writer and env:edit CLI.
 *
 * @module src/utils/env-text
 */

export function assertSingleLineEnvValue(key: string, val: string): void {
  if (/[\r\n]/.test(val)) {
    throw new Error(
      `Nilai untuk ${key} tidak boleh mengandung baris baru (newline). Gunakan password satu baris.`,
    );
  }
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Encode a value for a dotenv line.
 * - Prefer single quotes when value has `$`, backtick, or `"` so dotenv/dotenvx
 *   will not expand variables (passwords often contain `$`).
 * - Use double quotes when value has single quotes / spaces / # / = without `$`.
 * - Plain when safe.
 */
export function encodeEnvValue(val: string): string {
  const needsAnyQuote = /[\s#"'$`]/.test(val) || val.includes('=') || val.includes('\\');

  if (!needsAnyQuote) return val;

  if (!val.includes("'")) {
    return `'${val}'`;
  }

  const escaped = val
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\$/g, '\\$')
    .replace(/`/g, '\\`');
  return `"${escaped}"`;
}

/**
 * Upsert KEY=value lines in env file content; preserve other lines and comments.
 *
 * Match order per key:
 * 1. Active `KEY=...` line → replaced in place.
 * 2. Commented `# KEY=...` placeholder → uncommented and replaced in place
 *    (keeps the key's section position); leftover commented duplicates removed.
 * 3. Otherwise → appended at the end (optionally under a section comment).
 */
export function upsertEnvContent(
  content: string,
  values: Record<string, string>,
  sectionComment?: string,
): string {
  let next = content.endsWith('\n') || content === '' ? content : content + '\n';
  let addedSection = false;

  for (const [key, val] of Object.entries(values)) {
    assertSingleLineEnvValue(key, val);
    const active = new RegExp(`^${escapeRegExp(key)}=.*$`, 'm');
    const commented = new RegExp(`^#\\s*${escapeRegExp(key)}=.*$`, 'm');
    const line = `${key}=${encodeEnvValue(val)}`;
    if (active.test(next)) {
      next = next.replace(active, line);
    } else if (commented.test(next)) {
      next = next.replace(commented, line);
      next = next.replace(new RegExp(`^#\\s*${escapeRegExp(key)}=.*\\r?\\n?`, 'gm'), '');
    } else {
      if (sectionComment && !addedSection) {
        next += `\n# ${sectionComment}\n`;
        addedSection = true;
      }
      next += line + '\n';
    }
  }
  return next;
}

/** Remove keys from env file content (whole lines). */
export function removeEnvKeys(content: string, keys: string[]): string {
  let next = content;
  for (const key of keys) {
    const regex = new RegExp(`^${escapeRegExp(key)}=.*\r?\n?`, 'gm');
    next = next.replace(regex, '');
  }
  return next.replace(/\n{3,}/g, '\n\n');
}

/** Parse KEY=VALUE lines from dotenv-style text (no expansion). */
export function parseEnvText(text: string): Record<string, string> {
  const map: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();

    // dotenvx writes `DOTENV_PUBLIC_KEY="..." # -fk <path>` — inline comments
    // (and anything after a quoted value's closing quote) are not part of the value.
    if (val.startsWith('"') || val.startsWith("'")) {
      const close = val.indexOf(val[0]!, 1);
      if (close > 0) {
        val =
          val[0] === '"'
            ? val
                .slice(1, close)
                .replace(/\\\$/g, '$')
                .replace(/\\`/g, '`')
                .replace(/\\"/g, '"')
                .replace(/\\\\/g, '\\')
            : val.slice(1, close);
      }
    } else {
      val = val.replace(/\s+#.*$/, '');
    }
    map[key] = val;
  }
  return map;
}

export function isEncryptedEnvText(text: string): boolean {
  return text.includes('encrypted:');
}
