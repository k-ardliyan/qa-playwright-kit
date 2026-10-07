# Scenario design from snapshots (senior-QA derivation)

Load before synthesizing or planning scenarios from a selector catalog — and whenever QA says the generated scenario list is "too few", "cuma 10", or "kurang dalam".

The snapshot is **evidence, not a scenario list**. Scenarios come from **evidence × technique**: every observable structure on the page (table, form, status, tab, role signal) is an input to a systematic technique (partition, boundary, decision rule, state transition). A real page yields many candidates — but only the ones with **captured evidence** become runnable tests; the rest are recorded as coverage gaps, never as silent skips.

## Sources behind this checklist

| Source                                                                           | What it contributes                                                                                                                                        |
| -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Playwright best practices (playwright.dev/docs/best-practices)                   | Test user-visible behavior; tests isolated (never chain state through another test); no third-party dependencies; web-first assertions                     |
| ISTQB CTFL v4 Chapter 4                                                          | Equivalence partitioning, boundary value analysis, decision tables, state transition testing — the techniques that make a set exhaustive and non-redundant |
| Accessibility-tree extraction (arXiv 2603.20358)                                 | Role-first locator hierarchy is the standard; per-element structure (role, name, state) is what scenarios must exercise                                    |
| Luo et al., FSE 2014 — flaky tests (201 commits, 51 projects)                    | Async wait / concurrency / order-dependency = top causes; 78% of flaky tests are flaky from first write; 34% of async-wait cases use time delays           |
| Hashemi et al., ICSME 2022 — flaky tests in JavaScript                           | Concurrency/async = dominant cause in JS; >80% of flaky tests are fixed, not skipped                                                                       |
| Vera-Pérez et al., EMSE 2018 — pseudo-tested methods                             | Covered but no test fails when the body is removed → weak-assertion risk                                                                                   |
| Alshahwan et al., FSE 2024 (TestGen-LLM, Meta) · WCAG 2.2 (W3C / ISO 40500:2025) | Verification filter before acceptance = the kit's gate pattern (73% accepted) · a11y contract role/name/state, focus, error announcement                   |
| Internal: `docs/QA-PLAYWRIGHT-KIT-SHARING.html`, `docs/WRITING-REQUIREMENTS.md`  | Kit conventions: scenario tags, provenance prefixes, `(@manual)` boundaries, one file per feature                                                          |

## Anti-slop contract (hard rules)

1. **One scenario = one distinct risk.** Before adding a scenario, name the partition / boundary / rule / transition it retires. "Click every button" filler is not a scenario.
2. **Dedupe by technique, not by wording.** Values inside one equivalence partition = one scenario. Only boundaries, distinct error messages, and distinct outcomes split into separate scenarios.
3. **Expected results must be observable** (URL, text, badge, row state, element absent). If it cannot be observed, it is `(@manual)` with a reason — or it is not a scenario yet.
4. **Never invent business rules from labels.** Structure comes from the snapshot; business truth comes from QA. A "Reject" button whose effect QA never stated is a proposed scenario `[planner-assumption]` or backlog — never an asserted outcome.
5. **Isolation.** A scenario must not depend on another test's mutations; create its data inline or via `seed:` / `(@hybrid)` API seed. Cross-role checks become two scenarios linked by the same seed ref — never one test switching roles.
6. **Budget.** Input Data uses provenance prefixes (`seed:`, `credential:`, `fixture:`, `literal:`); credentials never appear in steps; keep items ≤500 chars and the whole batch ≤20 KB per `synthesize_requirement` call.

## Data & isolation strategy (practice bottleneck #1)

Test data is the most common scaling bottleneck — plan it together with the scenarios, not after them:

- **Seed factory, not hand-made rows:** every `seed:` ref in Input Data must have a clear producer (API seed `(@hybrid)`, DB fixture, or a documented UI path). No producer → the scenario goes to Coverage Gap, not into the suite. Declare producers in `config/qa-kit.seeds.json` (copy `config/qa-kit.seeds.example.json`); `list_seeds` lists them and `validate_plan` warns `PLAN_SEED_UNKNOWN` for any `seed:` ref with no declared producer (when a registry exists).
- **Unique per run:** names/identifiers the scenario creates carry a unique suffix (timestamp/random) — shared environments collide on static values. `literal:` is for read-only lookups only.
- **Reset/cleanup:** scenarios that create data state their cleanup (`apiCleanup` for `(@hybrid)`; otherwise write "residual data acceptable" in Prekondisi). Never rely on another test's cleanup.
- **Account isolation:** one role account is never shared across QA members; scenarios that mutate the account follow the serialization rule (anti-slop #5).

## Where the evidence lives

Mine the selector catalog (`artifacts/selector-catalog/<feature>/<page>.json` → `semantic`):

- `tables[].headers` — column list, status columns; `.sampleRow` — status values, formats (date/currency), truncation; `.rowActions` — per-action scenarios; `.totalRowsObserved` — pagination/empty-state
- `forms[]` — per field: `.required` (empty-field failures), `.type` (format partitions), `.options` (combobox/radio choices), `.defaultValue`
- `statCards`, `paginations`, `tabs`, `steppers`, `modalsAndDrawers`, `uploadDropzones`, `alertsAndToasts`, `rbacSignals`, `subRoutes` — see the matrix below
- `docs/CONTEXT.md` (roles/tenancy) and the requirement's `Access Matrix` — who must be denied what

## Derivation matrix — snapshot component → candidate scenarios

Run this over EVERY catalogued page. The right column is the minimum set; add technique-derived cases (next section) per field and status.

| Snapshot evidence                          | Candidate scenarios (tag)                                                                                                                                                                                                                                                                  |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Table (headers, sampleRow, rowActions)     | list renders expected columns `(@success)`; empty state; search hit; search no-match `(@failure)`; each filter applied; sort asc/desc; pagination first/last page + page-size change; row count vs stat-card consistency; each row action open/cancel; destructive action confirm + cancel |
| Stat cards                                 | values match the table/list behind them `(@success)`; zero/empty state; consistency after refresh                                                                                                                                                                                          |
| Form inputs (required, type, options)      | per required field left empty `(@failure)`; valid submit `(@success)`; invalid format per field `(@failure)`; boundary values per numeric/length/date limit; duplicate/uniqueness; special chars / XSS-safe input; optional fields skipped; cancel/reset; double submit                    |
| Tabs                                       | each tab loads its panel; deep-link keeps the active tab; active state after reload                                                                                                                                                                                                        |
| Modals / drawers                           | open, close without change, confirm with change, validation inside modal                                                                                                                                                                                                                   |
| Upload dropzone                            | valid fixture `(@upload)`; wrong type; oversize; empty file `(@failure)`                                                                                                                                                                                                                   |
| RBAC signal (disabled action, role menu)   | allowed role performs the action; denied role is blocked `(@access-restriction)`                                                                                                                                                                                                           |
| Status field / badges (sampleRow)          | every status value renders correctly; transitions between statuses (state transition testing)                                                                                                                                                                                              |
| Sub-routes                                 | each route reachable; back navigation; deep-link to a `:id` route                                                                                                                                                                                                                          |
| Alerts / toasts                            | success feedback after the action; failure feedback after an error path                                                                                                                                                                                                                    |
| Stepper                                    | forward/back; guard blocks forward until the step is valid                                                                                                                                                                                                                                 |
| Cross-menu link (subRoute to another menu) | relation scenarios — see "Relation scenarios"                                                                                                                                                                                                                                              |
| Accessibility (WCAG 2.2)                   | keyboard-only completes the flow; focus order & visible focus; error messages announced (role=alert / aria-live); labels linked to fields                                                                                                                                                  |

## Technique toolbox — how it gets big AND precise

### Equivalence partitioning

For every input, list partitions: valid, and invalid-per-reason. Each DISTINCT error message is its own partition. One scenario per partition. An identifier field with "required", "format invalid", and "not registered" errors = 3 invalid partitions, not 1.

### Boundary value analysis

For numeric / length / date / quantity limits, test the boundary and its neighbor (2-value: 99 / 100, 500 / 501). Use 3-value (add the inside neighbor) for money, stock, and approval thresholds — off-by-one there costs real money. Pagination, page size, quantity, discount, and date ranges have boundaries even when the UI does not label them.

### Decision tables

When behavior depends on combinations (role × record status × data state), write the rules out and give each distinct action column its own scenario; collapse "don't care" rules. Access-restriction and workflow-gating scenarios come from here.

### State transition testing

For every status lifecycle (draft → pending → approved → paid): cover each valid transition AND each invalid one (approve twice, edit after paid, reject after approved). Invalid transitions are the highest-value negative scenarios a senior QA adds.

When presenting to QA in Indonesian: "partisi ekuivalen", "nilai batas", "tabel keputusan", "transisi status".

## Relation scenarios (cross-menu)

When the snapshot links another menu (sub-route, nav) or the requirement mentions data another menu owns (order → inventory stock, invoice → customer balance):

1. Snapshot the related page too (second `snapshot_page` under the same featureName, or `discover_pages`) so both sides have catalog evidence.
2. Write one role, one flow: open menu A → note the value → open menu B → locate the same record via a key from Input Data → compare.
3. The data link uses `seed:` / `literal:` refs — never "the record created by SC-04".
4. Needs a role the scenario does not run as? Split into two scenarios linked by the same seed ref.
5. State the comparison observably in `Hasil yang Diharapkan`: "Qty stok = stok awal − qty order", not "data konsisten".

## Sizing — how a page legitimately reaches 20–40 scenarios

1. **Enumerate** with the matrix + techniques. A real CRUD page can yield 20–40 *candidates*; do not self-censor down to 10. But **candidates are not commitments** — step 2 decides which survive.
2. **Rank and gate** — money / security / data-loss / access first, then main flows, then UX polish. Then apply the **evidence gate**: a scenario whose page has no selector-catalog entry does **not** become `automated`. It goes to **Coverage Gaps** with the reason "page not explored". Producing 40 candidates and shipping 12 runnable + 28 gapped is a correct outcome; shipping 40 with 28 silent `test.skip` is not.
3. **Synthesize** — pass the top 20 (tool cap) to `synthesize_requirement`.
4. **Overflow** — append the remaining scenarios as full `### SC-XX` blocks (same table format, continuous numbering, new `AC-XX` rows in `## Kriteria Penerimaan`) directly to the generated requirement file. The 20 cap is the tool's input limit, not a file limit (file limit 256 KB); `requirements/` is the QA zone and the agent authors it. Never overwrite the synthesized file — append.
5. **Validate** with `validate_requirement`, then present: "N candidate → M active, K backlog (reason)".
6. **>40 scenarios** — split by sub-feature into sibling requirement files; one file per feature stays the convention, and relation scenarios live with the owning menu.

**The scope guardrail.** A large scenario count is not a goal. Fowler's pyramid rule applies to this kit too: keep E2E to the journeys that need a real browser, and push everything provable at a lower layer (API seed/assert, `(@hybrid)`, `(@network-assert)`) there instead. A page that "needs" 59 E2E scenarios is usually 15 real journeys plus 44 cases that belong at the API layer. When the count grows, ask which layer each scenario actually needs — not how to fit more into the suite.

## Pre-handoff checklist

- [ ] Every AC has ≥1 covering scenario; every scenario has Test ID + Covers + Role + observable `Hasil yang Diharapkan`
- [ ] Negative path exists for every field and every destructive action; `(@access-restriction)` for every deny in the Access Matrix
- [ ] Boundaries present for every numeric/length/date constraint visible in the snapshot
- [ ] State transitions: valid + invalid covered for each status
- [ ] Dedupe pass done — no two scenarios retire the same partition
- [ ] `(@manual)` only for the true list (CAPTCHA / OTP / email link / live payment / biometric / PDF layout)
- [ ] Relation scenarios (if any): both pages catalogued, seed/literal data link stated
- [ ] Every assertion verifies a value/state/business effect — not just `toBeVisible` (pseudo-test risk, EMSE 2018)
- [ ] Critical flows complete keyboard-only; error messages announced (role=alert / aria-live) — WCAG 2.2
