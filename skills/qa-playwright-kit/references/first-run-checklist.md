# First-run checklist

Load when QA is setting up for the first time, or when `npm run setup` / `npm run auth:setup` errors.

Do not proceed to the next phase until the current one is green.

---

## Phase 0 — Machine prerequisites

```bash
node --version   # must be >= 20.19.0
git --version    # must be present
```

If Node < 20.19.0: download LTS from https://nodejs.org/, install, restart terminal, rerun.

---

## Phase 1 — Install and wizard

```bash
npm install
npm run setup        # interactive wizard (6 steps)
```

The wizard writes `config/environments/{APP_ENV}.env`. What the wizard does **not** do: install browsers, run auth setup, create requirements, or encrypt credentials.

---

## Phase 2 — Verify setup

```bash
npm run setup:check  # must be green
npm run health:check # must be green — auth_storage warning is normal before auth:setup
```

Any ❌ in `health:check` other than `auth_storage` → escalate to maintainer.

---

## Phase 3 — Auth (only when `Auth state: authenticated`)

```bash
npm run auth:setup           # headless; reads credentials from env file
npm run auth:setup:headed    # OTP / CAPTCHA — browser window appears
```

Verify `.auth/{APP_ENV}/user.json` is > 100 bytes. File < 100 bytes = empty session → re-run.

---

## Phase 4 — First requirement

```bash
cp requirements/_TEMPLATE.md requirements/<feature>.md
# fill in: REQ-XXX title, Metadata (Module required), AC-XX, SC-XX steps
npm run validate:requirement
```

Validator must exit 0 before running the pipeline.

---

## Phase 5 — Pipeline

```bash
npm run qa:run    # TTY picker → select file → copy printed prompt → paste into Hermes Agent
```

Dashboard opens automatically in the browser. If not: open `artifacts/reports/custom-dashboard.html` manually.

---

## Failure quick-reference

| Symptom | Check | Fix |
| --- | --- | --- |
| Wizard errors at Phase 0 | `node --version` | Upgrade Node.js to >= 20.19.0 |
| `health:check` red on `mcp_build` | `tools/mcp/dist/` missing | `npm run mcp:build` (maintainer task) |
| Auth file is 36 bytes | `.auth/{APP_ENV}/user.json` size | Re-run `npm run auth:setup` |
| `npm run qa:run` hangs without a picker | stdin is not a TTY | Run from an interactive terminal, not a pipe |
| Dashboard redirects to `/login` after login | localStorage missing in auth file | `npm run env:edit` → `npm run auth:setup` |
| `ENOENT environments/local.env` | Env dir changed or wizard never ran | Run `npm run setup` first |
