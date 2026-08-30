# Requirement language (QA-facing)

Load when drafting or reviewing `requirements/*.md`, or when a step or expected-result text smells like Playwright.

The requirement is the only document QA authors. The Planner copies steps and expected results into the test plan. The Generator copies them into `test.step` titles and `setTestMetadata`. If this document uses Playwright APIs, the dashboard will too.

The committed template (`requirements/_TEMPLATE.md`) uses Indonesian headings. Treat those headings as fixed identifiers; write the *body* in whatever language the QA team uses (Indonesian or English). Never mix Playwright into either.

| Template heading             | Meaning               |
| ---------------------------- | --------------------- |
| `**Langkah:**`               | Steps                 |
| `**Hasil yang Diharapkan:**` | Expected result       |
| `**Input Data:**`            | Input data            |
| `**Prekondisi:**`            | Preconditions         |
| `- **Module:**`              | Module (required)     |
| `- **Feature:**`             | Feature (recommended) |

## Allowed

- User-visible actions: open, click, type, select, check, upload, download, scroll
- Observable results: URL change, text content, badge, toast, button shown/hidden, table row status
- Provenance prefixes in **Input Data only**: `seed:`, `credential:`, `fixture:`, `literal:`
- Scenario tags in the `### SC-XX:` heading: `(@success)` `(@failure)` `(@access-restriction)` `(@manual)` plus capability tags

## Forbidden in Steps and Expected Result

| Do not write                                        | Write instead                                                 |
| --------------------------------------------------- | ------------------------------------------------------------- |
| `toBeVisible()` / `toHaveURL()` / `expect(...)`     | "Logout button is visible" / "URL changes to /dashboard"      |
| `page.fill('#email', ...)` / `getByRole('textbox')` | "Type the email in the Email field"                           |
| CSS / XPath / `data-testid` locators                | The UI label QA can see on screen                             |
| Password / OTP / cookie values in a step            | Put them in Input Data with `credential:` / `literal:` prefix |
| "works fine" / "as expected"                        | Observable outcome: text, URL, badge                          |

## Input Data vs Steps

Input Data is a key-value list. Steps never repeat the raw value.

```markdown
**Input Data:**
- email: credential:user.email
- password: credential:user.password
- note: literal:Approved for Q3 payout

**Langkah:**
1. Type the email in the Email field
2. Type the password in the Password field
3. Click the "Sign in" button
```

Wrong: `1. Type user@acme.com in the Email field` — this leaks the value into the Test Step column.

If the requirement is written in Indonesian, keep the step text in Indonesian. Copy it verbatim into `test.step` titles; do not translate.

## Minimal required structure

Copy the structure from `requirements/_TEMPLATE.md`. Required fields:

- `# REQ-XXX: …` on line 1
- Metadata: Tags, Priority, Auth state, Start page, **Module** (required), Feature (recommended)
- `AC-XX` IDs on every acceptance criterion
- Each SC: Test ID, Covers, Steps, Expected Result
- Role and Access Matrix when `Role scope` is set

Good example: `requirements/_GOOD_EXAMPLE.md`.
