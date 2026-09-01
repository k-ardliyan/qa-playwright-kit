/// <reference types="node" />

// env-loader adapter overlay: non-overriding adapter defaults after core load

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadEnvironment } from '../../utils/env-loader';

function withTempFixture(fn: (root: string) => void): void {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'env-loader-adapter-'));
  try {
    fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function runCase(label: string, assertFn: () => void): void {
  try {
    assertFn();
    process.stdout.write(`✓ ${label}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stdout.write(`✗ ${label}\n   ${message}\n`);
    process.exitCode = 1;
  }
}

runCase('adapter overlay fills AUTH keys from .env.example', () => {
  withTempFixture((root) => {
    const previousCwd = process.cwd();
    const savedEnv: Record<string, string | undefined> = {
      APP_ENV: process.env.APP_ENV,
      AUTH_SUCCESS_URL_PATH: process.env.AUTH_SUCCESS_URL_PATH,
      BASE_URL: process.env.BASE_URL,
    };

    try {
      fs.mkdirSync(path.join(root, 'config', 'environments'), { recursive: true });
      fs.writeFileSync(
        path.join(root, 'config', 'environments', 'local.env'),
        'BASE_URL=https://core.example/\n',
        'utf8',
      );

      const adapterDir = path.join(root, 'adapter', 'environments');
      fs.mkdirSync(adapterDir, { recursive: true });
      fs.writeFileSync(
        path.join(adapterDir, 'demo.env.example'),
        'AUTH_SUCCESS_URL_PATH=/dashboard\nAUTH_LOGIN_URL_PATH=login\n',
        'utf8',
      );

      process.chdir(root);
      delete process.env.APP_ENV;
      delete process.env.AUTH_SUCCESS_URL_PATH;
      process.env.BASE_URL = 'https://preset.example/';

      loadEnvironment({
        adapterEnv: { dir: 'adapter/environments', name: 'demo' },
      });

      assert.equal(process.env.AUTH_SUCCESS_URL_PATH, '/dashboard');
      assert.equal(process.env.AUTH_LOGIN_URL_PATH, 'login');
      assert.equal(process.env.BASE_URL, 'https://preset.example/');
    } finally {
      process.chdir(previousCwd);
      for (const [key, value] of Object.entries(savedEnv)) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    }
  });
});

runCase('core credentials win over adapter overlay keys', () => {
  withTempFixture((root) => {
    const previousCwd = process.cwd();
    const savedEnv: Record<string, string | undefined> = {
      APP_ENV: process.env.APP_ENV,
      AUTH_SUCCESS_URL_PATH: process.env.AUTH_SUCCESS_URL_PATH,
    };

    try {
      fs.mkdirSync(path.join(root, 'config', 'environments'), { recursive: true });
      fs.writeFileSync(
        path.join(root, 'config', 'environments', 'local.env'),
        'AUTH_SUCCESS_URL_PATH=/from-core\n',
        'utf8',
      );

      const adapterDir = path.join(root, 'adapter', 'environments');
      fs.mkdirSync(adapterDir, { recursive: true });
      fs.writeFileSync(
        path.join(adapterDir, 'demo.env.example'),
        'AUTH_SUCCESS_URL_PATH=/from-adapter\n',
        'utf8',
      );

      process.chdir(root);
      delete process.env.APP_ENV;
      delete process.env.AUTH_SUCCESS_URL_PATH;

      loadEnvironment({
        adapterEnv: { dir: 'adapter/environments', name: 'demo' },
      });

      assert.equal(process.env.AUTH_SUCCESS_URL_PATH, '/from-core');
    } finally {
      process.chdir(previousCwd);
      for (const [key, value] of Object.entries(savedEnv)) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    }
  });
});

if (!process.exitCode) {
  process.stdout.write('✓ Property: env-loader adapter overlay\n');
}

if (process.exitCode) {
  process.exit(process.exitCode);
}
