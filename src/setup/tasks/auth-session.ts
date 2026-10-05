/**
 * Setup task — materialize login sessions via `npm run auth:setup`.
 *
 * Extracted from wizard.ts (Fase 2 dekomposisi). Interactive only: the command
 * drives a real browser, so a headless run leaves session creation to the
 * caller's CI step. Returns a structured outcome; the orchestrator renders it.
 *
 * @module src/setup/tasks/auth-session
 */

import { spawnSync } from 'node:child_process';
import type { AppEnv } from '../../utils/app-env';
import type { ChallengeMode } from '../../support/human-challenge';
import { binSpawn, npmCommand } from '../spawn-bin';

export type AuthSessionStatus = 'skipped' | 'created' | 'spawn-error' | 'failed';

export interface AuthSessionOutcome {
  status: AuthSessionStatus;
  /** npm script that was (or would have been) run. */
  script: 'auth:setup' | 'auth:setup:headed';
  appEnv: AppEnv;
  /** Present when status is 'spawn-error' or 'failed'. */
  detail?: string;
}

/** The npm script auth:setup should use for a given challenge mode. */
export function authSetupScript(challengeMode: ChallengeMode): 'auth:setup' | 'auth:setup:headed' {
  return challengeMode === 'none' ? 'auth:setup' : 'auth:setup:headed';
}

/**
 * Run the auth:setup script synchronously and classify the result.
 * The caller decides whether to run this at all (reachable + interactive).
 */
export function materializeAuthSession(opts: {
  repoRoot: string;
  appEnv: AppEnv;
  challengeMode: ChallengeMode;
}): AuthSessionOutcome {
  const script = authSetupScript(opts.challengeMode);
  const spawnSpec = binSpawn(npmCommand(), ['run', script]);
  const res = spawnSync(spawnSpec.command, spawnSpec.args, {
    cwd: opts.repoRoot,
    stdio: 'inherit',
    shell: spawnSpec.shell,
  });

  if (res.status === 0) {
    return { status: 'created', script, appEnv: opts.appEnv };
  }
  if (res.error) {
    // The spawn itself failed (e.g. EINVAL on Windows). `status` is null there,
    // which used to be reported as the meaningless "exit code null".
    const err = res.error as NodeJS.ErrnoException;
    return {
      status: 'spawn-error',
      script,
      appEnv: opts.appEnv,
      detail: `${err.code ?? err.name} — ${err.message}`,
    };
  }
  return {
    status: 'failed',
    script,
    appEnv: opts.appEnv,
    detail: `exit code ${res.status}`,
  };
}
