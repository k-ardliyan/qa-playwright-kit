# Requirement language (QA-facing)

Load when drafting or reviewing `requirements/*.md`, or when a step or expected-result text smells like Playwright.

The requirement is the only document QA authors. The Planner copies steps and expected results into the test plan. The Generator copies them into `test.step` titles and `setTestMetadata`. If this document uses Playwright APIs, the dashboard will too.

The committed template (`requirements/_TEMPLATE.md`) uses Indonesian headings. Treat those headings as fixed identifiers; write the *body* in whatever language the QA team uses (Indonesian or English). Never mix Playwright into either.

**Format: tables.** A field is written as a table row whose FIRST cell is the label — `| Langkah | … |`. The parser also still accepts the old bullet form (`- **Langkah:** …`) for files written before v3.0, but new files use tables.

| Template label          | Meaning               | Where               |
| ----------------------- | --------------------- | ------------------- |
| `Langkah`               | Steps                 | scenario table row  |
| `Hasil yang Diharapkan` | Expected result       | scenario table row  |
| `Input Data`            | Input data            | scenario table row  |
| `Prekondisi`            | Preconditions         | scenario table row  |
| `Module`                | Module (required)     | `## Metadata` table |
| `Feature`               | Feature (recommended) | `## Metadata` table |

Two table rules that matter:

- Separate multiple items inside ONE cell with `<br>` — a literal newline breaks the table.
- Escape a pipe character inside a cell as `\|`.

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

Input Data and Steps are two rows of the same scenario table. Input Data holds `key: source:value` entries; Steps never repeat the raw value.

```markdown
| Field | Nilai |
| --- | --- |
| Input Data | `email: credential:user.email`<br>`password: credential:user.password`<br>`note: literal:Approved for Q3 payout` |
| Langkah | 1. Type the email in the Email field<br>2. Type the password in the Password field<br>3. Click the "Sign in" button |
```

Wrong: `1. Type user@acme.com in the Email field` — this leaks the value into the Test Step column.

If the requirement is written in Indonesian, keep the step text in Indonesian. Copy it verbatim into `test.step` titles; do not translate.

## Minimal required structure

Copy the structure from `requirements/_TEMPLATE.md`. Required fields:

- `# REQ-XXX: …` on line 1
- Metadata table: Tags, Priority, Auth state, Start page, **Module** (required), Feature (recommended)
- Acceptance criteria as a `| ID | Kriteria |` table with `AC-XX` IDs
- Each SC: a `| Field | Nilai |` table with Test ID, Covers, Steps, Expected Result
- Role and Access Matrix when `Role scope` is set

Good example: `requirements/_GOOD_EXAMPLE.md`.
