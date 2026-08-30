# Scenario types and capability tags

Load when writing a new scenario and unsure which tag to use, or when deciding whether something must be `(@manual)`.

---

## Four scenario type tags

| Tag                     | Meaning                                       | Generator output                          |
| ----------------------- | --------------------------------------------- | ----------------------------------------- |
| `(@success)`            | Happy path — normal flow succeeds             | Full test with success assertions         |
| `(@failure)`            | Negative path — wrong input, validation error | Test asserting error / validation message |
| `(@access-restriction)` | Role not authorised, access denied            | Test asserting denial or redirect         |
| `(@manual)`             | Cannot be automated                           | `test.skip(true, 'Manual: <reason>')`     |

Without a type tag the parser defaults to `(@success)`.

---

## `(@manual)` — only for these situations

| Situation                 | Example                                       |
| ------------------------- | --------------------------------------------- |
| CAPTCHA / reCAPTCHA       | Login form with reCAPTCHA                     |
| OTP / SMS to a real phone | Login via SMS OTP                             |
| Email verification link   | Click link in a real inbox                    |
| Live payment gateway      | Charge a real card (3DS callback)             |
| Biometric / hardware      | Face ID, barcode scan, receipt printing       |
| PDF **visual layout**     | Check spacing, alignment, typography in a PDF |
| Real-world timing         | Wait 24 hours for an expiry check             |

---

## What must NOT be `(@manual)` — use these instead

| Need                                      | Correct tag         | Helper                                                     |
| ----------------------------------------- | ------------------- | ---------------------------------------------------------- |
| Upload a file                             | `(@upload)`         | `uploadFixture`, `uploadViaChooser`                        |
| Download an export                        | `(@download)`       | `downloadAndSave`, `assertDownloadedEnvelope`              |
| Assert PDF text / Excel structure         | `(@file-content)`   | `assertPdfContains`, `assertExcelHeaders`                  |
| Assert live API payload after a UI action | `(@network-assert)` | `waitAndAssertApi`                                         |
| Mock HTTP 500 / offline for error UX      | `(@network)`        | `mockServerError`, `mockAbort`                             |
| Seed data via API then assert UI          | `(@hybrid)`         | `apiSeed`, `apiCleanup`                                    |
| Assert ARIA snapshot stability            | `(@aria)`           | `browser_snapshot` at inspect time, then standard locators |

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
```

---

## Example: multi-tag scenario

```markdown
### SC-05: Seed invoice via API then verify it appears in the UI (@success @hybrid)

- **Test ID:** TC-INV-005
- **Covers:** AC-02

**Langkah:**
1. Create invoice data via API seed
2. Open the invoice list page
3. Verify the new invoice appears in the table

**Hasil yang Diharapkan:**
- Invoice with the matching number appears in the first row of the table
```
