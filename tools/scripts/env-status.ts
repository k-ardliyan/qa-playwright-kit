/// <reference types="node" />
/**
 * env-status — Show active APP_ENV, source, file, roles (no secrets).
 * Canonical path: config/environments/{APP_ENV}.env
 *
 * Usage: npm run env:status
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { resolveAppEnv } from '../../src/utils/app-env';
import { getGlobalKeysPath, migrateWorkspaceEnvKeys } from '../../src/utils/dotenv-keys';
import {
  parseRolesFromEnvMap,
  parseEnvText,
  isEncryptedEnvText,
  isRoleLoginReady,
  hasDefaultUserCredentials,
  resolveLoginIdentifier,
} from './env-edit-lib';
import { EXIT } from './exit-codes';
import { printError, printOk, printWarn } from './format-error';

const ROOT = process.cwd();

function maskHost(baseUrl: string): string {
  try {
    const u = new URL(baseUrl);
    return `${u.protocol}//${u.host}${u.pathname === '/' ? '/' : u.pathname}`;
  } catch {
    return baseUrl.slice(0, 60);
  }
}

function main(): void {
  const resolved = resolveAppEnv({ repoRoot: ROOT });
  const envPath = resolved.filePath;
  const examplePath = `${envPath}.example`;
  const exists = fs.existsSync(envPath);
  const exampleExists = fs.existsSync(examplePath);

  process.stdout.write('\n  Environment status\n');
  process.stdout.write('  ─────────────────\n');
  process.stdout.write(`  APP_ENV   = ${resolved.appEnv}\n`);
  process.stdout.write(`  source    = ${resolved.source}\n`);
  process.stdout.write(
    `  file      = config/environments/${resolved.appEnv}.env` +
      (exists ? '' : exampleExists ? ' (missing — example exists)' : ' (MISSING)') +
      '\n',
  );

  if (exists) {
    const raw = fs.readFileSync(envPath, 'utf8');
    const encrypted = isEncryptedEnvText(raw);
    process.stdout.write(`  encrypted = ${encrypted ? 'yes' : 'no (plaintext)'}\n`);
  }

  try {
    migrateWorkspaceEnvKeys(ROOT);
  } catch {
    // non-fatal
  }
  const keysPath = getGlobalKeysPath(ROOT);
  const keysOk = fs.existsSync(keysPath);
  process.stdout.write(
    `  keys      = ${keysOk ? `ok (${keysPath})` : 'missing — see docs/CREDENTIALS.md'}\n`,
  );

  let baseUrl = '(unknown)';
  let roles: string[] = [];

  if (exists) {
    try {
      // Always load env profile so challenge/HEADLESS/roles reflect active file
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { loadEnvironment } = require('../../src/utils/env-loader') as {
          loadEnvironment: () => void;
        };
        loadEnvironment();
      } catch {
        // non-fatal — may lack keys for encrypted files
      }

      if (process.env.BASE_URL) {
        baseUrl = maskHost(process.env.BASE_URL);
      } else {
        const map = parseEnvText(fs.readFileSync(envPath, 'utf8'));
        if (map.BASE_URL?.startsWith('encrypted:')) {
          baseUrl = '(encrypted — set keys or run after decrypt)';
        } else if (map.BASE_URL) {
          baseUrl = maskHost(map.BASE_URL);
        }
      }

      const map = parseEnvText(fs.readFileSync(envPath, 'utf8'));
      const roleMap = Object.fromEntries(
        Object.entries({ ...map, ...process.env }).filter(
          (e): e is [string, string] => typeof e[1] === 'string',
        ),
      );
      const roleRefs = parseRolesFromEnvMap(roleMap);
      roles = roleRefs.map((r) => {
        const ready = isRoleLoginReady(roleMap, r);
        const resolvedId = resolveLoginIdentifier(roleMap, r);
        const idPart = 'error' in resolvedId ? 'no-id' : `${resolvedId.kind}(${resolvedId.source})`;
        return `${r.name}:${ready ? 'ready' : 'NOT_READY'}/${idPart}`;
      });
      if (roleRefs.length > 0 && !hasDefaultUserCredentials(roleMap)) {
        process.stdout.write('  default user = MISSING (general authenticated pipeline at risk)\n');
      } else if (hasDefaultUserCredentials(roleMap)) {
        process.stdout.write('  default user = present (TEST_USER_*)\n');
      }
    } catch {
      // ignore parse errors
    }
  }

  process.stdout.write(`  BASE_URL  = ${baseUrl}\n`);
  process.stdout.write(
    `  roles     = ${roles.length > 0 ? roles.join(', ') : '(none detected)'}\n`,
  );

  const challengeNote = process.env.AUTH_CHALLENGE_MODE || 'none';
  process.stdout.write(`  challenge = ${challengeNote}\n`);
  process.stdout.write(`  HEADLESS  = ${process.env.HEADLESS ?? '(unset)'}\n`);

  const authDir = path.join(ROOT, '.auth', resolved.appEnv);
  let authNote = `.auth/${resolved.appEnv}/`;
  if (fs.existsSync(authDir)) {
    const files = fs.readdirSync(authDir).filter((f) => f.endsWith('.json'));
    authNote += ` (${files.length} file(s))`;
  } else {
    authNote += ' (empty — run auth setup)';
  }
  process.stdout.write(`  auth dir  = ${authNote}\n`);
  process.stdout.write(
    '  MCP note  = restart qa-playwright-kit / playwright-test after env:use\n\n',
  );

  if (!exists && !exampleExists) {
    printError({
      title: 'Environment file missing',
      detail: `No config/environments/${resolved.appEnv}.env or .example`,
      hint: `cp config/environments/local.env.example config/environments/${resolved.appEnv}.env`,
      exitCode: EXIT.FIXABLE,
    });
    process.exit(EXIT.FIXABLE);
  }

  if (!exists && exampleExists) {
    printWarn(
      `Profile file missing — copy example: cp config/environments/${resolved.appEnv}.env.example config/environments/${resolved.appEnv}.env`,
    );
    process.exit(EXIT.FIXABLE);
  }

  printOk(`Active target: ${resolved.appEnv} (${resolved.source})`);
  process.exit(EXIT.OK);
}

main();
