# Scenario types and capability tags

Load when writing a new scenario and unsure which tag to use, or when deciding whether something must be `(@manual)`.

---

## Scenario type tags

| Tag                     | Meaning                                       | Generator output                          |
| ----------------------- | --------------------------------------------- | ----------------------------------------- |
| `(@success)`            | Happy path — normal flow succeeds             | Full test with success assertions         |
| `(@failure)`            | Negative path — wrong input, validation error | Test asserting error / validation message |
| `(@access-restriction)` | Role not authorised, access denied            | Test asserting denial or redirect         |
| `(@manual)`             | Cannot be automated                           | `test.skip(true, 'Manual: <reason>')`     |

Without a type tag the parser classifies the scenario as `general` (not `success`). Always tag the type explicitly — `general` scenarios are not counted as happy-path success coverage.

---

## Work that is not "manual": `@blocked` and `@not-implemented`

These two are **plan-level** (they force `Execution Mode`, see `specs/_TEMPLATE.md`). Neither is `@manual`, and neither becomes `test.skip`:

| Tag                | Meaning                                                     | Generator output                        |
| ------------------ | ----------------------------------------------------------- | --------------------------------------- |
| `@blocked`         | Real, evidenced blocker (page 500s, role denied, ext. down) | `test.fixme(...)` + record the evidence |
| `@not-implemented` | Planned but not built (page not explored, no seed)          | `test.fixme(...)` + Coverage Gap entry  |

**Why not `test.skip`:** Playwright's own definition — *"marks the test as irrelevant"*. A blocked or unbuilt scenario is not irrelevant, it is **unfinished work**. Emitting it as `test.skip` hides it behind a neutral status and makes the run read "degraded" instead of "unbuilt". Use `test.fixme` (runs nowhere, tracked as debt) or `test.fail` (runs, must fail — for a known live bug).

A scenario whose page has **no selector-catalog evidence** may not be planned `automated` at all: it belongs in **Coverage Gaps** (`validate_plan` reports `PLAN_EVIDENCE_MISSING`). That is the mechanism that keeps "belum dieksplorasi" from becoming a silent skip.

The gate has teeth when the problem is systemic, not incidental: `validate_plan` raises a **blocking** error — the plan is invalid and Generate never runs — for

- `PLAN_EVIDENCE_MAJORITY_GAP`: **more than half** the `automated` scenarios have no catalog evidence (≥2 automated scenarios; exactly 50% is tolerated),
- `PLAN_EVIDENCE_UNAVAILABLE`: a `## Catalog Evidence` row points at a file that is **not on disk**, while automated scenarios depend on it.

A plan that is mostly unverified is guessing. Mark the unready scenarios `@not-implemented` and record them in Coverage Gaps; do not force them to `automated`.

---

## `(@manual)` — only for these situations

The list is **closed**. Nothing outside it qualifies:

| Situation                 | Example                                       |
| ------------------------- | --------------------------------------------- |
| CAPTCHA / reCAPTCHA       | Login form with reCAPTCHA                     |
| OTP / SMS to a real phone | Login via SMS OTP                             |
| Email verification link   | Click link in a real inbox                    |
| Live payment gateway      | Charge a real card (3DS callback)             |
| Biometric / hardware      | Face ID, barcode scan, receipt printing       |
| PDF **visual layout**     | Check spacing, alignment, typography in a PDF |
| Real-world timing         | Wait 24 hours for an expiry check             |

"Not explored yet", "no test data", and "dependency not ready" are **not** on this list — they are `@not-implemented` (Coverage Gap).

---

## What must NOT be `(@manual)` — use these instead

| Need                                      | Correct tag         | Helper                                                                                                                         |
| ----------------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Upload a file                             | `(@upload)`         | `uploadFixture`, `uploadViaChooser`                                                                                            |
| Download an export                        | `(@download)`       | `downloadAndSave`, `assertDownloadedEnvelope`                                                                                  |
| Assert PDF text / CSV structure           | `(@file-content)`   | `assertPdfContains`, `assertStringsContain`                                                                                    |
| Assert live API payload after a UI action | `(@network-assert)` | `waitAndAssertApi`                                                                                                             |
| Mock HTTP 500 / offline for error UX      | `(@network)`        | `mockServerError`, `mockAbort`                                                                                                 |
| Seed data via API then assert UI          | `(@hybrid)`         | Declare `Evidence Mode: hybrid-ui`; use registered `seed:<name>`, `apiSeed` / `apiCleanup` from `@/support/pw`, then assert UI |
| Assert ARIA snapshot stability            | `(@aria)`           | `browser_snapshot` at inspect time, then standard locators                                                                     |
| Assert a visual/layout baseline           | `(@visual)`         | `expectVisual` / `expectPageVisual` / `toHaveScreenshot`                                                                       |

`validate_generated_tests` enforces capability helpers and the evidence boundary: raw `fetch`/`request` calls and `.auth` token reads are rejected in product specs. Hybrid setup must declare `evidenceMode: 'hybrid-ui'`, use a registered seed and safe cleanup policy, and still include a browser action plus UI assertion in the same test. `@network-assert` observes a request triggered by UI and does not authorize direct API setup. `@visual` requires `toHaveScreenshot` or `expectVisual`/`expectPageVisual` from `@/support/pw`.

---

## CRUD data and relations

A scenario that creates, changes, or deletes a record declares its `Data Operation`
and `Data Entity`; the requirement's `## Data Targets` lists which operations the
feature performs, and `validate_plan` checks each one is planned or gapped
(`PLAN_DATA_OPERATION_UNCOVERED`). Relations between entities live in
`## Relationships`: a `confirmed` relation may be asserted and needs a registered
seed; an `assumption` relation may not be planned as runnable
(`PLAN_RELATION_UNCONFIRMED`). Seed records are declared in
`config/qa-kit.seeds.json` as executable producers and built by `withSeededData`
— see [scenario-design.md](scenario-design.md) § "CRUD coverage and relations".

---

## Capability tags can be combined

```markdown
### SC-04: Upload PDF then verify text content (@success @upload @file-content)
```

One scenario may have multiple capability tags. It must have exactly **one** type tag (success / failure / access-restriction / manual).

---

## Decision tree

```
Needs physical hardware (phone, scanner, printer)?
  → YES → (@manual)

Needs OTP / CAPTCHA?
  → Handle at auth:setup level (headed mode), NOT inside the test scenario
  → Only (@manual) if it truly cannot be automated at all

Upload a file?
  → Fixture-first from tests/data/ → (@upload) — never (@manual)

Download and check PDF / Excel content?
  → (@download) + (@file-content) — never (@manual)

Assert API response after a click?
  → (@network-assert) — never (@manual)

Mock HTTP error response?
  → (@network) — never (@manual)

Role not authorised to access a page?
  → (@access-restriction) — not (@failure)

Not sure?
  → Ask the maintainer before marking (@manual)

Page not explored / no test data / dependency missing?
  → NOT (@manual). Record it as a Coverage Gap (`@not-implemented`).
```

---

## Example: multi-tag scenario

```markdown
### SC-05: Seed invoice via API then verify it appears in the UI (@success @hybrid)

| Field | Nilai |
| --- | --- |
| Test ID | TC-INV-005 |
| Covers | AC-02 |
| Langkah | 1. Create invoice data via API seed<br>2. Open the invoice list page<br>3. Verify the new invoice appears in the table |
| Hasil yang Diharapkan | - Invoice with the matching number appears in the first row of the table |
```
