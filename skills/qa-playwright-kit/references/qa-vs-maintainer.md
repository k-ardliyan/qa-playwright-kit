# QA vs maintainer (ownership boundary)

Load when the next edit would touch `src/`, `tools/`, `config/` (non-env), `.github/agents/`, `skills/`, CI, or the dashboard/reporter.

This skill is for a **QA User** (non-programmer, tech-comfortable). It is **not** for a Framework Maintainer. Source of truth: `config/qa-kit.workspace.json` ownership map.

If a change would touch a protected path, **stop**. Do not patch. File a maintainer report using the template below.

---

## Who you are

| Role | Does | Does not |
| --- | --- | --- |
| **QA User** (this skill) | Write requirements, run setup / `env:edit`, run pipeline, read dashboard, decide APPROVE / FILE BUG / REVISE / MARK BLOCKED | Edit framework core, MCP, reporter, dashboard, CI, or agent instruction files |
| **Framework Maintainer** | `src/`, `tools/`, `config/` (non-env), `.github/agents/`, CI, MCP, dashboard, this skill pack | Daily requirement authoring |

---

## Path zones

From `config/qa-kit.workspace.json`:

| Zone | Glob | This skill may |
| --- | --- | --- |
| `qa` | `requirements/**` | Write and edit freely |
| `review` | `specs/**`, `tests/**` | Generate and heal specs; add POM under `tests/pages/`; add fixtures under `tests/data/`; register POM in `tests/fixtures.ts`. Review Planner/Generator output; do not rewrite it by hand unless Heal requires a spec fix |
| `generated` | `artifacts/**` | Read only. Never hand-edit reports, traces, or catalogs |
| `protected` | `src/**`, `tools/**`, `config/**`, `.github/agents/**` | **No writes.** Exception: `config/environments/*.env` via `npm run setup` / `npm run env:edit` only — never edit `*.env.example`, `qa-kit.workspace.json`, or Playwright config |

Also protected (not in the glob, still maintainer): `AGENTS.md`, `package.json`, `playwright.config.ts` policy sections, `.github/workflows/**`, `skills/**`, `docs/architecture/**`.

---

## Allowed vs escalate

| Symptom | QA action | Escalate? |
| --- | --- | --- |
| Requirement unclear or expected result wrong | Revise `requirements/*.md`, re-run Plan | No |
| Generated spec uses Playwright API names as `test.step` titles | Heal / regenerate the spec under `tests/` per [generator-step-titles.md](generator-step-titles.md) | No |
| Locator stale or assertion wrong in `tests/*.spec.ts` | Heal (max 3 cycles) or regenerate | No |
| Auth / BASE_URL / credentials wrong | `npm run setup`, `env:edit`, `auth:setup` | No |
| Application under test is behaving incorrectly | FILE BUG (product defect), keep test | No |
| `health_check` fails on MCP build or missing `src/` file | Stop. Report to maintainer | **Yes** |
| Dashboard Table View still shows `toBeVisible()` after specs use `test.step` correctly | Reporter / `formatSteps` bug. Do not edit `src/support/` | **Yes** |
| `validate:requirement` rejects a valid `_TEMPLATE.md` shape | Parser / validator bug | **Yes** |
| Pipeline agent (Planner / Generator / Healer / Reporter) instructions are wrong | Do not edit `.github/agents/` | **Yes** |
| Need a new MCP tool, npm script, or CI job | Maintainer task | **Yes** |

---

## Maintainer report template

Do not open a "quick fix" in `src/`. Give QA this block (fill from the run):

```markdown
## Maintainer report
- Observed: <what QA sees>
- Expected (framework contract): <from this skill / AGENTS.md>
- Evidence: <dashboard row / screenshot / trace path / command + exit code>
- Paths that looked implicated (DO NOT PATCH): <e.g. src/support/custom-reporter.ts>
- Already tried (QA zone only): <requirement change / heal cycles / setup:check>
- failureSource if known: app | test | requirement | env | ai_generation
```

Then stop the pipeline at Report / MARK BLOCKED if the framework itself is the blocker.

---

## Hard stop

Never:

- `patch` / `write_file` under `src/`, `tools/`, `.github/agents/`, `skills/`
- Change `formatSteps`, `custom-reporter.ts`, dashboard TSX, or MCP contracts to make the report "look nicer"
- Add npm scripts, CI workflows, or architecture docs as a side effect of a QA run
- Perform "while we're here" refactors

Healer may only rewrite **generated** `tests/*.spec.ts` (and matching `specs/` if Plan must be redone). If three heal cycles still fail for the same root error with `failureSource: test` caused by a missing framework API — escalate; do not invent a helper in `src/`.
