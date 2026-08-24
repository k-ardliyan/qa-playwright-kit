# Recipe: PDF text & Excel content assert

Scenario-driven content checks for downloaded or fixture files. **Needles and headers come from the requirement only** — helpers do not patent business fields (no fixed judul / kode / nama schema).

## Tags

| Tag               | When                                                                                   |
| ----------------- | -------------------------------------------------------------------------------------- |
| `(@file-content)` | Assert PDF plain text and/or Excel headers/structure                                   |
| `(@download)`     | Often combined when the file is produced by export                                     |
| `(@manual)`       | **Only** for PDF **layout** visual (spacing, alignment, typography) — not text content |

## Extract vs assert

| Goal                                       | Use                                                                   | Layer              |
| ------------------------------------------ | --------------------------------------------------------------------- | ------------------ |
| Peek raw PDF text while planning           | MCP `extract_pdf_text`                                                | Inspect-time       |
| Peek sheet names / headers / sample rows   | MCP `read_excel_summary`                                              | Inspect-time       |
| Envelope (kind, size, magic)               | MCP `inspect_file` or `assertDownloadedEnvelope` / `inspectFileLocal` | Inspect or runtime |
| **Committed test** must contain tokens     | `assertPdfContains(path, needles)`                                    | Runtime            |
| **Committed test** must have header labels | `assertExcelHeaders(path, headers)`                                   | Runtime            |

MCP tools are for **inspect-time** discovery. Specs that land in git assert with `@/support/pw` helpers.

```ts
import {
  assertPdfContains,
  assertExcelHeaders,
  extractPdfText,
  readExcelSummary,
  downloadAndSave,
} from '@/support/pw';

// After download (or fixturePath for static samples):
const { path: saved } = await downloadAndSave(page, () =>
  page.getByRole('button', { name: 'Export' }).click(),
);

// Needles = exact tokens from requirement Hasil / Input Data for THIS scenario
await assertPdfContains(saved, ['INV-2026-001', 'PT Contoh']);

// Headers = labels listed in the requirement for THIS scenario
await assertExcelHeaders(saved, ['Tanggal', 'Jumlah'], 0);
```

Optional inspect helpers (still scenario-owned matching if you assert yourself):

```ts
const text = await extractPdfText(saved);
const summary = await readExcelSummary(saved, { maxRows: 10 });
```

## Scenario-owned tokens (required)

Write expected content in the requirement. Generator and humans copy those strings into the assert call — nothing more.

```markdown
### SC-05: Export PDF berisi nomor dokumen (@success @download @file-content)

**Input Data:**

- document_no: INV-2026-001
- party_name: PT Contoh

**Langkah:**

1. Buka dokumen INV-2026-001
2. Klik Export PDF
3. Buka file unduhan

**Hasil yang Diharapkan:**

- File PDF terunduh (ukuran > 0)
- Teks PDF mengandung "INV-2026-001"
- Teks PDF mengandung "PT Contoh"
```

```markdown
### SC-06: Export Excel header kolom (@success @download @file-content)

**Hasil yang Diharapkan:**

- File .xlsx terunduh
- Header baris pertama memuat "Tanggal", "Jumlah", "Status"
```

## Anti-patterns

| Anti-pattern                                                                                    | Why bad                                       | Prefer                                                |
| ----------------------------------------------------------------------------------------------- | --------------------------------------------- | ----------------------------------------------------- |
| Hardcoded `assertPdfContains(path, ['Judul', 'Kode', 'Nama'])` in helpers or every product test | Patents a domain schema; wrong for other apps | Pass only tokens from **this** scenario’s Hasil       |
| Copying demo tokens (`QA-KIT-SAMPLE-PDF`) into product asserts                                  | Kit self-test only                            | Product tokens from requirement                       |
| Marking PDF **text** check as `(@manual)`                                                       | Text is automatable                           | `(@file-content)` + `assertPdfContains`               |
| Using `assertPdfContains` for layout/spacing/color                                              | Wrong tool                                    | `(@manual)` visual layout review                      |
| Calling MCP `extract_pdf_text` inside a committed `.spec.ts`                                    | MCP is inspect-time                           | Runtime helper `extractPdfText` / `assertPdfContains` |

## Manual vs automatable (PDF)

| Check                                     | Tag               | How                            |
| ----------------------------------------- | ----------------- | ------------------------------ |
| Plain-text tokens in PDF                  | `(@file-content)` | `assertPdfContains`            |
| Excel column headers named in requirement | `(@file-content)` | `assertExcelHeaders`           |
| Visual layout of PDF page                 | `(@manual)`       | Human review — reason in Hasil |

## MCP quick reference

| Tool                 | Returns                               |
| -------------------- | ------------------------------------- |
| `inspect_file`       | kind, size, magic (envelope only)     |
| `extract_pdf_text`   | raw plain text (optional `maxChars`)  |
| `read_excel_summary` | `sheetNames`, `headers`, `sampleRows` |
| `list_test_fixtures` | paths under `tests/data/`             |

Path scope: repo-relative under `tests/data/` or `artifacts/test-results/`.

After `npm run mcp:build` → **restart `qa-playwright-kit`**.

## Demo (kit tokens only)

```bash
npx playwright test tests/demo/demo-file-capabilities.spec.ts --project=demo
```

Demo uses `QA-KIT-SAMPLE-PDF` / `ColA` etc. for framework self-test — **do not** treat them as product expected fields.

## See also

- [FILE-UPLOAD-DOWNLOAD.md](FILE-UPLOAD-DOWNLOAD.md)
- [MANUAL-SCENARIOS.md](../MANUAL-SCENARIOS.md)
- Helpers: `src/support/pw/files.ts`, `src/support/pw/file-content-core.ts`
- `tests/data/README.md`
