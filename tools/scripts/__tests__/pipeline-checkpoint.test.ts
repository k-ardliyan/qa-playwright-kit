/**
 * Standalone Node assert harness (not a Playwright test).
 * Run: npx tsx tools/scripts/__tests__/pipeline-checkpoint.test.ts
 *
 * Pins the pipeline checkpoint contract (opt-in auto-commit per stage):
 *   - opt-in decision helper (default OFF; flag wins; env wins)
 *   - no-op when the worktree has nothing in scope
 *   - scope discipline: only requirements/ + specs/ + tests/ (never tests/demo,
 *     never framework zones like src/ or docs/)
 *   - commit carries the Pipeline-Run trailer
 */
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  CHECKPOINT_EXCLUDED_PREFIXES,
  CHECKPOINT_SCOPE_PREFIXES,
  PIPELINE_AUTO_COMMIT_ENV,
  commitPipelineCheckpoint,
  shouldAutoCommit,
} from '../pipeline-checkpoint';

let passed = 0;

function check(name: string, fn: () => void): void {
  try {
    fn();
    passed += 1;
    process.stdout.write(`  \u2713 ${name}\n`);
  } catch (err) {
    process.stdout.write(`  \u2717 ${name}\n`);
    throw err;
  }
}

function git(cwd: string, args: string[]): { status: number; stdout: string; stderr: string } {
  const res = spawnSync('git', args, { cwd, encoding: 'utf-8' });
  return { status: res.status ?? 1, stdout: res.stdout ?? '', stderr: res.stderr ?? '' };
}

function write(cwd: string, rel: string, content: string): void {
  const abs = path.join(cwd, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf-8');
}

function commitAll(cwd: string, message: string): void {
  git(cwd, ['add', '-A']);
  git(cwd, ['commit', '-q', '-m', message]);
}

function makeRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-checkpoint-'));
  git(dir, ['init', '-q', '-b', 'main']);
  git(dir, ['config', 'user.email', 'q@t.local']);
  git(dir, ['config', 'user.name', 'Q']);
  write(dir, 'package.json', '{"name":"x","version":"1.0.0"}');
  commitAll(dir, 'init');
  return dir;
}

const RUN_ID = '123e4567-e89b-42d3-a456-426614174000';

process.stdout.write('\npipeline checkpoint\n');

check('shouldAutoCommit: default OFF; env switch; explicit flag wins', () => {
  assert.equal(shouldAutoCommit({}), false, 'default must be OFF');
  assert.equal(shouldAutoCommit({ [PIPELINE_AUTO_COMMIT_ENV]: '1' }), true);
  assert.equal(
    shouldAutoCommit({ [PIPELINE_AUTO_COMMIT_ENV]: '1' }, { autoCommit: false }),
    true,
    'flag wins',
  );
  assert.equal(shouldAutoCommit({}, { autoCommit: true }), true);
  // Any other value than exactly '1' is not an opt-in.
  assert.equal(shouldAutoCommit({ [PIPELINE_AUTO_COMMIT_ENV]: 'true' }), false);
});

check('scope prefixes: QA zone in, tests/demo out', () => {
  assert.deepEqual(CHECKPOINT_SCOPE_PREFIXES, ['requirements/', 'specs/', 'tests/']);
  assert.deepEqual(CHECKPOINT_EXCLUDED_PREFIXES, ['tests/demo/']);
});

check('no-op when nothing in scope changed', () => {
  const dir = makeRepo();
  try {
    const result = commitPipelineCheckpoint(dir, { stage: 'model', runId: RUN_ID });
    assert.equal(result.committed, false);
    assert.deepEqual(result.files, []);
    assert.equal(result.sha, null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

check('commits ONLY requirements/specs/tests — framework zones and docs stay out', () => {
  const dir = makeRepo();
  try {
    // In scope (QA zone)…
    write(dir, 'requirements/hris-leave.md', '# REQ-01\n');
    write(dir, 'specs/hris-leave-test-plan.md', '# plan\n');
    write(dir, 'tests/hris-leave-user.spec.ts', 'test("x", () => {});\n');
    // …and out of scope: framework zone + random docs + excluded demo dir.
    write(dir, 'src/leak.ts', 'must not be committed\n');
    write(dir, 'docs/leak.md', 'must not be committed\n');
    write(dir, 'CHANGELOG.md', 'must not be committed\n');
    write(dir, 'tests/demo/leak.ts', 'must not be committed\n');

    const result = commitPipelineCheckpoint(dir, {
      stage: 'model',
      runId: RUN_ID,
      requirementPath: 'requirements/hris-leave.md',
    });
    assert.equal(result.committed, true);
    assert.equal(result.files.length, 3, 'exactly the three scoped files');

    const committed = git(dir, ['show', '--name-only', '--format=', 'HEAD'])
      .stdout.split('\n')
      .map((f) => f.trim())
      .filter(Boolean);
    assert.deepEqual(
      [...committed].sort(),
      [
        'requirements/hris-leave.md',
        'specs/hris-leave-test-plan.md',
        'tests/hris-leave-user.spec.ts',
      ].sort(),
    );
    // Out-of-scope files stay out of history (not tracked) and on disk.
    // NOTE: `git status` collapses untracked directories (`?? src/`), so the
    // assertion uses `git ls-files` — tracked == committed.
    for (const leak of ['src/leak.ts', 'docs/leak.md', 'CHANGELOG.md', 'tests/demo/leak.ts']) {
      assert.equal(
        git(dir, ['ls-files', leak]).stdout.trim(),
        '',
        `${leak} must remain uncommitted`,
      );
      assert.ok(fs.existsSync(path.join(dir, leak)), `${leak} survives on disk`);
    }
    // Subject + trailer carry the stage, requirement and run identity.
    const body = git(dir, ['log', '-1', '--format=%B']).stdout;
    assert.ok(body.includes('chore(pipeline): model checkpoint'), 'conventional subject');
    assert.ok(body.includes('requirements/hris-leave.md'), 'requirement path in subject');
    assert.ok(body.includes(`Pipeline-Run: ${RUN_ID}`), 'run identity trailer');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

check('idempotent: a second run with no new changes is a no-op', () => {
  const dir = makeRepo();
  try {
    write(dir, 'requirements/again.md', 'v1\n');
    const first = commitPipelineCheckpoint(dir, { stage: 'model', runId: RUN_ID });
    assert.equal(first.committed, true);
    const second = commitPipelineCheckpoint(dir, { stage: 'model', runId: RUN_ID });
    assert.equal(second.committed, false, 'clean worktree → nothing to commit');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

process.stdout.write(`\n${passed} checks passed\n`);
