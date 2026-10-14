/// <reference types="node" />

// Feature: agent-ai-integration-layer, Property 6: MCP config generation preserves all servers
// Feature: agent-ai-integration-layer, Property 7: Configuration drift detection
//
// **Validates: Requirements 3.6, 3.7**

import assert from 'node:assert/strict';
import fc from 'fast-check';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  generateConfig,
  detectDrift,
  computeSourceHash,
  transformCopilot,
  getOutputPath,
} from '../../agents/pipeline/mcp-config-generator';
import type { McpServerDefinition, Platform } from '../../agents/pipeline/mcp-config-generator';

// ─── Arbitraries ──────────────────────────────────────────────────────────────

const serverNameArb = fc
  .string({ minLength: 1, maxLength: 20 })
  .filter((s) => /^[a-z][a-z0-9-]*$/.test(s));

const serverDefArb = fc.record({
  name: serverNameArb,
  command: fc.constantFrom('node', 'npx', 'tsx', 'python'),
  args: fc.array(fc.string({ minLength: 1, maxLength: 30 }), { minLength: 0, maxLength: 5 }),
});

const serversArb = fc
  .array(serverDefArb, { minLength: 1, maxLength: 5 })
  .filter((arr) => new Set(arr.map((s) => s.name)).size === arr.length); // unique names

// ─── Helpers ──────────────────────────────────────────────────────────────────

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-config-test-'));
}

function cleanupTempDir(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

function writeSourceConfig(dir: string, servers: McpServerDefinition[]): string {
  const configPath = path.join(dir, '.mcp.json');
  const content = JSON.stringify({ servers }, null, 2);
  fs.writeFileSync(configPath, content, 'utf-8');
  return configPath;
}

// ─── Property 6: MCP config generation preserves all servers ──────────────────

async function testProperty6(): Promise<void> {
  await fc.assert(
    fc.asyncProperty(serversArb, async (servers) => {
      const tmpDir = createTempDir();

      try {
        // Write a temporary source .mcp.json
        const sourceConfigPath = writeSourceConfig(tmpDir, servers);
        const hash = computeSourceHash(sourceConfigPath);

        // Generate configs for all platforms
        generateConfig({
          sourceConfigPath,
          outputDir: tmpDir,
        });

        // Verify generated platforms (claude, cursor, kiro) contain all servers
        const generatedPlatforms: Platform[] = ['claude', 'cursor', 'kiro'];

        for (const platform of generatedPlatforms) {
          const outputPath = getOutputPath(platform, tmpDir);
          assert.ok(
            fs.existsSync(outputPath),
            `Config file should exist for platform "${platform}" at ${outputPath}`,
          );

          const content = fs.readFileSync(outputPath, 'utf-8');
          const parsed = JSON.parse(content);

          // All generated platforms use { mcpServers: { name: { command, args } } }
          assert.ok(parsed.mcpServers, `Platform "${platform}" should have mcpServers key`);

          for (const server of servers) {
            assert.ok(
              server.name in parsed.mcpServers,
              `Platform "${platform}" should contain server "${server.name}"`,
            );

            const serverConfig = parsed.mcpServers[server.name];
            assert.equal(
              serverConfig.command,
              server.command,
              `Platform "${platform}", server "${server.name}" command should match`,
            );
            assert.deepEqual(
              serverConfig.args,
              server.args,
              `Platform "${platform}", server "${server.name}" args should match`,
            );
          }

          // Verify the number of servers matches exactly
          const serverNames = Object.keys(parsed.mcpServers);
          assert.equal(
            serverNames.length,
            servers.length,
            `Platform "${platform}" should have exactly ${servers.length} servers`,
          );
        }

        // Also verify Copilot transformer directly (format: { _sourceHash, servers: [...] })
        const copilotResult = transformCopilot(servers, hash) as {
          _sourceHash: string;
          servers: Array<{ name: string; command: string; args: string[] }>;
        };

        assert.equal(copilotResult._sourceHash, hash, 'Copilot _sourceHash should match');
        assert.equal(
          copilotResult.servers.length,
          servers.length,
          'Copilot servers array should have all servers',
        );

        for (const server of servers) {
          const found = copilotResult.servers.find((s) => s.name === server.name);
          assert.ok(found, `Copilot output should contain server "${server.name}"`);
          assert.equal(
            found!.command,
            server.command,
            `Copilot server "${server.name}" command should match`,
          );
          assert.deepEqual(
            found!.args,
            server.args,
            `Copilot server "${server.name}" args should match`,
          );
        }
      } finally {
        cleanupTempDir(tmpDir);
      }
    }),
    { numRuns: 100 },
  );

  console.log('  ✓ Property 6 passed: MCP config generation preserves all servers');
}

// ─── Property 7: Configuration drift detection ───────────────────────────────

async function testProperty7(): Promise<void> {
  // Arbitrary for generating a modification to the source config
  const modificationArb = fc.oneof(
    // Add a new server
    serverDefArb.map((newServer) => ({ type: 'add' as const, server: newServer })),
    // Change args of an existing server
    fc
      .array(fc.string({ minLength: 1, maxLength: 20 }), { minLength: 1, maxLength: 3 })
      .map((newArgs) => ({ type: 'changeArgs' as const, args: newArgs })),
  );

  await fc.assert(
    fc.asyncProperty(serversArb, modificationArb, async (servers, modification) => {
      const tmpDir = createTempDir();

      try {
        // Step 1: Write initial source config
        const sourceConfigPath = writeSourceConfig(tmpDir, servers);

        // Step 2: Generate configs for all platforms
        generateConfig({
          sourceConfigPath,
          outputDir: tmpDir,
        });

        // Step 3: Modify the source config
        let modifiedServers: McpServerDefinition[];

        if (modification.type === 'add') {
          // Add a new server (ensure unique name)
          const existingNames = new Set(servers.map((s) => s.name));
          if (existingNames.has(modification.server.name)) {
            // Make the name unique by appending a suffix
            modifiedServers = [
              ...servers,
              { ...modification.server, name: modification.server.name + 'x' },
            ];
          } else {
            modifiedServers = [...servers, modification.server];
          }
        } else {
          // Change args of the first server
          modifiedServers = servers.map((s, i) =>
            i === 0 ? { ...s, args: modification.args } : s,
          );
        }

        // Write modified config
        writeSourceConfig(tmpDir, modifiedServers);

        // Verify the source actually changed (hash comparison)
        const newHash = computeSourceHash(sourceConfigPath);
        const generatedContent = fs.readFileSync(getOutputPath('claude', tmpDir), 'utf-8');
        const generatedParsed = JSON.parse(generatedContent);
        const oldHash = generatedParsed._sourceHash;

        // Only assert drift if the hash actually changed
        if (newHash !== oldHash) {
          // Step 4: Detect drift
          const driftResult = detectDrift({
            sourceConfigPath,
            outputDir: tmpDir,
          });

          // Step 5: All generated platforms should be outdated
          const generatedPlatforms: Platform[] = ['claude', 'cursor', 'kiro'];

          for (const platform of generatedPlatforms) {
            assert.ok(
              driftResult.outdated.includes(platform),
              `Platform "${platform}" should be reported as outdated after source modification`,
            );
          }
        }
      } finally {
        cleanupTempDir(tmpDir);
      }
    }),
    { numRuns: 100 },
  );

  console.log('  ✓ Property 7 passed: configuration drift detection');
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('MCP Config Generator Property Tests');
  console.log('──────────────────────────────────────────');

  await testProperty6();
  await testProperty7();

  console.log('──────────────────────────────────────────');
  console.log('✓ All MCP config generator property tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
