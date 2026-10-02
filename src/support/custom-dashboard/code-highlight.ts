/**
 * Minimal TypeScript/JavaScript tokenizer for the step code peek.
 *
 * The built-in Playwright report bakes a babel-highlighted snippet into its own
 * report.json. We have no bundler or highlighter dependency, and shipping one
 * for a five-line peek is not worth the weight, so this tokenizes a source
 * window at render time with a single pass. It is deliberately shallow — a
 * light approximation, not a parser: enough colour to read a step's code, and
 * it degrades to plain text on anything it does not recognise.
 */

export type TokenType = 'comment' | 'string' | 'number' | 'keyword' | 'punctuation' | 'plain';

export interface CodeToken {
  type: TokenType;
  text: string;
}

const KEYWORDS = new Set([
  'as',
  'async',
  'await',
  'break',
  'case',
  'catch',
  'class',
  'const',
  'continue',
  'declare',
  'default',
  'delete',
  'do',
  'else',
  'enum',
  'export',
  'extends',
  'false',
  'finally',
  'for',
  'from',
  'function',
  'get',
  'if',
  'implements',
  'import',
  'in',
  'instanceof',
  'interface',
  'let',
  'new',
  'null',
  'of',
  'private',
  'protected',
  'public',
  'readonly',
  'return',
  'satisfies',
  'set',
  'static',
  'super',
  'switch',
  'this',
  'throw',
  'true',
  'try',
  'type',
  'typeof',
  'undefined',
  'var',
  'void',
  'while',
  'yield',
]);

/** comment | string | number | identifier | run of punctuation/operators. */
const TOKEN_RE =
  /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|('(?:[^'\\]|\\.)*'?|"(?:[^"\\]|\\.)*"?|`(?:[^`\\]|\\.)*`?)|(\b\d[\w.]*\b)|([A-Za-z_$][\w$]*)|([{}()[\];,.:?=<>+\-*/%!&|^~]+)/g;

export function tokenizeLine(line: string): CodeToken[] {
  const tokens: CodeToken[] = [];
  let lastIndex = 0;

  const pushPlain = (text: string): void => {
    if (text) tokens.push({ type: 'plain', text });
  };

  TOKEN_RE.lastIndex = 0;
  let match = TOKEN_RE.exec(line);
  while (match !== null) {
    pushPlain(line.slice(lastIndex, match.index));

    const [raw, comment, str, num, ident, punct] = match;
    if (comment) tokens.push({ type: 'comment', text: comment });
    else if (str) tokens.push({ type: 'string', text: str });
    else if (num) tokens.push({ type: 'number', text: num });
    else if (ident) {
      tokens.push({ type: KEYWORDS.has(ident) ? 'keyword' : 'plain', text: ident });
    } else if (punct) tokens.push({ type: 'punctuation', text: punct });
    else pushPlain(raw);

    lastIndex = match.index + raw.length;
    match = TOKEN_RE.exec(line);
  }

  pushPlain(line.slice(lastIndex));
  return tokens;
}
