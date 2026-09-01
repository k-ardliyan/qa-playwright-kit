/**
 * Unit tests for src/setup/verify-setup.ts — real artifact checks.
 * The decrypt roundtrip test spawns the real dotenvx CLI with an isolated
 * HOME (same pattern as env-secrets.test.ts) — never touches real keys.
 */
import { test, expect } from '@playwright/test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { hasCriticalFailure, verifySetupArtifacts } from '@/setup/verify-setup';
import { encryptSecretKeysInFile } from '@/utils/env-secrets';

function makeRepo(opts: { withNodeModules?: boolean; envContent?: string }): string {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-setup-'));
  fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({ name: 'verify-fixture' }));
  fs.mkdirSync(path.join(tmp, 'config', 'environments'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'playwright.config.ts'), '// fixture config\n', 'utf-8');
  if (opts.withNodeModules) {
    fs.mkdirSync(path.join(tmp, 'node_modules', '@playwright', 'test'), { recursive: true });
  }
  if (opts.envContent !== undefined) {
    fs.writeFileSync(path.join(tmp, 'config', 'environments', 'dev.env'), opts.envContent, 'utf-8');
  }
  return tmp;
}

const PLAINTEXT_ENV = [
  'BASE_URL=http://localhost:3000',
  'HEADLESS=true',
  'TEST_USER_EMAIL=qa@kit.example',
  'TEST_USER_PASSWORD=s3cret-valid',
  '',
].join('\n');

function baseOpts(repoRoot: string, overrides: Record<string, unknown> = {}) {
  return {
    repoRoot,
    appEnv: 'dev' as const,
    envPath: path.join(repoRoot, 'config', 'environments', 'dev.env'),
    envMap: { BASE_URL: 'http://localhost:3000', PLAYWRIGHT_CONFIG: 'playwright.config.ts' },
    roles: ['user'],
    lang: 'id' as const,
    loginRequirementPath: 'requirements/login.md',
    ...overrides,
  };
}

test('missing deps is a critical fail with npm install fix', () => {
  const repo = makeRepo({ envContent: PLAINTEXT_ENV });
  try {
    const checks = verifySetupArtifacts(baseOpts(repo));
    const deps = checks.find((c) => c.id === 'deps')!;
    expect(deps.status).toBe('fail');
    expect(deps.critical).toBe(true);
    expect(deps.fix).toBe('npm install');
    expect(hasCriticalFailure(checks)).toBe(true);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('plaintext env: file passes, secrets warn, no decrypt roundtrip needed', () => {
  const repo = makeRepo({ withNodeModules: true, envContent: PLAINTEXT_ENV });
  try {
    const checks = verifySetupArtifacts(baseOpts(repo));
    const envFile = checks.find((c) => c.id === 'env_file')!;
    expect(envFile.status).toBe('pass');
    const secrets = checks.find((c) => c.id === 'env_secrets_encrypted')!;
    expect(secrets.status).toBe('warn');
    expect(secrets.detail).toContain('TEST_USER_PASSWORD');
    expect(checks.find((c) => c.id === 'decrypt_roundtrip')).toBeUndefined();
    expect(checks.find((c) => c.id === 'keys_file')!.status).toBe('pass');
    expect(hasCriticalFailure(checks)).toBe(false);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('missing env file / BASE_URL is a critical fail', () => {
  const repo = makeRepo({ withNodeModules: true });
  try {
    const checks = verifySetupArtifacts(baseOpts(repo, { envMap: {} }));
    expect(checks.find((c) => c.id === 'env_file')!.status).toBe('fail');
    expect(hasCriticalFailure(checks)).toBe(true);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('missing artifacts (login.md, skills, mcp, auth files) warn with fix hints', () => {
  const repo = makeRepo({ withNodeModules: true, envContent: PLAINTEXT_ENV });
  try {
    const checks = verifySetupArtifacts(baseOpts(repo));
    for (const id of ['login_requirement', 'skills_synced', 'mcp_configs', 'auth_files']) {
      const check = checks.find((c) => c.id === id)!;
      expect(check.status, id).toBe('warn');
      expect(check.fix, `${id} must carry a fix hint`).toBeTruthy();
    }
    expect(hasCriticalFailure(checks)).toBe(false);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('present artifacts pass: skills, mcp configs, auth file, login requirement', () => {
  const repo = makeRepo({ withNodeModules: true, envContent: PLAINTEXT_ENV });
  try {
    fs.mkdirSync(path.join(repo, 'requirements'), { recursive: true });
    fs.writeFileSync(path.join(repo, 'requirements', 'login.md'), '# REQ', 'utf-8');
    fs.mkdirSync(path.join(repo, '.agents', 'skills', 'qa-playwright-kit'), { recursive: true });
    fs.writeFileSync(path.join(repo, '.agents', 'skills', 'qa-playwright-kit', 'SKILL.md'), 'x');
    fs.mkdirSync(path.join(repo, '.cursor'), { recursive: true });
    fs.writeFileSync(path.join(repo, '.cursor', 'mcp.json'), '{}');
    fs.mkdirSync(path.join(repo, '.kiro'), { recursive: true });
    fs.writeFileSync(path.join(repo, '.kiro', 'mcp.json'), '{}');
    fs.mkdirSync(path.join(repo, '.codex'), { recursive: true });
    fs.writeFileSync(path.join(repo, '.codex', 'config.toml'), 'x');
    fs.writeFileSync(path.join(repo, 'claude_desktop_config.json'), '{}');
    fs.mkdirSync(path.join(repo, '.auth', 'dev'), { recursive: true });
    fs.writeFileSync(path.join(repo, '.auth', 'dev', 'user.json'), '{}');

    const checks = verifySetupArtifacts(baseOpts(repo));
    for (const id of ['login_requirement', 'skills_synced', 'mcp_configs', 'auth_files']) {
      expect(checks.find((c) => c.id === id)!.status, id).toBe('pass');
    }
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('real decrypt roundtrip passes after genuine dotenvx encryption', () => {
  const repo = makeRepo({ withNodeModules: true, envContent: PLAINTEXT_ENV });
  const savedHome = process.env.HOME;
  const savedProfile = process.env.USERPROFILE;
  const originalCwd = process.cwd();
  const savedPrivate: Record<string, string | undefined> = {};
  for (const key of Object.keys(process.env)) {
    if (key.startsWith('DOTENV_PRIVATE_KEY')) savedPrivate[key] = process.env[key];
  }
  try {
    process.env.HOME = repo;
    process.env.USERPROFILE = repo;
    process.chdir(repo);
    const envPath = path.join(repo, 'config', 'environments', 'dev.env');
    encryptSecretKeysInFile(envPath, { repoRoot: repo });

    const checks = verifySetupArtifacts(baseOpts(repo));
    const roundtrip = checks.find((c) => c.id === 'decrypt_roundtrip')!;
    expect(roundtrip).toBeDefined();
    expect(roundtrip.status).toBe('pass');
    expect(checks.find((c) => c.id === 'env_secrets_encrypted')!.status).toBe('pass');
    expect(checks.find((c) => c.id === 'keys_file')!.status).toBe('pass');
    expect(hasCriticalFailure(checks)).toBe(false);
  } finally {
    process.chdir(originalCwd);
    if (savedHome === undefined) delete process.env.HOME;
    else process.env.HOME = savedHome;
    if (savedProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = savedProfile;
    for (const key of Object.keys(process.env)) {
      if (key.startsWith('DOTENV_PRIVATE_KEY') && !(key in savedPrivate)) {
        delete process.env[key];
      }
    }
    for (const [key, val] of Object.entries(savedPrivate)) {
      if (val === undefined) delete process.env[key];
      else process.env[key] = val;
    }
    fs.rmSync(repo, { recursive: true, force: true });
  }
});
