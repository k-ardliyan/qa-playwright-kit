/// <reference types="node" />

// Feature: agent-ai-integration-layer, Property 12: Validator missing section detection
// Feature: agent-ai-integration-layer, Property 13: Validator invalid MCP reference detection
// Feature: agent-ai-integration-layer, Property 14: Validator auto-fix correctness
//
// **Validates: Requirements 6.2, 6.3, 6.4, 6.5, 6.7**

import assert from 'node:assert/strict';
import fc from 'fast-check';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { validateAgentFile } from '../../agents/integration/validator';

// ─── Constants ────────────────────────────────────────────────────────────────

const REQUIRED_SECTIONS = ['Role', 'Input Format', 'MCP Dependencies', 'Output Format'];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function createTestEnv(
  servers: string[],
  tools: string[],
): { dir: string; mcpPath: string; registryPath: string; agentDir: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'validator-test-'));
  const mcpPath = path.join(dir, '.mcp.json');
  const registryPath = path.join(dir, 'registry.ts');
  const agentDir = path.join(dir, 'agents');

  fs.mkdirSync(agentDir, { recursive: true });
  fs.writeFileSync(
    mcpPath,
    JSON.stringify({
      servers: servers.map((s) => ({ name: s, command: 'node', args: [] })),
    }),
  );
  fs.writeFileSync(
    registryPath,
    tools.map((t) => `  { name: '${t}', server: 'test', description: 'test tool' }`).join('\n'),
  );

  return { dir, mcpPath, registryPath, agentDir };
}

function cleanupTestEnv(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

function buildMarkdown(sections: string[]): string {
  let md = '# Test Agent\n\n';
  for (const section of sections) {
    md += `## ${section}\n\nSome content here.\n\n`;
  }
  return md;
}

// ─── Arbitraries ──────────────────────────────────────────────────────────────

// Generate a random subset of sections to INCLUDE (leaving others missing)
const sectionSubsetArb = fc.subarray(REQUIRED_SECTIONS, { minLength: 0, maxLength: 3 });

// Generate valid-looking server names (hyphenated lowercase)
const serverNameArb = fc
  .tuple(fc.stringMatching(/^[a-f]{2,6}$/), fc.stringMatching(/^[g-l]{2,6}$/))
  .map(([a, b]) => `${a}-${b}`);

// Generate valid-looking tool names (snake_case with underscores)
const toolNameArb = fc
  .tuple(fc.stringMatching(/^[a-f]{2,6}$/), fc.stringMatching(/^[g-l]{2,6}$/))
  .map(([a, b]) => `${a}_${b}`);

// ─── Property 12: Validator missing section detection ─────────────────────────

async function testProperty12(): Promise<void> {
  await fc.assert(
    fc.asyncProperty(sectionSubsetArb, async (includedSections) => {
      const missingSections = REQUIRED_SECTIONS.filter((s) => !includedSections.includes(s));

      // Only test when there ARE missing sections
      if (missingSections.length === 0) return;

      const env = createTestEnv(['qa-playwright-kit'], ['get_test_summary']);

      try {
        const markdown = buildMarkdown(includedSections);
        const agentFile = path.join(env.agentDir, 'test.agent.md');
        fs.writeFileSync(agentFile, markdown, 'utf-8');

        const result = validateAgentFile(agentFile, {
          agentDir: env.agentDir,
          mcpConfigPath: env.mcpPath,
          registryPath: env.registryPath,
          fix: false,
        });

        // For each missing section, there should be an error with type 'missing-section'
        for (const section of missingSections) {
          const matchingError = result.errors.find(
            (e) => e.type === 'missing-section' && e.message.includes(section),
          );
          assert.ok(
            matchingError,
            `Expected a 'missing-section' error for '${section}', but none found. Errors: ${JSON.stringify(result.errors)}`,
          );
          assert.equal(
            matchingError!.fixable,
            true,
            `Missing section error for '${section}' should be marked as fixable`,
          );
        }

        // The number of missing-section errors should match the number of missing sections
        const missingSectionErrors = result.errors.filter((e) => e.type === 'missing-section');
        assert.equal(
          missingSectionErrors.length,
          missingSections.length,
          `Expected ${missingSections.length} missing-section errors, got ${missingSectionErrors.length}`,
        );
      } finally {
        cleanupTestEnv(env.dir);
      }
    }),
    { numRuns: 100 },
  );

  console.log('  ✓ Property 12 passed: validator missing section detection');
}

// ─── Property 13: Validator invalid MCP reference detection ───────────────────
//
// Tool registry checks apply only to rows whose Server column is `qa-playwright-kit`
// (see extractMcpToolReferences). Other servers (playwright, playwright-test, …)
// may list tools that are not in mcp-server TOOL_REGISTRY and must not flag
// invalid-mcp-tool. Invalid server names are still always reported.

async function testProperty13(): Promise<void> {
  await fc.assert(
    fc.asyncProperty(
      fc.array(serverNameArb, { minLength: 0, maxLength: 2 }),
      fc.array(toolNameArb, { minLength: 1, maxLength: 3 }),
      serverNameArb,
      toolNameArb,
      toolNameArb,
      async (extraServers, validTools, invalidServer, invalidTool, foreignTool) => {
        // qa-playwright-kit is the only server whose tools are registry-validated
        const validServers = [
          'qa-playwright-kit',
          ...extraServers.filter((s) => s !== 'qa-playwright-kit' && s !== invalidServer),
        ];

        // Ensure the invalid references are not accidentally valid
        if (
          validServers.includes(invalidServer) ||
          validTools.includes(invalidTool) ||
          validTools.includes(foreignTool) ||
          invalidTool === foreignTool
        ) {
          return;
        }

        const env = createTestEnv(validServers, validTools);

        try {
          // Build markdown with an MCP Dependencies table that exercises:
          // - valid qa-playwright-kit tool (no error)
          // - invalid tool on qa-playwright-kit → invalid-mcp-tool
          // - invalid server → invalid-mcp-server (tool column ignored for registry)
          // - optional other known server + unregistered tool → no invalid-mcp-tool
          let md = '# Test Agent\n\n';
          md += '## Role\n\nTest role.\n\n';
          md += '## Input Format\n\nTest input.\n\n';
          md += '## MCP Dependencies\n\n';
          md += '| Server | Tool | Purpose |\n';
          md += '|--------|------|--------|\n';
          md += `| \`qa-playwright-kit\` | \`${validTools[0]}\` | Valid qa-playwright-kit tool |\n`;
          md += `| \`qa-playwright-kit\` | \`${invalidTool}\` | Bad qa-playwright-kit tool |\n`;
          md += `| \`${invalidServer}\` | \`${invalidTool}\` | Bad server reference |\n`;
          if (extraServers.length > 0) {
            const otherServer = extraServers.find(
              (s) => s !== 'qa-playwright-kit' && s !== invalidServer,
            );
            if (otherServer) {
              md += `| \`${otherServer}\` | \`${foreignTool}\` | Other server — not registry-checked |\n`;
            }
          }
          md += '\n## Output Format\n\nTest output.\n\n';

          const agentFile = path.join(env.agentDir, 'test.agent.md');
          fs.writeFileSync(agentFile, md, 'utf-8');

          const result = validateAgentFile(agentFile, {
            agentDir: env.agentDir,
            mcpConfigPath: env.mcpPath,
            registryPath: env.registryPath,
            fix: false,
          });

          // Should have an error for the invalid server reference
          const serverErrors = result.errors.filter(
            (e) => e.type === 'invalid-mcp-server' && e.message.includes(invalidServer),
          );
          assert.ok(
            serverErrors.length > 0,
            `Expected an 'invalid-mcp-server' error for '${invalidServer}', got none. Errors: ${JSON.stringify(result.errors)}`,
          );

          // Invalid tool on qa-playwright-kit must produce invalid-mcp-tool
          const toolErrors = result.errors.filter(
            (e) => e.type === 'invalid-mcp-tool' && e.message.includes(invalidTool),
          );
          assert.ok(
            toolErrors.length > 0,
            `Expected an 'invalid-mcp-tool' error for '${invalidTool}' on qa-playwright-kit, got none. Errors: ${JSON.stringify(result.errors)}`,
          );

          // Unregistered tools on non-qa-playwright-kit servers must NOT be flagged
          const foreignToolErrors = result.errors.filter(
            (e) => e.type === 'invalid-mcp-tool' && e.message.includes(foreignTool),
          );
          assert.equal(
            foreignToolErrors.length,
            0,
            `Tools on non-qa-playwright-kit servers must not produce invalid-mcp-tool for '${foreignTool}'. Errors: ${JSON.stringify(result.errors)}`,
          );

          // Each reported server/tool error should have a line number
          for (const err of [...serverErrors, ...toolErrors]) {
            assert.ok(
              typeof err.line === 'number' && err.line > 0,
              `Error should have a positive line number, got: ${err.line}`,
            );
          }
        } finally {
          cleanupTestEnv(env.dir);
        }
      },
    ),
    { numRuns: 100 },
  );

  console.log('  ✓ Property 13 passed: validator invalid MCP reference detection');
}

// ─── Property 14: Validator auto-fix correctness ──────────────────────────────

async function testProperty14(): Promise<void> {
  await fc.assert(
    fc.asyncProperty(sectionSubsetArb, async (includedSections) => {
      const missingSections = REQUIRED_SECTIONS.filter((s) => !includedSections.includes(s));

      // Only test when there ARE missing sections to fix
      if (missingSections.length === 0) return;

      const env = createTestEnv(['qa-playwright-kit'], ['get_test_summary']);

      try {
        const markdown = buildMarkdown(includedSections);
        const agentFile = path.join(env.agentDir, 'test.agent.md');
        fs.writeFileSync(agentFile, markdown, 'utf-8');

        // Run validator with fix: true
        validateAgentFile(agentFile, {
          agentDir: env.agentDir,
          mcpConfigPath: env.mcpPath,
          registryPath: env.registryPath,
          fix: true,
        });

        // Read the file back and validate again WITHOUT fix
        const revalidation = validateAgentFile(agentFile, {
          agentDir: env.agentDir,
          mcpConfigPath: env.mcpPath,
          registryPath: env.registryPath,
          fix: false,
        });

        // The missing-section errors should no longer exist
        const remainingMissingSectionErrors = revalidation.errors.filter(
          (e) => e.type === 'missing-section',
        );
        assert.equal(
          remainingMissingSectionErrors.length,
          0,
          `After fix, expected no missing-section errors but got ${remainingMissingSectionErrors.length}: ${JSON.stringify(remainingMissingSectionErrors)}`,
        );

        // Verify that the file now contains all required sections
        const fixedContent = fs.readFileSync(agentFile, 'utf-8');
        for (const section of missingSections) {
          assert.ok(
            fixedContent.includes(`## ${section}`),
            `Fixed file should contain '## ${section}' but it doesn't`,
          );
        }
      } finally {
        cleanupTestEnv(env.dir);
      }
    }),
    { numRuns: 100 },
  );

  console.log('  ✓ Property 14 passed: validator auto-fix correctness');
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('Validator Property Tests');
  console.log('──────────────────────────────────────────');

  await testProperty12();
  await testProperty13();
  await testProperty14();

  console.log('──────────────────────────────────────────');
  console.log('✓ All validator property tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
