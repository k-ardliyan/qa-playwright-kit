/// <reference types="node" />

// Feature: playwright-ai-agent-framework, Property 4: Environment Fallback Behavior

import assert from 'node:assert/strict';
import fc from 'fast-check';
import { loadEnvironment } from '../../utils/env-loader';
import { logger } from '../../utils/logger';

const KNOWN = new Set(['local', 'dev', 'staging', 'production']);

type LoggerMethod = (message: string, metadata?: Record<string, unknown>) => void;

async function main(): Promise<void> {
  await fc.assert(
    fc.asyncProperty(
      fc.stringMatching(/^[A-Za-z0-9_-]{1,20}$/).filter((value) => !KNOWN.has(value)),
      async (unknownEnv) => {
        const previousAppEnv = process.env.APP_ENV;
        const previousSource = process.env.APP_ENV_SOURCE;

        const warnings: string[] = [];
        const infos: string[] = [];

        const originalWarn = logger.warn.bind(logger) as LoggerMethod;
        const originalInfo = logger.info.bind(logger) as LoggerMethod;

        logger.warn = ((message: string) => {
          warnings.push(message);
        }) as LoggerMethod;

        logger.info = ((message: string) => {
          infos.push(message);
        }) as LoggerMethod;

        process.env.APP_ENV = unknownEnv;

        try {
          loadEnvironment();

          assert.equal(
            warnings.some((msg) => msg.includes('unrecognised value')),
            true,
          );
          assert.equal(
            warnings.some((msg) => msg.includes(unknownEnv)),
            true,
          );
          assert.equal(
            infos.some((msg) => msg.includes("Loaded environment 'local'")),
            true,
          );
          assert.equal(
            infos.some((msg) => msg.includes('config/environments/local.env')),
            true,
          );
          assert.equal(process.env.APP_ENV, 'local');
          assert.equal(process.env.APP_ENV_SOURCE, 'invalid_os');
        } finally {
          logger.warn = originalWarn;
          logger.info = originalInfo;

          if (previousAppEnv === undefined) {
            delete process.env.APP_ENV;
          } else {
            process.env.APP_ENV = previousAppEnv;
          }
          if (previousSource === undefined) {
            delete process.env.APP_ENV_SOURCE;
          } else {
            process.env.APP_ENV_SOURCE = previousSource;
          }
        }
      },
    ),
    { numRuns: 24 },
  );

  // Unset APP_ENV → pin (if present) or default local; never warn "APP_ENV is not set"
  {
    const previousAppEnv = process.env.APP_ENV;
    const previousSource = process.env.APP_ENV_SOURCE;
    const previousCi = process.env.CI;
    delete process.env.APP_ENV;
    delete process.env.APP_ENV_SOURCE;
    delete process.env.CI;

    const warnings: string[] = [];
    const infos: string[] = [];
    const originalWarn = logger.warn.bind(logger) as LoggerMethod;
    const originalInfo = logger.info.bind(logger) as LoggerMethod;
    logger.warn = ((message: string) => {
      warnings.push(message);
    }) as LoggerMethod;
    logger.info = ((message: string) => {
      infos.push(message);
    }) as LoggerMethod;

    try {
      loadEnvironment();
      assert.equal(
        warnings.some((msg) => msg.includes('APP_ENV is not set')),
        false,
      );
      // Without OS APP_ENV: pin wins when present (local-only), else default=local
      const source = process.env.APP_ENV_SOURCE;
      assert.ok(source === 'default' || source === 'pin', `unexpected source: ${source}`);
      if (source === 'default') {
        assert.equal(process.env.APP_ENV, 'local');
        assert.equal(
          infos.some(
            (msg) =>
              msg.includes('Using default APP_ENV=local') ||
              msg.includes("Loaded environment 'local'"),
          ),
          true,
        );
      } else {
        // pin — APP_ENV must be a known profile from config/environments/.active-env
        assert.ok(
          process.env.APP_ENV && KNOWN.has(process.env.APP_ENV),
          `pinned APP_ENV not known: ${process.env.APP_ENV}`,
        );
        assert.equal(
          infos.some(
            (msg) =>
              msg.includes(
                `Using APP_ENV=${process.env.APP_ENV} from config/environments/.active-env`,
              ) || msg.includes(`Loaded environment '${process.env.APP_ENV}'`),
          ),
          true,
        );
      }
    } finally {
      logger.warn = originalWarn;
      logger.info = originalInfo;
      if (previousAppEnv === undefined) delete process.env.APP_ENV;
      else process.env.APP_ENV = previousAppEnv;
      if (previousSource === undefined) delete process.env.APP_ENV_SOURCE;
      else process.env.APP_ENV_SOURCE = previousSource;
      if (previousCi === undefined) delete process.env.CI;
      else process.env.CI = previousCi;
    }
  }

  console.log('✓ Property 4 passed: env loader fallback behavior');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
