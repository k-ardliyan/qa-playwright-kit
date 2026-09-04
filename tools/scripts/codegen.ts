/**
 * Playwright Codegen CLI launcher.
 *
 * Reads BASE_URL and APP_ENV dynamically from active environment config.
 * Supports passing dynamic sub-paths, absolute URLs, and optional --role for saved auth state.
 *
 * Usage:
 *   npm run codegen
 *   npm run codegen -- /login
 *   npm run codegen -- /dashboard --role=admin
 *   npm run codegen -- https://other-domain.com
 *
 * Default route is AUTH_LOGIN_URL_PATH (fallback /login). Fails fast when
 * BASE_URL is unset and no absolute URL is passed.
 *
 * Codegen runner pin: recent Playwright bundled Chromium (build 1234 / v151)
 * intermittently paints a blank window on some Windows GPU driver stacks while
 * the DOM stays healthy (locators resolve, pixels don't). 1.58 (Chromium 145)
 * renders reliably, so it is the default runner here. Override with
 * CODEGEN_PW_VERSION: any semver (e.g. `1.61`), or `repo` to use the
 * repo-installed Playwright.
 */

import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { authStatePath, currentAppEnv } from '../../src/support/auth-paths';
import { resolveAppUrl } from '../../src/support/app-url';
import { loadEnvironment } from '../../src/utils/env-loader';
import { resolveAppEnv } from '../../src/utils/app-env';
import { logger } from '../../src/utils/logger';

const DEFAULT_CODEGEN_PW_VERSION = '1.58.0';

function main(): void {
  try {
    loadEnvironment();
  } catch (err) {
    logger.warn(`Failed to load environment file: ${(err as Error).message}`);
    // Keep APP_ENV/APP_ENV_SOURCE in sync with the pin so --role reads the right .auth/<env>/ dir
    process.env.APP_ENV = resolveAppEnv({ repoRoot: process.cwd() }).appEnv;
  }

  const rawArgs = process.argv.slice(2);
  let targetInput = '';
  let role = '';
  const passthroughArgs: string[] = [];

  for (let i = 0; i < rawArgs.length; i++) {
    const arg = rawArgs[i];
    if (arg.startsWith('--role=')) {
      role = arg.slice(7).trim();
    } else if (arg === '--role') {
      if (i + 1 < rawArgs.length && !rawArgs[i + 1].startsWith('-')) {
        role = rawArgs[i + 1].trim();
        i++;
      }
    } else if (!targetInput && !arg.startsWith('-')) {
      targetInput = arg.trim();
    } else {
      passthroughArgs.push(arg);
    }
  }

  const baseUrl = (process.env.BASE_URL ?? '').trim();
  if (!baseUrl && !/^https?:\/\//i.test(targetInput)) {
    logger.error(
      'BASE_URL is empty — set it in config/environments/<APP_ENV>.env, or pass an absolute URL.',
    );
    process.exit(1);
  }
  const targetUrl = resolveAppUrl(targetInput || process.env.AUTH_LOGIN_URL_PATH || '/login');

  const codegenPwVersion = (process.env.CODEGEN_PW_VERSION ?? DEFAULT_CODEGEN_PW_VERSION).trim();
  const usePinnedRunner = codegenPwVersion.length > 0 && codegenPwVersion !== 'repo';

  // Robust defaults: bypass SSL cert errors. Keep native codegen behavior otherwise.
  const codegenArgs: string[] = [];
  if (usePinnedRunner) {
    codegenArgs.push('-y');
  }
  codegenArgs.push(
    usePinnedRunner ? `playwright@${codegenPwVersion}` : 'playwright',
    'codegen',
    targetUrl,
    '--ignore-https-errors',
  );
  // ponytail: --block-service-workers was a hardcoded guess for blank-screen cache;
  // probes show this app renders fine without it. Opt-in via CODEGEN_BLOCK_SW=1, add
  // a per-app env default if some target truly needs it.
  if (process.env.CODEGEN_BLOCK_SW === '1') {
    codegenArgs.push('--block-service-workers');
  }

  if (role) {
    const env = currentAppEnv();
    const storageFile = authStatePath(role, env);
    const absStoragePath = path.resolve(process.cwd(), storageFile);

    if (fs.existsSync(absStoragePath)) {
      codegenArgs.push(`--load-storage=${absStoragePath}`);
      logger.info(`Using auth state for role "${role}" (${env}): ${storageFile}`);
    } else {
      logger.warn(`Auth state file not found: ${storageFile}. Running without stored session.`);
    }
  }

  codegenArgs.push(...passthroughArgs);

  logger.info(
    usePinnedRunner
      ? `Running codegen via playwright@${codegenPwVersion} (override: CODEGEN_PW_VERSION=repo)`
      : 'Running codegen via repo-installed playwright',
  );

  const isWin = process.platform === 'win32';
  const cmd = isWin ? 'npx.cmd' : 'npx';

  const child = spawn(cmd, codegenArgs, {
    stdio: 'inherit',
    shell: isWin,
  });

  child.on('error', (err) => {
    logger.error(`Failed to start playwright codegen: ${err.message}`);
    process.exit(1);
  });

  child.on('exit', (code) => {
    process.exit(code ?? 0);
  });
}

main();
