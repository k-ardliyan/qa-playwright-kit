# UI Discovery & Requirement Synthesis (Reverse-Engineering)

Load when QA provides a live web URL and wants to synthesize a complete, valid `requirements/<feature>.md` file using authenticated snapshots.

---

## Capabilities & Overview

This workflow captures semantic UI evidence and keeps QA-stated scenario intent in the generated requirement. It does not invent business outcomes from observed labels.
- **Session-Aware Navigation:** Injects `.auth/{APP_ENV}/{role}.json` so authenticated pages (e.g. `/invoices`) do not redirect to `/login`.
- **Semantic Component Extraction:** Captures Tables (headers, sample row, row actions), KPI/Stat cards, Tabs, Steppers, Form inputs (types, labels, required flags, options), Upload dropzones, Modals/Drawers, and RBAC disabled buttons.
- **Dynamic Route Deduplication:** Automatically normalises `/invoices/1` and `/invoices/2` into `/invoices/:id` and captures only 1 sample row to prevent URL explosion.
- **Backlog & Next-Scenario Suggestions:** Presents a clear distinction between active executable scenarios and suggested backlog scenarios.

---

## 4-Step Procedure

### 1. Preflight a Safe Target and Role Session

Run `health_check`; verify `APP_ENV` is non-production, the supplied URL origin matches configured `BASE_URL`, and the role is ready. Never use production, transfer Browser Use/profile cookies, or inject storage state.

```bash
npm run setup:check
```

If the role is missing, expired, or mismatched, stop and ask QA to refresh it through the real login flow:

```bash
npm run auth:setup
```

### 2. Capture the Requested Page

Call `qa-playwright-kit:snapshot_page` with the target URL, feature slug, and role. Review warnings and reject a capture that reports missing or mismatched auth. Use `discover_pages` only when QA asks to map linked pages; this is bounded UI discovery, not a sequence of business actions.

```json
{
  "url": "http://localhost:3000/invoices",
  "featureName": "invoices",
  "pageName": "invoice-list",
  "role": "finance"
}
```

For deep multi-page discovery within the same feature path:

```json
{
  "rootUrl": "http://localhost:3000/invoices",
  "featureName": "invoices",
  "role": "finance",
  "maxDepth": 2,
  "maxPages": 6
}
```

### 3. Synthesize Requirement File

Call `qa-playwright-kit:synthesize_requirement`:

```json
{
  "featureName": "invoices",
  "moduleName": "finance",
  "title": "Daftar & Pembuatan Invoice",
  "entryUrl": "/invoices",
  "role": "finance",
  "userScenarios": [
    {
      "title": "Finance can view approved invoices",
      "type": "success",
      "steps": ["Open approved invoices"],
      "expectedResults": ["The approved invoices list is visible"]
    }
  ]
}
```

Pass only user-stated scenarios (maximum 20) with explicit steps and expected results; pass `entryUrl` and role. Existing requirement paths are never overwritten. Synthesis also includes observed UI scenarios and writes `requirements/invoices.md` with:
- Acceptance Criteria (`AC-01..AC-N`)
- Executable Scenarios (`SC-01..SC-N`) tagged with `(@success)`, `(@failure)`, `(@access-restriction)`
- Backlog recommendations block in HTML comments

### 4. Validate & Present to QA

Validate the generated requirement:

```
terminal(command="npx tsx tools/validators/validate-requirement.ts requirements/invoices.md")
```

Present the summary to QA with the list of active scenarios and backlog recommendations:
- "Active scenarios generated in `requirements/invoices.md`"
- "Optional backlog scenarios found (e.g. sub-routes `/invoices/:id/edit`)"

---

## Safety & Best Practices

1. **Never Click Destructive Actions:** Skenario aksi hapus (`/delete`, `/destroy`, button "Hapus") hanya dicatat sebagai metadata atau verifikasi dialog, jangan dieksekusi secara destruktif selama discovery.
2. **Decoupled Role & URL:** Role ditentukan dari file auth `.auth/{APP_ENV}/<role>.json`, bukan dari struktur kata di URL.
3. **Review before pipeline:** Validate the synthesized requirement, present active and backlog scenarios, and wait for QA review before `workflow_run`.
4. **One Sample per Table:** Jangan mengunjungi setiap ID baris tabel — 1 sampel baris (`:id`) sudah cukup mewakili UI detail view.
