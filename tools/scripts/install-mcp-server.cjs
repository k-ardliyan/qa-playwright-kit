/**
 * Install the MCP server workspace (tools/mcp) with the user's npm script
 * environment neutralized.
 *
 * Why this shim exists: when `npm run install:mcp-server` executes, npm
 * promotes every resolved config entry into the child env (npm_config_*).
 * A user-level `.npmrc` setting `allow-scripts=…` therefore leaks into the
 * child as `npm_config_allow_scripts`, and the child's `npm ci` reads it via
 * the config 'env' layer — which npm's allow-scripts RFC treats as CLI-level
 * policy and REJECTS for project-scoped installs (EALLOWSCRIPTS).
 *
 * This shim deletes the promoted env vars before delegating to npm ci, so the
 * allow-scripts policy resolves from .npmrc / package.json layers as intended.
 * CI keeps scripts enabled for dependency postinstalls; esbuild is approved
 * via package.json#allowScripts.
 *
 * @module tools/scripts/install-mcp-server
 */
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const mcpDir = path.join(__dirname, '..', '..', 'tools', 'mcp');

// Neutralize every npm-promoted allow-scripts entry (npm_config_allow_scripts,
// npm_config_allow-scripts, scoped variants) so the inner npm ci resolves
// policy from .npmrc / package.json layers only.
const env = { ...process.env };
for (const key of Object.keys(env)) {
  if (/^npm_config_allow[-_]scripts/i.test(key)) {
    delete env[key];
  }
}

const args = ['ci', '--no-audit', '--no-fund'];
// Resolve npm's own JS entry and run it with the current Node — spawning
// npm.cmd requires shell:true on Windows (EINVAL without it since Node 18.20)
// and fails with ENOENT where cmd.exe is not on PATH (hosts shipping their own
// Node). Same pattern as src/setup/spawn-bin.ts, which this file predates.
const npmCli = path.join(
  path.dirname(process.execPath),
  'node_modules',
  'npm',
  'bin',
  'npm-cli.js',
);
const result = spawnSync(process.execPath, [npmCli, ...args], {
  cwd: mcpDir,
  stdio: 'inherit',
  env,
  shell: false,
});
if (result.status === null) {
  console.error(
    `[install-mcp-server] npm did not start: ${result.error?.message ?? 'unknown spawn error'}`,
  );
}
process.exit(result.status ?? 1);
