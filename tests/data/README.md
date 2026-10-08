# Test fixtures (generic file bank)

Small, committed files for upload/download/content self-tests and generated specs.

## What does NOT belong here

This folder is for **static files** (PDFs, images, invalid samples, network
contract payloads). It is **not** a place for database seed logic or CRUD
records. Test data that must exist in the application's backend is declared in
`config/qa-kit.seeds.json` and materialized by the seed-graph runtime
(`src/support/pw/seed-graph.ts`), not committed here as a data dump.

| Need                                              | Where it lives                                       |
| ------------------------------------------------- | ---------------------------------------------------- |
| Upload sample, PDF, image, invalid file           | This folder (`tests/data/…`)                         |
| Live network contract for `@network-assert`       | `tests/data/network/contracts/<feature>/…`           |
| Database record a scenario needs (order, invoice) | `config/qa-kit.seeds.json` → `create` producer       |
| Parent→child pair (customer → order)              | Seed `dependsOn` + `{parent.<seed>.id}` substitution |

## Rules

1. **Fixture-first upload** — tests call `setInputFiles` / `uploadFixture` with paths under this folder. Do **not** use headed OS file-picker pause in the pipeline.
2. Keep files small (**~100KB max** per sample). No secrets or real customer data.
3. **Demo tokens are kit self-test only** (e.g. `QA-KIT-SAMPLE-PDF`, `QA-KIT-NETWORK-OK`). Product expected content always comes from each requirement’s **Hasil yang Diharapkan** / Input Data — never copy demo tokens into product asserts by default.
4. Path helper: `fixturePath('pdf/sample-text.pdf')` from `@/support/pw`.

## Layout

| Path                                         | Purpose                                                          |
| -------------------------------------------- | ---------------------------------------------------------------- |
| `pdf/sample-text.pdf`                        | Minimal PDF; text includes `QA-KIT-SAMPLE-PDF` and `TOKEN-ALPHA` |
| `images/sample.png`                          | Tiny PNG for image upload UI checks                              |
| `invalid/empty.bin`                          | 0-byte negative case                                             |
| `invalid/not-a-pdf.pdf`                      | Wrong magic / spoofed extension                                  |
| `network/contracts/demo/submit-success.json` | Partial live network contract for `@network-assert` demo         |

## Network contracts

- Path: `network/contracts/<feature>/<name>.json`
- Partial match only (method, urlIncludes, status, requiredKeys, matchObject)
- Never store real Authorization cookies/tokens — helpers redact on capture

## Adding a fixture

1. Place the file under the matching subfolder.
2. Document any stable demo tokens in this README if used by unit/demo tests.
3. Prefer generating tiny files with a one-off script rather than committing large binaries.
