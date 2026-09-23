/**
 * Pin APP_ENV for the studio. Does not read env files or spawn.
 * @module src/cli/studio-env-switch
 */

import { isKnownAppEnv, writeActiveEnvPin } from '../utils/app-env';
import { findRepoRoot } from '../shared/workspace-paths';

export function switchStudioEnv(
  appEnv: string,
  repoRoot: string = findRepoRoot(),
  confirmProduction?: boolean,
): { ok: true; appEnv: string } | { ok: false; error: string } {
  if (!isKnownAppEnv(appEnv)) return { ok: false, error: `unknown env: ${appEnv}` };
  if (appEnv === 'production' && confirmProduction !== true) {
    return { ok: false, error: 'production requires confirm' };
  }
  writeActiveEnvPin(repoRoot, appEnv);
  return { ok: true, appEnv };
}
