/// <reference types="node" />

/**
 * Regression: plaintext config/environments/{APP_ENV}.env must load even
 * when dotenvx private keys are missing (CI materializes plaintext secrets).
 * Encrypted primaries without keys fail fast — never load the dummy template.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadEnvironment } from '../../utils/env-loader';
import { logger } from '../../utils/logger';
import {
  isPlaceholderBaseUrl,
  isPlaceholderCredential,
  isRoleLoginReady,
  roleCredentialKeys,
} from '../../shared/utils/role-credentials';

type LoggerMethod = (message: string, metadata?: Record<string, unknown>) => void;

function withTempRepo(
  files: Record<string, string>,
  run: () => void,
  env: Record<string, string | undefined> = {},
): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'env-loader-ci-'));
  const originalCwd = process.cwd();
  const saved: Record<string, string | undefined> = {
    APP_ENV: process.env.APP_ENV,
    APP_ENV_SOURCE: process.env.APP_ENV_SOURCE,
    BASE_URL: process.env.BASE_URL,
    TEST_USER_EMAIL: process.env.TEST_USER_EMAIL,
    TEST_USER_PASSWORD: process.env.TEST_USER_PASSWORD,
    DOTENV_PRIVATE_KEY: process.env.DOTENV_PRIVATE_KEY,
    CI: process.env.CI,
  };

  try {
    fs.mkdirSync(path.join(dir, 'config', 'environments'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'package.json'),
      JSON.stringify({ name: 'env-loader-ci-fixture' }),
      'utf8',
    );
    for (const [rel, content] of Object.entries(files)) {
      const full = path.join(dir, rel);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, content, 'utf8');
    }

    delete process.env.APP_ENV;
    delete process.env.APP_ENV_SOURCE;
    delete process.env.BASE_URL;
    delete process.env.TEST_USER_EMAIL;
    delete process.env.TEST_USER_PASSWORD;
    delete process.env.DOTENV_PRIVATE_KEY;
    delete process.env.DOTENV_PRIVATE_KEY_STAGING;
    delete process.env.DOTENV_PRIVATE_KEY_STAGINGDEVELOPMENT;
    delete process.env.CI;

    for (const [k, v] of Object.entries(env)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }

    process.chdir(dir);
    run();
  } finally {
    process.chdir(originalCwd);
    fs.rmSync(dir, { recursive: true, force: true });
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

function main(): void {
  // 1) Plaintext CI file + no keys → keep real BASE_URL (do NOT fall back to example)
  withTempRepo(
    {
      'config/environments/staging.env':
        'BASE_URL=https://ci-real.example.com/\nTEST_USER_EMAIL=ci@example.com\nTEST_USER_PASSWORD=s3cret-valid\n',
      'config/environments/staging.env.example':
        'BASE_URL=https://staging.your-app.example.com/\nTEST_USER_EMAIL=test@example.com\nTEST_USER_PASSWORD=your_password_here\n',
    },
    () => {
      const warnings: string[] = [];
      const originalWarn = logger.warn.bind(logger) as LoggerMethod;
      logger.warn = ((message: string) => {
        warnings.push(message);
      }) as LoggerMethod;

      try {
        loadEnvironment();
        assert.equal(process.env.APP_ENV, 'staging');
        assert.equal(process.env.BASE_URL, 'https://ci-real.example.com/');
        assert.equal(process.env.TEST_USER_EMAIL, 'ci@example.com');
        assert.equal(
          warnings.some((m) => m.includes('Falling back to dummy template')),
          false,
          `unexpected fallback warnings: ${warnings.join(' | ')}`,
        );
        assert.equal(isPlaceholderBaseUrl(process.env.BASE_URL), false);
        assert.equal(
          isRoleLoginReady(process.env as Record<string, string>, roleCredentialKeys('user')),
          true,
        );
      } finally {
        logger.warn = originalWarn;
      }
    },
    { APP_ENV: 'staging', CI: 'true' },
  );
  process.stdout.write('✓ plaintext CI env loads without decryption keys\n');

  // 2) Encrypted primary + no keys → fail fast with actionable guidance
  withTempRepo(
    {
      'config/environments/staging.env':
        'BASE_URL=encrypted:BA+84DBdeadbeef\nTEST_USER_PASSWORD=encrypted:BA+84DBdeadbeef\nAPP_ENV=should-not-win\n',
      'config/environments/staging.env.example':
        'BASE_URL=https://staging.your-app.example.com/\nTEST_USER_PASSWORD=your_password_here\nAPP_ENV=should-not-win\n',
    },
    () => {
      assert.throws(
        () => loadEnvironment(),
        /no dotenvx private key is available/,
        'encrypted env without keys must throw, not load the dummy template',
      );
      // The throw happens before dotenvx.config — template values must not leak into env
      assert.equal(process.env.APP_ENV, 'staging');
      assert.equal(process.env.BASE_URL, undefined);
    },
    { APP_ENV: 'staging', CI: 'true' },
  );
  process.stdout.write('✓ encrypted env without keys fails fast (no dummy template)\n');

  // 3) Pure unit: placeholder detectors
  assert.equal(isPlaceholderCredential('your_password_here'), true);
  assert.equal(isPlaceholderCredential('test@example.com'), true);
  assert.equal(isPlaceholderCredential('real-qa-pass-9'), false);
  assert.equal(isPlaceholderBaseUrl('https://staging.your-app.example.com/'), true);
  assert.equal(isPlaceholderBaseUrl('https://erp.example.org/'), false);
  process.stdout.write('✓ placeholder detectors\n');

  process.stdout.write('✓ env-loader CI plaintext guard regression passed\n');
}

main();
