/**
 * Setup task — write + encrypt the environment file and publish the active pin.
 *
 * Extracted from wizard.ts (Fase 2 dekomposisi). Thin wrapper over
 * wizard-writer's writeEnvFile / pinEnvAfterSetup so the orchestrator holds the
 * sequence, not the file mechanics.
 *
 * @module src/setup/tasks/env-write
 */

import type { AppEnv } from '../../utils/app-env';
import type { ChallengeMode } from '../../support/human-challenge';
import type { WizardRoleInput } from '../../shared/utils/role-credentials';
import {
  writeEnvFile,
  pinEnvAfterSetup,
  type EnvWriteResult,
  type PinResult,
} from '../wizard-writer';

export interface EnvWriteOutcome {
  write: EnvWriteResult;
  pin: PinResult;
}

/**
 * Write the clean env file, encrypt secrets atomically, and pin APP_ENV.
 * Production is never auto-pinned (env:use:production owns that decision).
 */
export function writeEnvAndPin(opts: {
  repoRoot: string;
  appEnv: AppEnv;
  baseUrl: string;
  roles: WizardRoleInput[];
  challengeMode: ChallengeMode;
}): EnvWriteOutcome {
  const write = writeEnvFile({
    appEnv: opts.appEnv,
    baseUrl: opts.baseUrl,
    roles: opts.roles,
    challengeMode: opts.challengeMode,
  });
  const pin = pinEnvAfterSetup(opts.repoRoot, opts.appEnv);
  return { write, pin };
}
