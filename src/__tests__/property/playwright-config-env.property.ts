/// <reference types="node" />

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadEnvironment } from '../../utils/env-loader';
import {
  buildPlaywrightSharedDefaults,
  resolveHeadless,
  resolveSlowMo,
} from '../../../config/playwright/base';

function withTempEnvFile(
  contents: string,
  run: (envPath: string) => void | Promise<void>,
): Promise<void> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-config-env-'));
  const envPath = path.join(dir, 'local.env');
  fs.writeFileSync(envPath, contents, 'utf8');

  const previousAppEnv = process.env.APP_ENV;
  const previousSlowMo = process.env.SLOW_MO;
  const previousHeadless = process.env.HEADLESS;
  const previousBaseUrl = process.env.BASE_URL;
  const previousCi = process.env.CI;

  delete process.env.APP_ENV;
  delete process.env.SLOW_MO;
  delete process.env.HEADLESS;
  delete process.env.BASE_URL;
  delete process.env.CI;

  const originalCwd = process.cwd();
  process.chdir(dir);

  fs.mkdirSync(path.join(dir, 'config', 'environments'), { recursive: true });
  fs.copyFileSync(envPath, path.join(dir, 'config', 'environments', 'local.env'));

  return Promise.resolve()
    .then(() => run(envPath))
    .finally(() => {
      process.chdir(originalCwd);
      fs.rmSync(dir, { recursive: true, force: true });

      if (previousAppEnv === undefined) {
        delete process.env.APP_ENV;
      } else {
        process.env.APP_ENV = previousAppEnv;
      }
      if (previousSlowMo === undefined) {
        delete process.env.SLOW_MO;
      } else {
        process.env.SLOW_MO = previousSlowMo;
      }
      if (previousHeadless === undefined) {
        delete process.env.HEADLESS;
      } else {
        process.env.HEADLESS = previousHeadless;
      }
      if (previousBaseUrl === undefined) {
        delete process.env.BASE_URL;
      } else {
        process.env.BASE_URL = previousBaseUrl;
      }
      if (previousCi === undefined) {
        delete process.env.CI;
      } else {
        process.env.CI = previousCi;
      }
    });
}

async function main(): Promise<void> {
  await withTempEnvFile('SLOW_MO=800\nHEADLESS=false\nBASE_URL=https://app.example/\n', () => {
    loadEnvironment();
    assert.equal(resolveSlowMo(), 800);
    assert.equal(resolveHeadless(), false);

    const defaults = buildPlaywrightSharedDefaults();
    assert.equal(defaults.use?.baseURL, 'https://app.example/');
    assert.equal(defaults.use?.headless, false);
    assert.deepEqual(defaults.use?.launchOptions, { slowMo: 800 });
  });
  process.stdout.write('✓ env loaded before resolvers read SLOW_MO, HEADLESS, BASE_URL\n');

  await withTempEnvFile('SLOW_MO=800\n', () => {
    process.env.CI = 'true';
    loadEnvironment();
    assert.equal(resolveSlowMo(), 0);

    const defaults = buildPlaywrightSharedDefaults();
    assert.equal(defaults.use?.launchOptions?.slowMo, 0);
  });
  process.stdout.write('✓ CI forces SLOW_MO to 0\n');

  await withTempEnvFile('SLOW_MO=not-a-number\nHEADLESS=maybe\n', () => {
    loadEnvironment();
    assert.equal(resolveSlowMo(), 0);
    assert.equal(resolveHeadless(), true);
  });
  process.stdout.write('✓ invalid SLOW_MO and HEADLESS fall back to defaults\n');

  const previousCiForSlowMo = process.env.CI;
  delete process.env.CI;
  process.env.SLOW_MO = '500';
  assert.equal(resolveSlowMo(), 500);
  delete process.env.SLOW_MO;
  if (previousCiForSlowMo === undefined) {
    delete process.env.CI;
  } else {
    process.env.CI = previousCiForSlowMo;
  }
  process.stdout.write('✓ resolveSlowMo reads process.env when already loaded\n');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
