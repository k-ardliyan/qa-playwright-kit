/// <reference types="node" />

import path from 'node:path';
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { EXIT } from '../scripts/exit-codes';
import { printOk, printWarn, printError } from '../scripts/format-error';
import {
  getGlobalKeysPath,
  migrateWorkspaceEnvKeys,
  resolveProjectName,
} from '../../src/utils/dotenv-keys';

const CHECKS: Array<{ label: string; path: string; hint: string }> = [
  {
    label: '.mcp.json (project MCP config)',
    path: '.mcp.json',
    hint: 'ensure .mcp.json exists at the project root for Claude/Codex MCP detection',
  },
  {
    label: '@playwright/mcp',
    path: path.join('node_modules', '@playwright', 'mcp'),
    hint: 'npm install @playwright/mcp',
  },
  {
    label: '@playwright/test',
    path: path.join('node_modules', '@playwright', 'test'),
    hint: 'npm install',
  },
  {
    label: 'qa-playwright-kit MCP build',
    path: path.join('mcp-server', 'dist', 'index-mcp.js'),
    hint: 'npm run mcp:build',
  },
  {
    label: 'requirements template',
    path: path.join('requirements', '_TEMPLATE.md'),
    hint: 'restore requirements/_TEMPLATE.md from repo',
  },
  {
    label: 'Orchestrator agent (AGENTS.md)',
    path: 'AGENTS.md',
    hint: 'restore root AGENTS.md from repo',
  },
  {
    label: 'project fixture seam',
    path: path.join('src', 'fixtures', 'project.fixture.ts'),
    hint: 'restore src/fixtures/project.fixture.ts from repo',
  },
  {
    label: 'QA guide',
    path: path.join('docs', 'GUIDE.md'),
    hint: 'restore docs/GUIDE.md from repo',
  },
  {
    label: 'tests/data fixture bank (file upload/download)',
    path: path.join('tests', 'data', 'README.md'),
    hint: 'restore tests/data/ from repo (fixture-first uploads)',
  },
  {
    label: 'file content helpers',
    path: path.join('src', 'support', 'pw', 'files.ts'),
    hint: 'restore src/support/pw/files.ts from repo',
  },
  {
    label: 'network assert helpers',
    path: path.join('src', 'support', 'pw', 'network-assert.ts'),
    hint: 'restore src/support/pw/network-assert.ts from repo',
  },
];

function checkPlaywrightTestVersion(): void {
  const pkgPath = path.join(process.cwd(), 'node_modules', '@playwright', 'test', 'package.json');
  if (!fs.existsSync(pkgPath)) {
    return;
  }

  const version = (JSON.parse(fs.readFileSync(pkgPath, 'utf-8')) as { version?: string }).version;
  if (!version) {
    printWarn('Could not read version of @playwright/test');
    return;
  }

  const [major, minor] = version.split('.').map(Number);
  if (major < 1 || (major === 1 && minor < 56)) {
    printWarn(`@playwright/test ${version} — playwright-test MCP butuh >= 1.56`);
    process.stdout.write('  💡 Fix: npm install @playwright/test@latest\n');
  } else {
    printOk(`@playwright/test version (${version}) - OK (>= 1.56)`);
  }
}

function checkEnvironmentFile(): void {
  const appEnv = process.env.APP_ENV ?? 'local';
  const primary = path.join('environments', `${appEnv}.env`);
  const fallback = path.join('environments', `${appEnv}.env.example`);

  if (fs.existsSync(primary)) {
    printOk(`Environment file (environments/${appEnv}.env) - OK`);
    return;
  }
  if (fs.existsSync(fallback)) {
    printOk(`Fallback environment file (environments/${appEnv}.env.example) - OK`);
    process.stdout.write('  ℹ Salin ke environments/local.env lalu isi BASE_URL + kredensial\n');
    return;
  }

  printWarn(`No environments/${appEnv}.env atau .env.example`);
  process.stdout.write(`  💡 Fix: cp environments/local.env.example environments/${appEnv}.env\n`);
}

function checkOptionalWorkspaceMcpConfig(): void {
  const workspaceConfig = path.join(process.cwd(), '.vscode', 'mcp.json');
  if (!fs.existsSync(workspaceConfig)) {
    process.stdout.write(
      '  ℹ .vscode/mcp.json not found — OK kalau tooling baca .mcp.json dari root\n',
    );
  } else {
    printOk('.vscode/mcp.json (workspace MCP config) - OK');
  }
}

function loadPrivateKeysFromFile(keysPath: string): void {
  if (!fs.existsSync(keysPath)) return;
  for (const raw of fs.readFileSync(keysPath, 'utf-8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const eq = line.indexOf('=');
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (key.startsWith('DOTENV_PRIVATE_KEY')) {
      process.env[key] = val;
    }
  }
}

function isEncryptedEnv(filePath: string): boolean {
  return fs.readFileSync(filePath, 'utf-8').includes('encrypted:');
}

function migrateKeys(): void {
  const cwd = process.cwd();
  const projectName = resolveProjectName(cwd);
  const globalPath = getGlobalKeysPath(cwd);
  try {
    const results = migrateWorkspaceEnvKeys(cwd);
    const any = results.some((r) => r.migrated);
    const added = results.reduce((n, r) => n + r.added, 0);
    if (any) {
      printOk(
        `Keys digabung ke ~/.dotenvx-keys/${projectName}/.env.keys` +
          (added > 0 ? ` (+${added} private key baru)` : ' (tidak ada key baru)'),
      );
    }
    // Load into process for subsequent decrypt verify
    loadPrivateKeysFromFile(globalPath);
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    printWarn(`Failed to secure keys: ${errMsg}`);
  }
}

function verifyDecrypt(filePath: string): boolean {
  try {
    // load any keys produced next to the file before migrate
    for (const p of [
      path.join('environments', '.env.keys'),
      path.join(process.cwd(), '.env.keys'),
      getGlobalKeysPath(process.cwd()),
    ]) {
      loadPrivateKeysFromFile(p);
    }
    execSync(`npx @dotenvx/dotenvx decrypt -f "${filePath}" --stdout --quiet`, {
      stdio: 'pipe',
      env: process.env,
    });
    return true;
  } catch {
    return false;
  }
}

function autoEncryptEnvFiles(): void {
  const envsDir = path.resolve(process.cwd(), 'environments');
  if (!fs.existsSync(envsDir)) {
    return;
  }

  const files = fs.readdirSync(envsDir);
  const envFiles = files.filter(
    (f) => f.endsWith('.env') && !f.endsWith('.env.example') && !f.endsWith('.env.keys'),
  );

  if (envFiles.length === 0) {
    return;
  }

  process.stdout.write('Securing and verifying environment file encryption...\n');
  for (const file of envFiles) {
    const filePath = path.join('environments', file);
    try {
      // Prefer encrypt without forcing -fk (avoids keypair mismatch on new files)
      execSync(`npx @dotenvx/dotenvx encrypt -f "${filePath}" --quiet`, {
        stdio: 'pipe',
        env: process.env,
      });
      migrateKeys();
      if (isEncryptedEnv(filePath) && verifyDecrypt(filePath)) {
        printOk(`${filePath} - Encrypted & decrypt-verified`);
      } else if (isEncryptedEnv(filePath)) {
        printWarn(`${filePath} encrypted but decrypt verify failed — cek keys di ~/.dotenvx-keys/`);
      } else {
        printWarn(`${filePath} still plaintext after encrypt attempt`);
      }
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      printWarn(`Failed to encrypt ${filePath}: ${errMsg}`);
    }
  }
  // Final sweep for any leftover workspace keys
  migrateKeys();
  process.stdout.write('\n');
}

function main(): void {
  let failed = false;

  process.stdout.write('Running setup checks...\n\n');

  // Auto-encrypt any plaintext secrets edited by users/QA before running checks
  autoEncryptEnvFiles();

  // Auto-build qa-playwright-kit MCP server if the build is missing
  const mcpBuildPath = path.resolve(process.cwd(), 'mcp-server', 'dist', 'index-mcp.js');
  if (!fs.existsSync(mcpBuildPath)) {
    process.stdout.write('qa-playwright-kit MCP build missing. Attempting to build...\n');
    try {
      execSync('npm run mcp:build', { stdio: 'inherit' });
      printOk('Build completed successfully.\n');
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      printWarn(`Failed to auto-build MCP server: ${errMsg}. Setup check might fail.`);
    }
  }

  for (const check of CHECKS) {
    const absolute = path.resolve(process.cwd(), check.path);
    if (!fs.existsSync(absolute)) {
      printError({
        title: `Missing ${check.label}`,
        detail: `Expected path: ${check.path}`,
        hint: `Fix: ${check.hint}`,
        exitCode: EXIT.FIXABLE,
      });
      failed = true;
    } else {
      printOk(`${check.label} - OK`);
    }
  }

  checkPlaywrightTestVersion();
  checkEnvironmentFile();
  checkOptionalWorkspaceMcpConfig();

  process.stdout.write('\n');
  if (failed) {
    printError({
      title: 'Setup check gagal',
      detail: 'Satu atau lebih check essential gagal di atas.',
      hint: 'Perbaiki yang gagal lalu jalankan ulang: npm run setup:check',
      docsLink: 'docs/GUIDE.md#setup-lokal',
      exitCode: EXIT.FIXABLE,
    });
    process.exit(EXIT.FIXABLE);
  } else {
    printOk('Semua essential check passed. Lanjut ke: npm run validate:requirement');
  }
}

main();
