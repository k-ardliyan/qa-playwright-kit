/**
 * Agent Instruction Validator — Agent AI Integration Layer
 *
 * A lint tool for `.agent.md` files that validates structural completeness,
 * required sections, MCP server references, and MCP tool references.
 *
 * Supports `--fix` mode to auto-correct known fixable issues.
 *
 * @module agents/integration/validator
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface ValidationResult {
  file: string;
  errors: ValidationError[];
  warnings: ValidationWarning[];
}

export interface ValidationError {
  type: 'missing-section' | 'invalid-mcp-server' | 'invalid-mcp-tool';
  message: string;
  line?: number;
  fixable: boolean;
}

export interface ValidationWarning {
  type: string;
  message: string;
  line?: number;
}

export interface ValidatorOptions {
  agentDir: string;
  mcpConfigPath: string;
  registryPath: string;
  fix: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const REQUIRED_SECTIONS = ['Role', 'Input Format', 'MCP Dependencies', 'Output Format'];

const DEFAULT_OPTIONS: ValidatorOptions = {
  agentDir: '.github/agents/',
  mcpConfigPath: '.mcp.json',
  registryPath: 'tools/mcp/src/tools/registry.ts',
  fix: false,
};

// ---------------------------------------------------------------------------
// Main Validation Function
// ---------------------------------------------------------------------------

/**
 * Validate all `.agent.md` files in the configured agent directory.
 *
 * @param options - Partial validator options (merged with defaults)
 * @returns Array of validation results, one per file
 */
export function validateAgents(options?: Partial<ValidatorOptions>): ValidationResult[] {
  const opts: ValidatorOptions = { ...DEFAULT_OPTIONS, ...options };

  const agentFiles = discoverAgentFiles(opts.agentDir);
  const mcpServers = getValidServerNames(opts.mcpConfigPath);
  const registryTools = getValidToolNames(opts.registryPath);

  const results: ValidationResult[] = [];

  for (const filePath of agentFiles) {
    const result = validateAgentFile(filePath, opts, mcpServers, registryTools);
    results.push(result);
  }

  return results;
}

/**
 * Validate a single `.agent.md` file.
 *
 * @param filePath - Absolute path to the agent file
 * @param options - Validator options (merged with defaults)
 * @param mcpServers - Optional preloaded server names (loaded from options if not provided)
 * @param registryTools - Optional preloaded tool names (loaded from options if not provided)
 * @returns Validation result for the file
 */
export function validateAgentFile(
  filePath: string,
  options?: Partial<ValidatorOptions>,
  mcpServers?: string[],
  registryTools?: string[],
): ValidationResult {
  const opts: ValidatorOptions = { ...DEFAULT_OPTIONS, ...options };
  const servers = mcpServers ?? getValidServerNames(opts.mcpConfigPath);
  const tools = registryTools ?? getValidToolNames(opts.registryPath);
  return validateSingleFile(filePath, servers, tools, opts);
}

// ---------------------------------------------------------------------------
// Exit Code Helper
// ---------------------------------------------------------------------------

/**
 * Determine the exit code based on validation results.
 *
 * @returns 0 if no errors, 1 if any errors exist
 */
export function getExitCode(results: ValidationResult[]): number {
  const hasErrors = results.some((r) => r.errors.length > 0);
  return hasErrors ? 1 : 0;
}

// ---------------------------------------------------------------------------
// File Discovery
// ---------------------------------------------------------------------------

function discoverAgentFiles(agentDir: string): string[] {
  const resolvedDir = path.resolve(agentDir);

  if (!fs.existsSync(resolvedDir)) {
    return [];
  }

  const entries = fs.readdirSync(resolvedDir);
  return entries
    .filter((entry) => entry.endsWith('.agent.md'))
    .map((entry) => path.join(resolvedDir, entry));
}

// ---------------------------------------------------------------------------
// MCP Server Loading
// ---------------------------------------------------------------------------

/**
 * Read .mcp.json and extract valid server names.
 *
 * @param mcpConfigPath - Path to the MCP config file (defaults to '.mcp.json')
 * @returns Array of valid server names
 */
export function getValidServerNames(mcpConfigPath: string): string[] {
  const resolvedPath = path.resolve(mcpConfigPath);

  if (!fs.existsSync(resolvedPath)) {
    return [];
  }

  try {
    const content = fs.readFileSync(resolvedPath, 'utf-8');
    const config = JSON.parse(content);

    if (config.servers && Array.isArray(config.servers)) {
      return config.servers
        .map((s: { name?: string }) => s.name)
        .filter((name: unknown): name is string => typeof name === 'string');
    }

    // Also handle object-keyed format (Claude/Cursor/Kiro style)
    if (config.mcpServers && typeof config.mcpServers === 'object') {
      return Object.keys(config.mcpServers);
    }

    return [];
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Registry Tool Loading
// ---------------------------------------------------------------------------

/**
 * Read registry.ts and extract valid tool names.
 *
 * @param registryPath - Path to the registry.ts file
 * @returns Array of valid tool names
 */
export function getValidToolNames(registryPath: string): string[] {
  const resolvedPath = path.resolve(registryPath);

  if (!fs.existsSync(resolvedPath)) {
    return [];
  }

  try {
    const content = fs.readFileSync(resolvedPath, 'utf-8');
    return extractToolNamesFromRegistry(content);
  } catch {
    return [];
  }
}

/**
 * Extract tool names from registry.ts content using regex.
 * Looks for patterns like `name: 'tool_name'` or `name: "tool_name"`.
 */
export function extractToolNamesFromRegistry(content: string): string[] {
  const toolNames: string[] = [];
  const regex = /name:\s*['"]([^'"]+)['"]/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(content)) !== null) {
    toolNames.push(match[1]);
  }

  return toolNames;
}

// ---------------------------------------------------------------------------
// Single File Validation
// ---------------------------------------------------------------------------

function validateSingleFile(
  filePath: string,
  mcpServers: string[],
  registryTools: string[],
  opts: ValidatorOptions,
): ValidationResult {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');

  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  // Check required sections
  const missingSections = checkRequiredSections(lines);
  for (const section of missingSections) {
    errors.push({
      type: 'missing-section',
      message: `Missing required section: ## ${section}`,
      fixable: true,
    });
  }

  // Check MCP server references
  const serverRefs = extractMcpServerReferences(lines);
  for (const ref of serverRefs) {
    if (mcpServers.length > 0 && !mcpServers.includes(ref.name)) {
      errors.push({
        type: 'invalid-mcp-server',
        message: `Invalid MCP server reference: '${ref.name}' not found in ${opts.mcpConfigPath}`,
        line: ref.line,
        fixable: false,
      });
    }
  }

  // Check MCP tool references
  const toolRefs = extractMcpToolReferences(lines);
  if (toolRefs.length > 0 && registryTools.length === 0) {
    errors.push({
      type: 'invalid-mcp-tool',
      message: `Cannot validate MCP tools: registry file '${opts.registryPath}' is missing or defines no tools.`,
      fixable: false,
    });
  } else {
    for (const ref of toolRefs) {
      if (!registryTools.includes(ref.name)) {
        const closeMatch = findCloseMatch(ref.name, registryTools);
        errors.push({
          type: 'invalid-mcp-tool',
          message: closeMatch
            ? `Invalid MCP tool reference: '${ref.name}' not found in registry (did you mean '${closeMatch}'?)`
            : `Invalid MCP tool reference: '${ref.name}' not found in registry`,
          line: ref.line,
          fixable: closeMatch !== null,
        });
      }
    }
  }

  // Apply fixes if --fix mode is enabled
  if (opts.fix) {
    const fixedContent = applyFixes(content, lines, errors, registryTools);
    if (fixedContent !== content) {
      fs.writeFileSync(filePath, fixedContent, 'utf-8');
      // Remove fixed errors from the result
      const remainingErrors = errors.filter((e) => !e.fixable);
      return { file: filePath, errors: remainingErrors, warnings };
    }
  }

  return { file: filePath, errors, warnings };
}

// ---------------------------------------------------------------------------
// Section Detection
// ---------------------------------------------------------------------------

interface SectionInfo {
  name: string;
  line: number;
}

function parseSections(lines: string[]): SectionInfo[] {
  const sections: SectionInfo[] = [];

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].replace(/\r$/, '');
    const match = trimmed.match(/^## (.+)$/);
    if (match) {
      sections.push({ name: match[1].trim(), line: i + 1 });
    }
  }

  return sections;
}

function checkRequiredSections(lines: string[]): string[] {
  const sections = parseSections(lines);
  const sectionNames = sections.map((s) => s.name);

  return REQUIRED_SECTIONS.filter((required) => !sectionNames.includes(required));
}

// ---------------------------------------------------------------------------
// MCP Server Reference Extraction
// ---------------------------------------------------------------------------

interface McpReference {
  name: string;
  line: number;
}

/**
 * Extract MCP server references from file content.
 * Looks for:
 * - Table rows with backtick-quoted server names in MCP Dependencies sections: `| \`server-name\` |`
 * - Patterns like `server: <name>` or `Server | <name>`
 */
function extractMcpServerReferences(lines: string[]): McpReference[] {
  const refs: McpReference[] = [];
  const seen = new Set<string>();
  let inMcpSection = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].replace(/\r$/, '');

    // Track if we're in an MCP Dependencies section
    if (/^## MCP Dependencies/.test(line)) {
      inMcpSection = true;
      continue;
    }
    if (/^## /.test(line) && inMcpSection) {
      inMcpSection = false;
      continue;
    }

    if (!inMcpSection) continue;

    // Skip table header/separator rows
    if (/^\|[\s-]+\|/.test(line) && !/`/.test(line)) continue;

    // Match table rows: | `server-name` | `tool_name` |
    const tableMatch = line.match(/\|\s*`([^`]+)`\s*\|/);
    if (tableMatch) {
      // Only treat as server name if it looks like a server name (not a tool)
      // Server names typically have hyphens and no underscores, or are the first column
      const columns = line.split('|').filter((c) => c.trim());
      if (columns.length >= 1) {
        const firstCol = columns[0].trim();
        const serverMatch = firstCol.match(/`([^`]+)`/);
        if (serverMatch && !seen.has(serverMatch[1])) {
          seen.add(serverMatch[1]);
          refs.push({ name: serverMatch[1], line: i + 1 });
        }
      }
    }
  }

  return refs;
}

// ---------------------------------------------------------------------------
// MCP Tool Reference Extraction
// ---------------------------------------------------------------------------

/**
 * Extract MCP tool references from file content.
 * Only table rows in ## MCP Dependencies where the **server** column is
 * `qa-playwright-kit` are validated against mcp-server registry. Tools from
 * `playwright` / `playwright-test` (or other servers) are intentionally ignored
 * here — they are not registered in qa-playwright-kit's TOOL_REGISTRY.
 */
function extractMcpToolReferences(lines: string[]): McpReference[] {
  const refs: McpReference[] = [];
  const seen = new Set<string>();
  let inMcpSection = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].replace(/\r$/, '');

    if (/^## MCP Dependencies/.test(line)) {
      inMcpSection = true;
      continue;
    }
    if (/^## /.test(line) && !/^## MCP Dependencies/.test(line) && inMcpSection) {
      inMcpSection = false;
      continue;
    }

    if (!inMcpSection) continue;

    // Only pipe tables — skip prose that may mention browser_snapshot etc.
    if (!line.trim().startsWith('|')) continue;
    if (/^\|[\s-|]+$/.test(line.replace(/`/g, ''))) continue;

    const columns = line
      .split('|')
      .map((c) => c.trim())
      .filter((c) => c.length > 0);
    if (columns.length < 2) continue;

    const serverMatch = columns[0].match(/`([^`]+)`/);
    const toolMatch = columns[1].match(/`([^`]+)`/);
    if (!serverMatch || !toolMatch) continue;

    // Registry under mcp-server only lists qa-playwright-kit tools
    if (serverMatch[1] !== 'qa-playwright-kit') continue;

    const toolName = toolMatch[1];
    if (!toolName.includes('_') || seen.has(toolName)) continue;
    seen.add(toolName);
    refs.push({ name: toolName, line: i + 1 });
  }

  return refs;
}

// ---------------------------------------------------------------------------
// Close Match Detection (Levenshtein-based)
// ---------------------------------------------------------------------------

function findCloseMatch(name: string, candidates: string[]): string | null {
  let bestMatch: string | null = null;
  let bestDistance = Infinity;

  for (const candidate of candidates) {
    const distance = levenshteinDistance(name, candidate);
    // Consider it a close match if distance is <= 3 and less than half the name length
    if (distance <= 3 && distance < name.length / 2 && distance < bestDistance) {
      bestDistance = distance;
      bestMatch = candidate;
    }
  }

  return bestMatch;
}

function levenshteinDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
      }
    }
  }

  return dp[m][n];
}

// ---------------------------------------------------------------------------
// Fix Mode (Public API)
// ---------------------------------------------------------------------------

/**
 * Apply fixes to an agent file for fixable errors.
 *
 * - For `missing-section`: appends missing section headers with `<!-- TODO: Add content -->` placeholder
 * - For `invalid-mcp-tool` with a close match: updates outdated tool references
 * - Does NOT fix `invalid-mcp-server` (requires human decision)
 *
 * @param filePath - Path to the agent file to fix
 * @param errors - Validation errors to attempt to fix
 * @param registryTools - Optional list of valid tool names (for tool reference updates)
 */
export function fixAgentFile(
  filePath: string,
  errors: ValidationError[],
  registryTools?: string[],
): void {
  const resolvedPath = path.resolve(filePath);
  const content = fs.readFileSync(resolvedPath, 'utf-8');
  const lines = content.split('\n');
  const tools = registryTools ?? [];

  const fixedContent = applyFixes(content, lines, errors, tools);
  if (fixedContent !== content) {
    fs.writeFileSync(resolvedPath, fixedContent, 'utf-8');
  }
}

// ---------------------------------------------------------------------------
// Fix Mode (Internal)
// ---------------------------------------------------------------------------

function applyFixes(
  content: string,
  _lines: string[],
  errors: ValidationError[],
  _registryTools: string[],
): string {
  let fixedContent = content;

  // Fix missing sections: append to end of file
  const missingSectionErrors = errors.filter((e) => e.type === 'missing-section' && e.fixable);
  for (const error of missingSectionErrors) {
    const sectionMatch = error.message.match(/## (.+)$/);
    if (sectionMatch) {
      const sectionName = sectionMatch[1];
      const sectionContent = `\n\n## ${sectionName}\n\n<!-- TODO: Add content -->\n`;
      fixedContent = fixedContent.trimEnd() + sectionContent;
    }
  }

  // Fix invalid tool references with close matches
  const toolErrors = errors.filter((e) => e.type === 'invalid-mcp-tool' && e.fixable);
  for (const error of toolErrors) {
    const oldToolMatch = error.message.match(/Invalid MCP tool reference: '([^']+)'/);
    const newToolMatch = error.message.match(/did you mean '([^']+)'/);
    if (oldToolMatch && newToolMatch) {
      const oldTool = oldToolMatch[1];
      const newTool = newToolMatch[1];
      // Replace backtick-quoted tool references
      fixedContent = fixedContent.replace(
        new RegExp('`' + escapeRegExp(oldTool) + '`', 'g'),
        '`' + newTool + '`',
      );
    }
  }

  return fixedContent;
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
