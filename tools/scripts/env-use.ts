/// <reference types="node" />
/**
 * env-use — Pin active APP_ENV for local work (config/environments/.active-env).
 *
 * Usage:
 *   npm run env:use
 *   npm run env:use:dev
 *   npm run env:use:staging
 *   npm run env:use:production
 *   npm run env:use:local
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import prompts from 'prompts';
import {
  isKnownAppEnv,
  writeActiveEnvPin,
  type AppEnv,
  KNOWN_APP_ENVS,
  getEnvironmentsDir,
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
    npm run env:use
    npm run env:use:local
    npm run env:use:dev
    npm run env:use:staging
    npm run env:use:production

  Then:
    npm run env:status
    npm run auth:setup
    # OTP/CAPTCHA: npm run auth:setup:headed
    # restart MCP servers (qa-playwright-kit / playwright-test)

`);
}

async function pickAppEnv(): Promise<string | null> {
  if (!process.stdin.isTTY) return null;
  process.stdout.write('\n');
  KNOWN_APP_ENVS.forEach((env, i) => {
    process.stdout.write(`  ${i + 1}. ${env}\n`);
  });
  const { value } = await prompts({
    type: 'text',
    name: 'value',
    message: `Pilih environment — ketik angka 1-${KNOWN_APP_ENVS.length} lalu Enter`,
    initial: '1',
    validate: (raw: string) => {
      const n = Number(String(raw).trim());
      if (!Number.isInteger(n) || n < 1 || n > KNOWN_APP_ENVS.length) {
        return `Masukkan angka 1-${KNOWN_APP_ENVS.length}`;
      }
      return true;
    },
  });
  if (value == null) return null;
  const n = Number(String(value).trim());
  return KNOWN_APP_ENVS[n - 1] ?? null;
}

async function main(): Promise<void> {
  const parsed = parseArgs();
  if (parsed.help) {
    printHelp();
    process.exit(EXIT.OK);
  }

  let appEnv = parsed.appEnv;
  if (!appEnv) {
    appEnv = await pickAppEnv();
  }
  if (!appEnv) {
    printHelp();
    process.exit(EXIT.USAGE);
  }

  if (!isKnownAppEnv(appEnv)) {
    printError({
      title: 'Unknown environment',
      detail: `"${appEnv}" is not a valid APP_ENV.`,
      hint: `Use: npm run env:use:local | env:use:dev | env:use:staging | env:use:production`,
      exitCode: EXIT.USAGE,
    });
    process.exit(EXIT.USAGE);
  }

  const env = appEnv as AppEnv;
  if (env === 'production' && !parsed.iKnow) {
    printError({
      title: 'Production pin blocked',
      detail: 'Pinning production requires npm run env:use:production (alias includes --i-know).',
      hint: 'Jalankan: npm run env:use:production',
      exitCode: EXIT.USAGE,
    });
    process.exit(EXIT.USAGE);
  }

  const envDir = getEnvironmentsDir(ROOT);
  const envFile = path.join(envDir, `${env}.env`);
  const exampleFile = path.join(envDir, `${env}.env.example`);
  const init = parsed.init || process.env.ENV_USE_INIT === '1';

  if (!fs.existsSync(envFile)) {
    if (init && fs.existsSync(exampleFile)) {
      fs.copyFileSync(exampleFile, envFile);
      printOk(`Created ${path.relative(ROOT, envFile).replace(/\\/g, '/')} from .example`);
      printWarn('Fill credentials (npm run env:edit) then encrypt before committing anything.');
    } else {
      const relEnv = path.relative(ROOT, envFile).replace(/\\/g, '/');
      const relExample = path.relative(ROOT, exampleFile).replace(/\\/g, '/');
      printError({
        title: `Missing ${relEnv}`,
        detail: fs.existsSync(exampleFile)
          ? `Template exists at ${relExample}`
          : `No file or example for ${env}`,
        hint: fs.existsSync(exampleFile)
          ? `cp ${relExample} ${relEnv}  lalu: npm run env:use:${env}`
          : `Create ${relExample} first`,
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

main().catch((e) => {
  process.stderr.write(`Fatal: ${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(EXIT.ESCALATE);
});
