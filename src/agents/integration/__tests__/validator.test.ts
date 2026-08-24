/**
 * Unit tests for Agent Instruction Validator — Agent AI Integration Layer
 *
 * Validates: Requirements 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7
 */

import { test, expect } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { validateAgents, getExitCode, extractToolNamesFromRegistry } from '../validator';

// ---------------------------------------------------------------------------
// Helper: Create a temp directory with test fixtures
// ---------------------------------------------------------------------------

function createTempFixtures(files: Record<string, string>): {
  tmpDir: string;
  agentDir: string;
  mcpConfigPath: string;
  registryPath: string;
  cleanup: () => void;
} {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'validator-test-'));
  const agentDir = path.join(tmpDir, 'agents');
  fs.mkdirSync(agentDir, { recursive: true });

  const mcpConfigPath = path.join(tmpDir, '.mcp.json');
  const registryPath = path.join(tmpDir, 'registry.ts');

  for (const [name, content] of Object.entries(files)) {
    const filePath = path.join(tmpDir, name);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, 'utf-8');
  }

  return {
    tmpDir,
    agentDir,
    mcpConfigPath,
    registryPath,
    cleanup: () => fs.rmSync(tmpDir, { recursive: true, force: true }),
  };
}

// ---------------------------------------------------------------------------
// Tests: Required Section Detection (Req 6.2)
// ---------------------------------------------------------------------------

test.describe('Validator — Required Section Detection (Req 6.2)', () => {
  test('reports no errors for a complete agent file', () => {
    const fixtures = createTempFixtures({
      'agents/complete.agent.md': [
        '# Complete Agent',
        '',
        '## Role',
        'A test agent.',
        '',
        '## Input Format',
        'JSON input.',
        '',
        '## MCP Dependencies',
        '| MCP Server | Tool Name |',
        '| --- | --- |',
        '| `qa-playwright-kit` | `health_check` |',
        '',
        '## Output Format',
        'JSON output.',
      ].join('\n'),
      '.mcp.json': JSON.stringify({
        servers: [{ name: 'qa-playwright-kit', command: 'node', args: [] }],
      }),
      'registry.ts': `export const TOOL_REGISTRY = [{ name: 'health_check', description: 'test' }];`,
    });

    try {
      const results = validateAgents({
        agentDir: fixtures.agentDir,
        mcpConfigPath: fixtures.mcpConfigPath,
        registryPath: fixtures.registryPath,
        fix: false,
      });

      expect(results).toHaveLength(1);
      expect(results[0].errors).toHaveLength(0);
    } finally {
      fixtures.cleanup();
    }
  });

  test('reports errors for missing sections', () => {
    const fixtures = createTempFixtures({
      'agents/incomplete.agent.md': [
        '# Incomplete Agent',
        '',
        '## Role',
        'A test agent.',
        '',
        '## Output Format',
        'JSON output.',
      ].join('\n'),
      '.mcp.json': JSON.stringify({ servers: [] }),
      'registry.ts': '',
    });

    try {
      const results = validateAgents({
        agentDir: fixtures.agentDir,
        mcpConfigPath: fixtures.mcpConfigPath,
        registryPath: fixtures.registryPath,
        fix: false,
      });

      expect(results).toHaveLength(1);
      const errors = results[0].errors.filter((e) => e.type === 'missing-section');
      expect(errors).toHaveLength(2);
      expect(errors.map((e) => e.message)).toContain('Missing required section: ## Input Format');
      expect(errors.map((e) => e.message)).toContain(
        'Missing required section: ## MCP Dependencies',
      );
      expect(errors.every((e) => e.fixable)).toBe(true);
    } finally {
      fixtures.cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// Tests: MCP Server Validation (Req 6.3, 6.5)
// ---------------------------------------------------------------------------

test.describe('Validator — MCP Server Reference Validation (Req 6.3, 6.5)', () => {
  test('reports error for invalid MCP server reference', () => {
    const fixtures = createTempFixtures({
      'agents/bad-server.agent.md': [
        '# Bad Server Agent',
        '',
        '## Role',
        'A test agent.',
        '',
        '## Input Format',
        'JSON input.',
        '',
        '## MCP Dependencies',
        '| MCP Server | Tool Name |',
        '| --- | --- |',
        '| `nonexistent-server` | `health_check` |',
        '',
        '## Output Format',
        'JSON output.',
      ].join('\n'),
      '.mcp.json': JSON.stringify({
        servers: [{ name: 'qa-playwright-kit', command: 'node', args: [] }],
      }),
      'registry.ts': `export const TOOL_REGISTRY = [{ name: 'health_check', description: 'test' }];`,
    });

    try {
      const results = validateAgents({
        agentDir: fixtures.agentDir,
        mcpConfigPath: fixtures.mcpConfigPath,
        registryPath: fixtures.registryPath,
        fix: false,
      });

      expect(results).toHaveLength(1);
      const serverErrors = results[0].errors.filter((e) => e.type === 'invalid-mcp-server');
      expect(serverErrors).toHaveLength(1);
      expect(serverErrors[0].message).toContain('nonexistent-server');
      expect(serverErrors[0].line).toBeDefined();
      expect(serverErrors[0].fixable).toBe(false);
    } finally {
      fixtures.cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// Tests: MCP Tool Validation (Req 6.4, 6.5)
// ---------------------------------------------------------------------------

test.describe('Validator — MCP Tool Reference Validation (Req 6.4, 6.5)', () => {
  test('reports error for invalid MCP tool reference', () => {
    const fixtures = createTempFixtures({
      'agents/bad-tool.agent.md': [
        '# Bad Tool Agent',
        '',
        '## Role',
        'A test agent.',
        '',
        '## Input Format',
        'JSON input.',
        '',
        '## MCP Dependencies',
        '| MCP Server | Tool Name |',
        '| --- | --- |',
        '| `qa-playwright-kit` | `nonexistent_tool` |',
        '',
        '## Output Format',
        'JSON output.',
      ].join('\n'),
      '.mcp.json': JSON.stringify({
        servers: [{ name: 'qa-playwright-kit', command: 'node', args: [] }],
      }),
      'registry.ts': `export const TOOL_REGISTRY = [{ name: 'health_check', description: 'test' }];`,
    });

    try {
      const results = validateAgents({
        agentDir: fixtures.agentDir,
        mcpConfigPath: fixtures.mcpConfigPath,
        registryPath: fixtures.registryPath,
        fix: false,
      });

      expect(results).toHaveLength(1);
      const toolErrors = results[0].errors.filter((e) => e.type === 'invalid-mcp-tool');
      expect(toolErrors).toHaveLength(1);
      expect(toolErrors[0].message).toContain('nonexistent_tool');
      expect(toolErrors[0].line).toBeDefined();
    } finally {
      fixtures.cleanup();
    }
  });

  test('suggests close match for renamed tool', () => {
    const fixtures = createTempFixtures({
      'agents/renamed-tool.agent.md': [
        '# Renamed Tool Agent',
        '',
        '## Role',
        'A test agent.',
        '',
        '## Input Format',
        'JSON input.',
        '',
        '## MCP Dependencies',
        '| MCP Server | Tool Name |',
        '| --- | --- |',
        '| `qa-playwright-kit` | `health_chek` |',
        '',
        '## Output Format',
        'JSON output.',
      ].join('\n'),
      '.mcp.json': JSON.stringify({
        servers: [{ name: 'qa-playwright-kit', command: 'node', args: [] }],
      }),
      'registry.ts': `export const TOOL_REGISTRY = [{ name: 'health_check', description: 'test' }];`,
    });

    try {
      const results = validateAgents({
        agentDir: fixtures.agentDir,
        mcpConfigPath: fixtures.mcpConfigPath,
        registryPath: fixtures.registryPath,
        fix: false,
      });

      expect(results).toHaveLength(1);
      const toolErrors = results[0].errors.filter((e) => e.type === 'invalid-mcp-tool');
      expect(toolErrors).toHaveLength(1);
      expect(toolErrors[0].message).toContain("did you mean 'health_check'");
      expect(toolErrors[0].fixable).toBe(true);
    } finally {
      fixtures.cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// Tests: Exit Code (Req 6.6)
// ---------------------------------------------------------------------------

test.describe('Validator — Exit Code (Req 6.6)', () => {
  test('returns 0 when no errors', () => {
    const results = [{ file: 'test.agent.md', errors: [], warnings: [] }];
    expect(getExitCode(results)).toBe(0);
  });

  test('returns 1 when errors exist', () => {
    const results = [
      {
        file: 'test.agent.md',
        errors: [
          {
            type: 'missing-section' as const,
            message: 'Missing required section: ## Role',
            fixable: true,
          },
        ],
        warnings: [],
      },
    ];
    expect(getExitCode(results)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Tests: Fix Mode (Req 6.7)
// ---------------------------------------------------------------------------

test.describe('Validator — Fix Mode (Req 6.7)', () => {
  test('adds missing sections in fix mode', () => {
    const fixtures = createTempFixtures({
      'agents/fixable.agent.md': [
        '# Fixable Agent',
        '',
        '## Role',
        'A test agent.',
        '',
        '## Output Format',
        'JSON output.',
      ].join('\n'),
      '.mcp.json': JSON.stringify({ servers: [] }),
      'registry.ts': '',
    });

    try {
      const results = validateAgents({
        agentDir: fixtures.agentDir,
        mcpConfigPath: fixtures.mcpConfigPath,
        registryPath: fixtures.registryPath,
        fix: true,
      });

      // After fix, remaining errors should be empty (missing sections are fixable)
      expect(results[0].errors).toHaveLength(0);

      // Verify the file was updated
      const fixedContent = fs.readFileSync(
        path.join(fixtures.agentDir, 'fixable.agent.md'),
        'utf-8',
      );
      expect(fixedContent).toContain('## Input Format');
      expect(fixedContent).toContain('## MCP Dependencies');
      expect(fixedContent).toContain('<!-- TODO: Add content -->');
    } finally {
      fixtures.cleanup();
    }
  });

  test('fixes renamed tool references in fix mode', () => {
    const fixtures = createTempFixtures({
      'agents/fix-tool.agent.md': [
        '# Fix Tool Agent',
        '',
        '## Role',
        'A test agent.',
        '',
        '## Input Format',
        'JSON input.',
        '',
        '## MCP Dependencies',
        '| MCP Server | Tool Name |',
        '| --- | --- |',
        '| `qa-playwright-kit` | `health_chek` |',
        '',
        '## Output Format',
        'JSON output.',
      ].join('\n'),
      '.mcp.json': JSON.stringify({
        servers: [{ name: 'qa-playwright-kit', command: 'node', args: [] }],
      }),
      'registry.ts': `export const TOOL_REGISTRY = [{ name: 'health_check', description: 'test' }];`,
    });

    try {
      const results = validateAgents({
        agentDir: fixtures.agentDir,
        mcpConfigPath: fixtures.mcpConfigPath,
        registryPath: fixtures.registryPath,
        fix: true,
      });

      // After fix, the tool error should be resolved
      expect(results[0].errors).toHaveLength(0);

      // Verify the file was updated
      const fixedContent = fs.readFileSync(
        path.join(fixtures.agentDir, 'fix-tool.agent.md'),
        'utf-8',
      );
      expect(fixedContent).toContain('`health_check`');
      expect(fixedContent).not.toContain('`health_chek`');
    } finally {
      fixtures.cleanup();
    }
  });

  test('does NOT auto-fix invalid server references', () => {
    const fixtures = createTempFixtures({
      'agents/no-fix-server.agent.md': [
        '# No Fix Server Agent',
        '',
        '## Role',
        'A test agent.',
        '',
        '## Input Format',
        'JSON input.',
        '',
        '## MCP Dependencies',
        '| MCP Server | Tool Name |',
        '| --- | --- |',
        '| `bad-server` | `health_check` |',
        '',
        '## Output Format',
        'JSON output.',
      ].join('\n'),
      '.mcp.json': JSON.stringify({
        servers: [{ name: 'qa-playwright-kit', command: 'node', args: [] }],
      }),
      'registry.ts': `export const TOOL_REGISTRY = [{ name: 'health_check', description: 'test' }];`,
    });

    try {
      const results = validateAgents({
        agentDir: fixtures.agentDir,
        mcpConfigPath: fixtures.mcpConfigPath,
        registryPath: fixtures.registryPath,
        fix: true,
      });

      // Server errors are not fixable, so they remain
      const serverErrors = results[0].errors.filter((e) => e.type === 'invalid-mcp-server');
      expect(serverErrors).toHaveLength(1);
      expect(serverErrors[0].fixable).toBe(false);
    } finally {
      fixtures.cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// Tests: Registry Tool Name Extraction
// ---------------------------------------------------------------------------

test.describe('Validator — Registry Tool Extraction', () => {
  test('extracts tool names from registry content', () => {
    const registryContent = `
      export const TOOL_REGISTRY = [
        { name: 'health_check', description: 'Check health' },
        { name: 'get_test_failures', description: 'Get failures' },
        { name: 'validate_requirement', description: 'Validate' },
      ];
    `;

    const tools = extractToolNamesFromRegistry(registryContent);
    expect(tools).toContain('health_check');
    expect(tools).toContain('get_test_failures');
    expect(tools).toContain('validate_requirement');
    expect(tools).toHaveLength(3);
  });

  test('handles double-quoted tool names', () => {
    const registryContent = `{ name: "my_tool", description: "A tool" }`;
    const tools = extractToolNamesFromRegistry(registryContent);
    expect(tools).toContain('my_tool');
  });
});

// ---------------------------------------------------------------------------
// Tests: Empty/Missing Directory
// ---------------------------------------------------------------------------

test.describe('Validator — Edge Cases', () => {
  test('returns empty results for non-existent agent directory', () => {
    const results = validateAgents({
      agentDir: '/nonexistent/path/agents',
      mcpConfigPath: '/nonexistent/.mcp.json',
      registryPath: '/nonexistent/registry.ts',
      fix: false,
    });

    expect(results).toHaveLength(0);
  });

  test('handles multiple agent files', () => {
    const fixtures = createTempFixtures({
      'agents/first.agent.md': [
        '# First Agent',
        '',
        '## Role',
        'First.',
        '',
        '## Input Format',
        'JSON.',
        '',
        '## MCP Dependencies',
        'None.',
        '',
        '## Output Format',
        'JSON.',
      ].join('\n'),
      'agents/second.agent.md': ['# Second Agent', '', '## Role', 'Second.'].join('\n'),
      '.mcp.json': JSON.stringify({ servers: [] }),
      'registry.ts': '',
    });

    try {
      const results = validateAgents({
        agentDir: fixtures.agentDir,
        mcpConfigPath: fixtures.mcpConfigPath,
        registryPath: fixtures.registryPath,
        fix: false,
      });

      expect(results).toHaveLength(2);
      // First file has no errors
      const firstResult = results.find((r) => r.file.includes('first'));
      expect(firstResult?.errors).toHaveLength(0);
      // Second file has missing sections
      const secondResult = results.find((r) => r.file.includes('second'));
      expect(secondResult!.errors.length).toBeGreaterThan(0);
    } finally {
      fixtures.cleanup();
    }
  });
});
