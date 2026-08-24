/// <reference types="node" />
/**
 * env-use — Pin active APP_ENV for local work (environments/.active-env).
 *
 * Usage:
 *   npm run env:use -- dev
 *   npm run env:use -- staging
 *   npm run env:use -- production --i-know
 *   npm run env:use -- dev --init
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  isKnownAppEnv,
  writeActiveEnvPin,
  type AppEnv,
  KNOWN_APP_ENVS,
} from '../../src/utils/app-env';
import { EXIT } from './exit-codes';
import { printError, printOk, printWarn, printInfo } from './format-error';

const ROOT = process.cwd();

function parseArgs(): { appEnv: string | null; iKnow: boolean; init: boolean; help: boolean } {
  const args = process.argv.slice(2);
  let appEnv: string | null = null;
  let iKnow = false;
  let init = false;
  let help = false;
  for (const a of args) {
    if (a === '--help' || a === '-h') help = true;
    else if (a === '--i-know') iKnow = true;
    else if (a === '--init') init = true;
    else if (!a.startsWith('-') && !appEnv) appEnv = a.trim();
  }
  return { appEnv, iKnow, init, help };
}

function printHelp(): void {
  process.stdout.write(`
  env:use — Pin active environment profile (local only; CI ignores pin)

  Usage:
    npm run env:use -- <local|dev|staging|production>
    npm run env:use -- production --i-know
    npm run env:use -- staging --init   # copy from .example if missing

  Then:
    npm run env:status
    npm run auth:setup
    # OTP/CAPTCHA: npm run auth:setup:headed
    # restart MCP servers (qa-playwright-kit / playwright-test)

`);
}

function main(): void {
  const { appEnv, iKnow, init, help } = parseArgs();
  if (help || !appEnv) {
    printHelp();
    process.exit(help ? EXIT.OK : EXIT.USAGE);
  }

  if (!isKnownAppEnv(appEnv)) {
    printError({
      title: 'Unknown environment',
      detail: `"${appEnv}" is not a valid APP_ENV.`,
      hint: `Use one of: ${KNOWN_APP_ENVS.join(', ')}`,
      exitCode: EXIT.USAGE,
    });
    process.exit(EXIT.USAGE);
  }

  const env = appEnv as AppEnv;
  if (env === 'production' && !iKnow) {
    printError({
      title: 'Production pin blocked',
      detail: 'Pinning production requires explicit confirmation.',
      hint: 'Re-run: npm run env:use -- production --i-know',
      exitCode: EXIT.USAGE,
    });
    process.exit(EXIT.USAGE);
  }

  const envFile = path.join(ROOT, 'environments', `${env}.env`);
  const exampleFile = path.join(ROOT, 'environments', `${env}.env.example`);

  if (!fs.existsSync(envFile)) {
    if (init && fs.existsSync(exampleFile)) {
      fs.copyFileSync(exampleFile, envFile);
      printOk(`Created environments/${env}.env from .example`);
      printWarn('Fill credentials (npm run env:edit) then encrypt before committing anything.');
    } else {
      printError({
        title: `Missing environments/${env}.env`,
        detail: fs.existsSync(exampleFile)
          ? `Template exists at environments/${env}.env.example`
          : `No file or example for ${env}`,
        hint: fs.existsSync(exampleFile)
          ? `npm run env:use -- ${env} --init   # or: cp environments/${env}.env.example environments/${env}.env`
          : `Create environments/${env}.env.example first`,
        exitCode: EXIT.FIXABLE,
      });
      process.exit(EXIT.FIXABLE);
    }
  }

  const pinPath = writeActiveEnvPin(ROOT, env);
  printOk(`Pinned APP_ENV=${env}`);
  printInfo(`Pin file: ${path.relative(ROOT, pinPath)}`);
  process.stdout.write('\n  Next:\n');
  process.stdout.write('    1. npm run env:status\n');
  process.stdout.write('    2. npm run auth:setup\n');
  process.stdout.write('       (OTP/CAPTCHA: npm run auth:setup:headed)\n');
  process.stdout.write(
    '    3. Restart MCP servers (qa-playwright-kit / playwright-test) in Hermes\n\n',
  );
  process.stdout.write(
    '  Note: APP_ENV=… npm test still overrides this pin. CI ignores the pin.\n\n',
  );
  process.exit(EXIT.OK);
}

main();
