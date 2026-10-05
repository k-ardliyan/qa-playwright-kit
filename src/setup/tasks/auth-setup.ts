/**
 * Setup task — regenerate `src/support/auth.setup.ts` from the wizard's roles.
 *
 * Extracted from wizard.ts (Fase 2 dekomposisi). Honors the `// CUSTOM_AUTH_FLOW`
 * marker: a customized file is never overwritten (see wizard-auth-template).
 *
 * @module src/setup/tasks/auth-setup
 */

import * as path from 'node:path';
import type { AppEnv } from '../../utils/app-env';
import type { WizardRoleInput } from '../../shared/utils/role-credentials';
import { writeAuthSetup } from '../../../tools/scripts/wizard-auth-template';

export interface AuthSetupWriteResult {
  /** True when a `// CUSTOM_AUTH_FLOW` file was left intact. */
  skipped: boolean;
  roleCount: number;
}

/** Regenerate the setup project's auth.setup.ts with real per-role paths. */
export function writeAuthSetupFile(opts: {
  repoRoot: string;
  appEnv: AppEnv;
  roleInputs: WizardRoleInput[];
}): AuthSetupWriteResult {
  const primaryRole = opts.roleInputs[0];
  const loginUrl = primaryRole?.fields.loginUrlPath || '/login';
  const successUrlPath = primaryRole?.fields.successUrlPath || '/dashboard';

  const authRoles = opts.roleInputs.map((r) => ({
    name: r.name,
    authFile: `.auth/${opts.appEnv}/${r.name}.json`,
    loginUrl: r.fields.loginUrlPath || '/login',
    successUrlPath: r.fields.successUrlPath || '/dashboard',
  }));

  const result = writeAuthSetup(
    { roles: authRoles, loginUrl, successUrlPath },
    path.join(opts.repoRoot, 'src', 'support', 'auth.setup.ts'),
  );

  return { skipped: result.skipped, roleCount: opts.roleInputs.length };
}
