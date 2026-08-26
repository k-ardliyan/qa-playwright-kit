/**
 * Setup Wizard — CLI entry point.
 *
 * Usage:
 *   npm run setup                   # Interactive setup
 *   npm run setup:check             # Validate existing setup
 *   npm run setup -- --env staging  # Target specific environment
 *
 * @module src/setup
 */

import { runSetupWizard, type WizardOptions } from './wizard';
import { type AppEnv, isKnownAppEnv } from '../utils/app-env';

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  const options: WizardOptions = {};

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];

    if (arg === '--check' || arg === '-c') {
      options.checkOnly = true;
    } else if ((arg === '--env' || arg === '-e') && args[i + 1]) {
      const envValue = args[i + 1];
      if (isKnownAppEnv(envValue)) {
        options.appEnv = envValue as AppEnv;
      } else {
        console.error(`Invalid APP_ENV: "${envValue}". Valid: local, dev, staging, production`);
        process.exit(1);
      }
      i += 1; // skip next arg
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else {
      console.error(`Unknown option: ${arg}`);
      printHelp();
      process.exit(1);
    }
  }

  try {
    const result = await runSetupWizard(options);

    if (!result.validation.valid && !options.checkOnly) {
      console.warn('');
      console.warn('⚠ Setup completed with validation issues. See summary above.');
      process.exit(1);
    }
  } catch (err: unknown) {
    if (err instanceof Error && err.message === 'SETUP_WIZARD_CANCELLED') {
      console.log('');
      console.log('Setup wizard cancelled.');
      process.exit(0);
    }
    console.error('Setup wizard failed:', err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

function printHelp(): void {
  console.log(`
qa-playwright-kit setup — Interactive setup wizard

Usage:
  npm run setup [options]

Options:
  --check, -c          Validate existing setup without prompting
  --env, -e <env>      Target environment (local|dev|staging|production)
  --help, -h           Show this help message

Examples:
  npm run setup                      # Interactive setup
  npm run setup:check                # Validate current setup
  npm run setup -- --env staging     # Setup for staging environment
`);
}

main();
