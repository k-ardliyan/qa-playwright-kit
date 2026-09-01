/**
 * Hermes paste-prompt builder for qa:run (pure helpers — safe to unit test).
 */

/** Lightweight metadata from requirement markdown for prompt tailoring. */
export function parseRequirementPromptHints(markdown: string): {
  authState: 'authenticated' | 'unauthenticated' | 'unknown';
  startPage: string | null;
  roleScope: string | null;
} {
  const authRaw =
    markdown
      .match(/^\s*-\s+\*\*Auth state:\*\*\s*(.+)$/im)?.[1]
      ?.trim()
      .toLowerCase() ?? '';
  const authState =
    authRaw === 'authenticated'
      ? 'authenticated'
      : authRaw === 'unauthenticated'
        ? 'unauthenticated'
        : 'unknown';
  const startPage = markdown.match(/^\s*-\s+\*\*Halaman awal:\*\*\s*(\S+)/im)?.[1]?.trim() ?? null;
  const roleScope = markdown.match(/^\s*-\s+\*\*Role scope:\*\*\s*(.+)$/im)?.[1]?.trim() ?? null;
  return { authState, startPage, roleScope };
}

function isLoginRequirement(reqRelPath: string, markdown: string): boolean {
  const norm = reqRelPath.replace(/\\/g, '/').toLowerCase();
  if (/(^|\/)login\.md$/.test(norm) || /\/login[-_]/.test(norm)) return true;
  const title = markdown.match(/^#\s+REQ-[^:]+:\s*(.+)$/m)?.[1]?.toLowerCase() ?? '';
  return /\blogin\b|\bautentikasi\b|\bsign[\s-]?in\b/.test(title);
}

/**
 * Build Hermes paste prompt tailored to the requirement (not always login-centric).
 */
export function buildAgentPrompt(reqRelPath: string, markdown = ''): string {
  const hints = parseRequirementPromptHints(markdown);
  const loginLike = isLoginRequirement(reqRelPath, markdown);
  const startHint = hints.startPage || '/';
  const lines: string[] = [
    `Run full pipeline in automatic mode for ${reqRelPath} (orchestrator: AGENTS.md).`,
    `Catalog files under requirements/auth/login-<mode>.md match AUTH_CHALLENGE_MODE; setup writes requirements/login.md for the live site.`,
    `Dashboard columns: Test Step = **Langkah:** verbatim (aksi UI only). Input Data = **Input Data:** via setTestMetadata.inputData. Expected = **Hasil yang Diharapkan:** verbatim.`,
    `Do NOT copy credential:/literal:/seed:/fixture: values, emails, or passwords into test.step titles.`,
  ];

  if (loginLike) {
    lines.push(
      `This is a LOGIN / first-auth requirement.`,
      `BEFORE Plan/Generate: call snapshot_page on real BASE_URL + login path (Halaman awal: ${startHint}).`,
      `Use selector-catalog locators (Path A, no POM); live-verify — every website differs.`,
    );
  } else if (hints.authState === 'authenticated') {
    const roles = hints.roleScope || 'user (default)';
    lines.push(
      `Auth state: authenticated. Roles in scope: ${roles}.`,
      `Ensure .auth/{APP_ENV}/<role>.json exists (npm run auth:setup) before Execute.`,
      `BEFORE Plan/Generate: snapshot_page on BASE_URL + Halaman awal (${startHint}) when catalog is missing/stale.`,
      `Prefer Path A inline locators from selector-catalog unless POM is listed in metadata.`,
    );
  } else {
    lines.push(
      `Auth state: ${hints.authState === 'unauthenticated' ? 'unauthenticated' : 'unknown (check Metadata)'}.`,
      `BEFORE Plan/Generate: snapshot_page on BASE_URL + Halaman awal (${startHint}) when catalog is missing/stale.`,
      `Do NOT apply login.md-only instructions unless this requirement is actually about login.`,
    );
  }

  lines.push(
    `Resume from reports/pipeline-state.json ONLY if its requirementPath matches this file; otherwise start a fresh run.`,
    `Pipeline: Plan → Generate → Execute → Heal (max 3 cycles) → Report → archive_report.`,
    `Return summary, unresolvedFailures, catalog path (if any), and dashboard/report path.`,
  );

  return `${lines.join('\n')}\n`;
}
