import type { ValidationViolation } from './rule-helpers';
import { isTraceabilityExempt, normalizeRelativePath } from './rule-helpers';
import { parseRolesFromEnvMap } from '../../utils/role-credentials';

/**
 * CC-AUTH-RECOVERY enforcement:
 * 1. No inline login — specs must not fill login forms / submit credentials to
 *    obtain a session. Sessions come from the setup project via storageState.
 *    (Exception: requirement IS a login scenario → runs on tests/login* or the
 *    `@auth`-tagged spec; those are the test subject, not provisioning.)
 * 2. No storage-state injection — browser_set_storage_state / addCookies /
 *    localStorage.setItem token pasting must never appear in specs.
 */
export function validateNoInlineAuth(
  content: string,
  filePath: string,
  relativePath: string,
): ValidationViolation[] {
  if (isTraceabilityExempt(relativePath)) {
    return [];
  }

  const violations: ValidationViolation[] = [];
  const rel = normalizeRelativePath(relativePath);
  const isLoginSubjectSpec = /(^|\/)login[^/]*\.spec\.ts$/.test(rel) || /@auth\b/.test(content);

  const submitPattern =
    /(?:fill|fillForm|type)\s*\(\s*['"`][^'"`]*(?:input\[type=["']password["']\]|name=["']password["']|id=["']password["'])[^'"`]*['"`][^)]*\)[\s\S]{0,400}?(?:click|tap|press)\s*\(\s*['"`][^'"`]*(?:button\[type=["']submit["']\]|type=["']submit["'])[^'"`]*['"`]/i;
  const fillFormPasswordPattern = /fillForm\s*\(\s*(?:page\s*,\s*)?\{[\s\S]{0,200}password\s*:/i;
  const gotoLoginPattern = /goto\s*\(\s*['"`][^'"`]*(?:\/login|\/signin|\/sign-in)['"`]/i;
  const injectPattern =
    /\b(?:browser_set_storage_state|setStorageState|addCookies|addCookiesToContext)\b|\blocalStorage\.setItem\s*\(/i;

  if (!isLoginSubjectSpec) {
    if (submitPattern.test(content) || fillFormPasswordPattern.test(content)) {
      violations.push({
        filePath,
        lineNumber: 1,
        ruleName:
          'Auth rule (CC-AUTH-RECOVERY): inline login detected — never fill login forms inside a spec to obtain a session. Use test.use({ storageState: authStatePath("<role>") }) provisioned by the setup project; if the session is dead re-run npm run auth:setup.',
      });
    }
    if (gotoLoginPattern.test(content)) {
      violations.push({
        filePath,
        lineNumber: 1,
        ruleName:
          'Auth rule (CC-AUTH-RECOVERY): specs must not navigate to the login page to authenticate. Provision sessions via storageState from the setup project (npm run auth:setup).',
      });
    }
  }

  if (injectPattern.test(content)) {
    violations.push({
      filePath,
      lineNumber: 1,
      ruleName:
        'Auth rule (CC-AUTH-RECOVERY): storage-state injection detected — browser_set_storage_state/addCookies/localStorage.setItem are banned in specs. Real UI login via npm run auth:setup is the ONLY session producer.',
    });
  }

  return violations;
}

/**
 * Role names that smell like duplicated/cloned auth files (`user-2`,
 * `admin-copy`, `finance backup`, `test_1`) — agents occasionally duplicate a
 * `.auth/<role>.json` instead of registering the role in the env contract.
 * A name can still be legitimate, so it is only a hard violation when the role
 * is ALSO unregistered (checked in validateAuthRolesRegistered).
 */
export function looksLikeClonedRoleName(role: string): boolean {
  return /(?:-\d+|-\d+-copy|copy\d*|clone|backup|bak\d*|duplicate|dup\d*|_copy\d*|copy_?\d+|test_?\d+)$/i.test(
    role.trim(),
  );
}

/** Extract every role a spec authenticates as: authStatePath('<role>') and .auth/…/<role>.json. */
export function extractAuthRolesFromSpec(content: string): string[] {
  const roles = new Set<string>();
  for (const m of content.matchAll(/authStatePath\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/g)) {
    roles.add(m[1].trim().toLowerCase());
  }
  for (const m of content.matchAll(
    /\.auth\s*\/\s*\$\{[^}]+\}\s*\/\s*['"`]?([^'"`/}]+)['"`]?\.json/g,
  )) {
    roles.add(m[1].trim().toLowerCase());
  }
  for (const m of content.matchAll(/\.auth\s*\/\s*[A-Za-z0-9_-]+\s*\/\s*([A-Za-z0-9-]+)\.json/g)) {
    roles.add(m[1].trim().toLowerCase());
  }
  roles.delete('general');
  roles.delete('default');
  return [...roles];
}

/**
 * Every role a spec authenticates as must be registered in the environment
 * contract (`config/environments/{APP_ENV}.env` → ROLE_PASSWORD + identity).
 * A file that merely exists under `.auth/` proves nothing: agents duplicate or
 * rename session files (e.g. `cp user.json user-2.json`) and then reference a
 * role that has no credentials, no auth-setup test, and no env backing.
 */
export function validateAuthRolesRegistered(
  content: string,
  filePath: string,
  relativePath: string,
): ValidationViolation[] {
  if (isTraceabilityExempt(relativePath)) {
    return [];
  }

  const roles = extractAuthRolesFromSpec(content);
  if (roles.length === 0) {
    return [];
  }

  const violations: ValidationViolation[] = [];
  let registered: Set<string> | null;
  try {
    const map: Record<string, string> = Object.fromEntries(
      Object.entries(process.env).filter(
        (entry): entry is [string, string] => entry[1] !== undefined,
      ),
    );
    registered = new Set(parseRolesFromEnvMap(map).map((r) => r.name));
  } catch {
    registered = null;
  }

  for (const role of roles) {
    const known = registered ? registered.has(role) : null;
    const cloneSuspicious = looksLikeClonedRoleName(role);

    if (known === true) {
      continue;
    }
    if (known === false) {
      violations.push(
        cloneViolation(
          role,
          filePath,
          cloneSuspicious
            ? 'the name looks like a duplicated session file and no credentials are registered for it in the active env, and'
            : 'no credentials are registered for it in the active env, and',
        ),
      );
      continue;
    }
    // known === null (env contract not loadable, e.g. pure unit-test context):
    // only flag on naming evidence to avoid false positives; auth:verify's
    // orphan check covers the rest at runtime.
    if (cloneSuspicious) {
      violations.push(
        cloneViolation(role, filePath, 'the name looks like a duplicated session file and'),
      );
    }
  }

  return violations;
}

function cloneViolation(role: string, filePath: string, evidence: string) {
  return {
    filePath,
    lineNumber: 1,
    ruleName: `Auth rule (CC-AUTH-RECOVERY): role "${role}" is not registered in the env contract — ${evidence} role authenticity comes ONLY from config/environments/{APP_ENV}.env (+ auth:setup). NEVER duplicate or rename .auth/<role>.json (e.g. user-2.json) to fake a role. Add the role via npm run env:edit, then run npm run auth:setup.`,
  };
}
