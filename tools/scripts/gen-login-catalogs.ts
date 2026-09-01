/// <reference types="node" />
/**
 * gen-login-catalogs — Regenerate requirements/auth/login-<mode>.md
 * from wizard-login-template (single source of truth).
 *
 * Run: npx tsx tools/scripts/gen-login-catalogs.ts
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { buildLoginRequirement, catalogLoginState } from './wizard-login-template';
import type { ChallengeMode } from '../../src/support/human-challenge';

const MODES: ChallengeMode[] = ['none', 'auto', 'otp-browser', 'otp-stdin', 'captcha-browser'];
const ROOT = process.cwd();

for (const mode of MODES) {
  const state = catalogLoginState(mode);
  const markdown = buildLoginRequirement(state, { generated: false });
  const rel = path.join('requirements', 'auth', `login-${mode}.md`);
  fs.writeFileSync(path.join(ROOT, rel), markdown, 'utf-8');
  process.stdout.write(`✓ ${rel} (${markdown.split(/\r?\n/).length} lines)\n`);
}
