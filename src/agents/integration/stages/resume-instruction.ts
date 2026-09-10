/**
 * Shared manual-path resume instruction for the `awaiting-generator` handoff.
 *
 * The framework supports two ways to fill the Generate stage:
 *  1. AI agent (recommended — Hermes runs the Generator agent and resumes).
 *  2. Manual first-class path: write the spec yourself, verify, then resume.
 *
 * The instruction must always contain the word "resume" — the workflow engine
 * contract test (PC-02) asserts it in `nextRequiredAction`.
 *
 * @module agents/integration/stages/resume-instruction
 */

export function buildManualResumeInstruction(
  targetPaths: readonly string[],
  requirementPath: string,
  runId: string,
): string {
  const targets = targetPaths.join(', ');
  return (
    'Write the test spec(s): ' +
    `${targets} ` +
    "(follow .github/agents/generator.agent.md; use test.use({ storageState: authStatePath('<role>') }), " +
    'never log in inside a test), ' +
    'verify with validate_generated_tests, ' +
    'then resume: npx tsx tools/scripts/workflow-run.ts ' +
    `${requirementPath} --resume --run-id ${runId}`
  );
}
