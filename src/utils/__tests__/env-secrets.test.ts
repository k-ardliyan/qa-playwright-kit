/**
 * Isolated dotenvx encrypt/decrypt roundtrip.
 * HOME/USERPROFILE pointed at tmp so we never touch ~/.dotenvx-keys/qa-playwright-kit.
 */
import { test, expect } from '@playwright/test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  encryptSecretKeysInFile,
  decryptEnvFileToText,
  normalizeDotenvxBanner,
} from '../env-secrets';
import { getGlobalKeysPath } from '../dotenv-keys';

function writeFixtureEnv(tmp: string): string {
  fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({ name: 'env-secrets-fixture' }));
  const envDir = path.join(tmp, 'config', 'environments');
  fs.mkdirSync(envDir, { recursive: true });
  const envPath = path.join(envDir, 'dev.env');
  fs.writeFileSync(
    envPath,
    [
      'BASE_URL=https://dev.kit.example',
      'HEADLESS=true',
      'TEST_USER_EMAIL=qa@kit.example',
      'TEST_USER_PASSWORD=s3cret-valid',
      '',
    ].join('\n'),
    'utf-8',
  );
  return envPath;
}

function withIsolatedHome(fn: (tmp: string, envPath: string) => void): void {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'env-secrets-'));
  const savedHome = process.env.HOME;
  const savedProfile = process.env.USERPROFILE;
  const originalCwd = process.cwd();
  const savedPrivate: Record<string, string | undefined> = {};
  for (const key of Object.keys(process.env)) {
    if (key.startsWith('DOTENV_PRIVATE_KEY')) savedPrivate[key] = process.env[key];
  }

  try {
    const envPath = writeFixtureEnv(tmp);
    process.env.HOME = tmp;
    process.env.USERPROFILE = tmp;
    process.chdir(tmp);
    fn(tmp, envPath);
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
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

test('encryptSecretKeysInFile encrypts password only; decrypt roundtrips', () => {
  withIsolatedHome((tmp, envPath) => {
    const result = encryptSecretKeysInFile(envPath, { repoRoot: tmp });
    expect(result.skipped).toBe(false);
    expect(result.encryptedKeys).toEqual(['TEST_USER_PASSWORD']);

    const onDisk = fs.readFileSync(envPath, 'utf-8');
    expect(onDisk).toContain('BASE_URL=https://dev.kit.example');
    expect(onDisk).toContain('HEADLESS=true');
    expect(onDisk).toContain('TEST_USER_EMAIL=qa@kit.example');
    expect(onDisk).toMatch(/TEST_USER_PASSWORD=encrypted:/);
    expect(onDisk).not.toContain('s3cret-valid');
    // dotenvx cosmetic banner is normalized away after encrypt
    expect(onDisk).not.toMatch(/^#\//m);
    expect(onDisk).not.toContain('# -fk');
    expect(onDisk).toMatch(/^DOTENV_PUBLIC_KEY_/m);

    const keysPath = getGlobalKeysPath(tmp);
    const plain = decryptEnvFileToText(envPath, { repoRoot: tmp, keysPath });
    expect(plain).toContain('TEST_USER_PASSWORD=s3cret-valid');
    expect(plain).toContain('BASE_URL=https://dev.kit.example');
  });
});

test('stale DOTENV_PRIVATE_KEY_* in process.env does not poison encrypt pairing', () => {
  withIsolatedHome((tmp, envPath) => {
    // Reproduce the production failure: leftover private key for the same
    // env-name slug, different material than what dotenvx will mint.
    process.env.DOTENV_PRIVATE_KEY_DEVDEVELOPMENT = 'deadbeef-not-a-real-private-key';

    const result = encryptSecretKeysInFile(envPath, { repoRoot: tmp });
    expect(result.skipped).toBe(false);

    const onDisk = fs.readFileSync(envPath, 'utf-8');
    expect(onDisk).toMatch(/TEST_USER_PASSWORD=encrypted:/);
    expect(onDisk).not.toContain('s3cret-valid');

    const keysPath = getGlobalKeysPath(tmp);
    const plain = decryptEnvFileToText(envPath, { repoRoot: tmp, keysPath });
    expect(plain).toContain('TEST_USER_PASSWORD=s3cret-valid');
  });
});

test('normalizeDotenvxBanner keeps the public key, strips box/-fk/basename noise', () => {
  const input = [
    '#/-------------------[DOTENV_PUBLIC_KEY]--------------------/',
    '#/            public-key encryption for .env files          /',
    '#/       [how it works](https://dotenvx.com/encryption)     /',
    '#/----------------------------------------------------------/',
    'DOTENV_PUBLIC_KEY_DEVDEVELOPMENT="02fc" # -fk ..\\..\\Users\\kardl\\.dotenvx-keys\\.env.keys',
    '',
    '# dev.env',
    '# regular comment stays',
    'BASE_URL=http://x',
  ].join('\n');

  const out = normalizeDotenvxBanner(input, 'dev.env');
  expect(out).not.toContain('#/');
  expect(out).not.toContain('-fk');
  expect(out).not.toContain('# dev.env');
  expect(out).toContain('DOTENV_PUBLIC_KEY_DEVDEVELOPMENT="02fc"');
  expect(out).toContain('# regular comment stays');
  expect(out).toContain('BASE_URL=http://x');
});
