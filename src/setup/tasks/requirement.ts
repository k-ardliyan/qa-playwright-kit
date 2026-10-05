/**
 * Setup task — build and validate `requirements/login.md`.
 *
 * Extracted from wizard.ts (Fase 2 dekomposisi). The requirement is built and
 * compiled BEFORE the env file is written and pinned, so an invalid template can
 * never leave a written+encrypted env file behind on a failed run.
 *
 * @module src/setup/tasks/requirement
 */

import * as fs from 'node:fs';
import type { AppEnv } from '../../utils/app-env';
import type { ChallengeMode } from '../../support/human-challenge';
import type { WizardRoleInput } from '../../shared/utils/role-credentials';
import {
  buildLoginRequirement,
  loginStateFromWizard,
  writeLoginRequirementFile,
} from '../../../tools/scripts/wizard-login-template';
import {
  formatRequirementValidationFailure,
  validateRequirementFile,
  type RequirementValidationResult,
} from '../requirement-validation';

export interface RequirementResult {
  relativePath: string;
  markdown: string;
  validation: RequirementValidationResult;
  /** True when an existing non-auto-generated file was left intact. */
  skipped: boolean;
}

/**
 * Write requirements/login.md from the wizard state and validate it.
 * Throws when the generated contract is invalid — the caller has not written
 * the env file yet at this point.
 */
export async function writeAndValidateLoginRequirement(opts: {
  repoRoot: string;
  appEnv: AppEnv;
  baseUrl: string;
  roles: string[];
  roleInputs: WizardRoleInput[];
  challengeMode: ChallengeMode;
}): Promise<RequirementResult> {
  const primaryRole = opts.roleInputs[0];
  const loginState = loginStateFromWizard({
    baseUrl: opts.baseUrl,
    appEnv: opts.appEnv,
    roles: opts.roles,
    challengeMode: opts.challengeMode,
    loginIdPref: primaryRole?.fields.loginIdPref,
    loginUrl: primaryRole?.fields.loginUrlPath || '/login',
    successUrlPath: primaryRole?.fields.successUrlPath || '/dashboard',
    company: primaryRole?.fields.company,
  });

  const loginFile = writeLoginRequirementFile(opts.repoRoot, loginState);
  const markdown = loginFile.skipped
    ? fs.readFileSync(loginFile.absolutePath, 'utf-8')
    : buildLoginRequirement(loginState, { generated: true });

  const validation = await validateRequirementFile(opts.repoRoot, loginFile.relativePath);
  if (!validation.valid) {
    throw new Error(
      `Generated login requirement is invalid: ${formatRequirementValidationFailure(validation)}`,
    );
  }

  return {
    relativePath: loginFile.relativePath,
    markdown,
    validation,
    skipped: loginFile.skipped,
  };
}
