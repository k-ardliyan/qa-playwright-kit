# Recipe: File upload & download (fixture-first)

Local-first automation for file chooser / export flows. **No OS file-picker pause.** No headed manual step in the pipeline.

## Tags

| Tag               | When                                                                                                              |
| ----------------- | ----------------------------------------------------------------------------------------------------------------- |
| `(@upload)`       | Scenario uploads a file into the app                                                                              |
| `(@download)`     | Scenario triggers a browser download                                                                              |
| `(@file-content)` | Also assert PDF/Excel **content** after download (see [PDF-EXCEL-CONTENT-ASSERT.md](PDF-EXCEL-CONTENT-ASSERT.md)) |

Metadata alternative: `#upload #download`.

## Fixture bank

Committed samples live under `tests/data/`:

| Path                                   | Use                         |
| -------------------------------------- | --------------------------- |
| `tests/data/images/sample.png`         | Image upload UI             |
| `tests/data/pdf/sample-text.pdf`       | PDF upload / content demo   |
| `tests/data/excel/sample-headers.xlsx` | Excel upload / headers demo |
| `tests/data/invalid/*`                 | Negative / spoofed cases    |

List paths at inspect-time: MCP `list_test_fixtures` (optional `subdir`: `pdf`, `excel`, …).

Helper path: `fixturePath('pdf', 'sample-text.pdf')` from `@/support/pw`.

## Upload — fixture-first (not `@manual`)

**Do not** mark upload as `(@manual)`. **Do not** pause headed for the native OS dialog.

### Visible `<input type="file">`

```ts
import { uploadFixture } from '@/support/pw';

await uploadFixture(page.locator('input[type="file"]'), 'images/sample.png');
// or relative under tests/data/:
// await uploadFixture(locator, 'pdf/sample-text.pdf');
```

Under the hood: `locator.setInputFiles(absolutePath)`.

### Hidden input behind a button (file chooser)

```ts
import { uploadViaChooser } from '@/support/pw';

await uploadViaChooser(
  page,
  () => page.getByRole('button', { name: 'Pilih file' }).click(),
  'pdf/sample-text.pdf',
);
```

Uses `page.waitForEvent('filechooser')` + `chooser.setFiles(...)`.

### Requirement sketch

```markdown
### SC-02: Upload lampiran valid (@success @upload)

**Input Data:**

- fixture: tests/data/images/sample.png

**Langkah:**

1. Buka form upload
2. Pilih file fixture sample.png
3. Submit

**Hasil yang Diharapkan:**

- Nama file sample.png tampil di UI
- Pesan sukses upload muncul
```

## Download — save then envelope assert

```ts
import { downloadAndSave, assertDownloadedEnvelope } from '@/support/pw';

const {
  path: saved,
  suggestedFilename,
  size,
} = await downloadAndSave(page, () => page.getByRole('button', { name: 'Export' }).click());

await assertDownloadedEnvelope(saved, {
  minBytes: 1,
  ext: '.pdf', // or RegExp
  kind: 'pdf', // optional magic/kind
});
```

Files land under `test-results/downloads/` by default (override with `{ dir }`).

### Requirement sketch

```markdown
### SC-03: Export PDF (@success @download)

**Langkah:**

1. Buka detail dokumen
2. Klik Export PDF

**Hasil yang Diharapkan:**

- Browser mengunduh file dengan ekstensi .pdf
- Ukuran file > 0 byte
```

Combine with content tags when Hasil names specific tokens: `(@success @download @file-content)`.

## MCP vs committed tests

| Layer                    | Tools / API                                                                        | When                                                      |
| ------------------------ | ---------------------------------------------------------------------------------- | --------------------------------------------------------- |
| Inspect-time (agent)     | `list_test_fixtures`, `inspect_file`                                               | Pick fixture paths, check envelope before writing asserts |
| Runtime (committed spec) | `uploadFixture`, `uploadViaChooser`, `downloadAndSave`, `assertDownloadedEnvelope` | Always — never call MCP from a test                       |

After adding MCP tools: `npm run mcp:build` then **restart `qa-playwright-kit`**.

## Anti-patterns

| Avoid                                      | Prefer                                               |
| ------------------------------------------ | ---------------------------------------------------- |
| `(@manual)` for upload because “OS dialog” | Fixture + `setInputFiles` / `uploadViaChooser`       |
| Headed pause / human picks a file          | Path under `tests/data/` in Input Data               |
| Absolute machine-only paths in specs       | `fixturePath(...)` or repo-relative `tests/data/...` |
| Assert product domain schema in helpers    | Scenario-owned tokens in Hasil (content recipe)      |

## Demo

```bash
npx playwright test tests/demo/demo-file-capabilities.spec.ts --project=demo
```

## See also

- [PDF-EXCEL-CONTENT-ASSERT.md](PDF-EXCEL-CONTENT-ASSERT.md)
- [MANUAL-SCENARIOS.md](../MANUAL-SCENARIOS.md) — upload is **not** manual; PDF **layout** visual is
- `tests/data/README.md`
- Helpers: `src/support/pw/files.ts`
