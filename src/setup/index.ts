/**
 * Setup Wizard — CLI entry point.
 *
 * Usage:
 *   npm run setup                   # Interactive setup
 *   npm run setup:check             # Validate existing setup
 *   npm run setup:staging           # Target specific environment
 *
 * @module src/setup
 */

import { parseArgs } from 'node:util';
import { runSetupWizard, type WizardOptions } from './wizard';
import { type AppEnv, isKnownAppEnv } from '../utils/app-env';
import { type WizardLang, isKnownLang } from './i18n';
import type { ChallengeMode } from '../support/human-challenge';
import { hasCriticalFailure } from './verify-setup';
import { EnvEncryptError } from '../utils/env-secrets';

function parseCliArgs() {
  return parseArgs({
    args: process.argv.slice(2),
    options: {
      check: { type: 'boolean', short: 'c', default: false },
      env: { type: 'string', short: 'e' },
      lang: { type: 'string', short: 'l' },
      'base-url': { type: 'string', short: 'u' },
      roles: { type: 'string', short: 'r' },
      challenge: { type: 'string' },
      yes: { type: 'boolean', short: 'y', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
    strict: true,
    allowPositionals: false,
  });
}

async function main(): Promise<void> {
  let parsed: ReturnType<typeof parseCliArgs>;

  try {
    parsed = parseCliArgs();
  } catch (err: unknown) {
    console.error(err instanceof Error ? err.message : String(err));
    printHelp();
    process.exit(1);
  }

  const { values } = parsed;

  if (values.help) {
    printHelp();
    process.exit(0);
  }

  const options: WizardOptions = {};

  if (values.check) {
    options.checkOnly = true;
  }

  if (values.env) {
    if (isKnownAppEnv(values.env)) {
      options.appEnv = values.env as AppEnv;
    } else {
      console.error(`Invalid APP_ENV: "${values.env}". Valid: local, dev, staging, production`);
      process.exit(1);
    }
  }

  if (values.lang) {
    if (isKnownLang(values.lang)) {
      options.lang = values.lang as WizardLang;
    } else {
      console.error(`Invalid language: "${values.lang}". Valid: id, en`);
      process.exit(1);
    }
  }

  if (values.yes) {
    options.headless = true;
  }

  if (values['base-url']) {
    options.baseUrl = values['base-url'];
  }

  if (values.roles) {
    options.roles = values.roles
      .split(',')
      .map((r) => r.trim())
      .filter(Boolean);
  }

  if (values.challenge) {
    const knownChallenges = ['none', 'auto', 'otp-browser', 'otp-stdin', 'captcha-browser'];
    if (knownChallenges.includes(values.challenge)) {
      options.challengeMode = values.challenge as ChallengeMode;
    } else {
      console.error(
        `Invalid challenge: "${values.challenge}". Valid: ${knownChallenges.join(', ')}`,
      );
      process.exit(1);
    }
  }

  try {
    const result = await runSetupWizard(options);

    if (!options.checkOnly) {
      if (!result.validation.valid || hasCriticalFailure(result.checks)) {
        console.warn('');
        console.warn(
          '⚠ Setup selesai dengan masalah / Setup finished with issues — see the verification checklist above.',
        );
        process.exit(1);
      }
    }
  } catch (err: unknown) {
    if (err instanceof Error && err.message === 'SETUP_WIZARD_CANCELLED') {
      console.log('');
      console.log(
        (options.lang ?? 'id') === 'en' ? 'Setup wizard cancelled.' : 'Setup wizard dibatalkan.',
      );
      process.exit(0);
    }
    console.error('Setup wizard failed:', err instanceof Error ? err.message : err);
    if (err instanceof EnvEncryptError && err.detail) {
      console.error(' ', err.detail);
    }
    process.exit(1);
  }
}

function printHelp(): void {
  console.log(`qa-playwright-kit setup — Setup wizard

Usage:
  npm run setup [options]

Options:
  --check, -c              Validate existing setup without prompting
  --env, -e <env>          Target environment (local|dev|staging|production)
  --lang, -l <lang>        Wizard language: id (default) | en
  --base-url, -u <url>     Application BASE_URL (headless/unattended)
  --roles, -r <roles>      Comma-separated roles, e.g. "admin,user"
  --challenge <mode>       Challenge mode: none|auto|otp-browser|otp-stdin|captcha-browser
  --yes, -y                Headless mode: proceed without interactive confirmation
  --help, -h               Show this help message

Examples:
  npm run setup                      # Interactive setup (Indonesian default)
  npm run setup --lang en            # Interactive setup in English
  npm run setup:check                # Validate current setup
  npm run setup:staging              # Setup for staging environment
  npm run setup -- -e dev -y         # Headless setup using existing env config
`);
}

main();
