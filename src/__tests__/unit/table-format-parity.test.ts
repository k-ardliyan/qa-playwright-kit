import { test, expect } from '@playwright/test';
import { compileRequirementFromText } from '../../../tools/mcp/src/tools/compile-requirement';
import { compileTestPlanFromText } from '../../../tools/mcp/src/tools/compile-test-plan';

/**
 * Dual-mode format contract: the table form and the legacy bullet form must
 * compile to the SAME contract shape.
 *
 * Fixtures are INLINE on purpose - a test must never depend on a documentation
 * file, or deleting docs silently deletes coverage.
 */

const TABLE_REQ = `# REQ-INV-001: Approve Invoice

## Metadata

| Field      | Nilai             |
| ---------- | ----------------- |
| Tags       | \`#finance #smoke\` |
| Prioritas  | \`high\`            |
| Auth state | \`authenticated\`   |
| Module     | \`finance\`         |
| Feature    | \`approve-invoice\` |
| Role scope | \`super-admin, finance, hrd\` |

## Access Matrix

| Role        | Access | Expectation                                      |
| ----------- | ------ | ------------------------------------------------ |
| super-admin | allow  | Bisa menyetujui dan menolak seluruh invoice      |
| finance     | allow  | Bisa menyetujui invoice yang berstatus pending   |
| hrd         | deny   | Tidak memiliki akses ke halaman approval finance |

## Kriteria Penerimaan

| ID    | Kriteria                                                          |
| ----- | ----------------------------------------------------------------- |
| AC-01 | Pengguna role finance dapat menyetujui invoice berstatus pending. |
| AC-02 | Status invoice berubah menjadi "Approved".                        |
| AC-03 | Role yang tidak berhak mendapat penolakan akses.                  |

## Skenario Uji

### SC-01: Finance Menyetujui Invoice (@success)

| Field                 | Nilai                                                                                                                                                                      |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Test ID               | \`TC-INV-001\`                                                                                                                                                               |
| Covers                | \`AC-01\`, \`AC-02\`                                                                                                                                                           |
| Role                  | \`finance\`                                                                                                                                                                  |
| Prekondisi            | Terdapat invoice berstatus pending.                                                                                                                                        |
| Input Data            | \`invoiceId: seed:invoice.pending\`<br>\`note: literal:Approved for Q3 payout\`                                                                                                |
| Langkah               | 1. Buka halaman detail invoice<br>2. Klik tombol Setujui<br>3. Masukkan catatan<br>4. Klik Konfirmasi                                                                       |
| Hasil yang Diharapkan | - Notifikasi sukses tampil<br>- Status badge berubah "Approved"<br>- Tombol Setujui tidak lagi tampil                                                                        |

---

### SC-02: HRD Ditolak (@access-restriction)

| Field                 | Nilai                                              |
| --------------------- | -------------------------------------------------- |
| Test ID               | \`TC-INV-002\`                                       |
| Covers                | \`AC-03\`                                           |
| Role                  | \`hrd\`                                              |
| Input Data            | \`targetUrl: literal:/finance/invoices\`             |
| Langkah               | 1. Buka URL /finance/invoices secara langsung      |
| Hasil yang Diharapkan | - Pesan Akses Ditolak tampil<br>- Tabel tidak dirender |
`;

/** Same requirement, legacy bullet form - must parse to the same contract. */
const BULLET_REQ = `# REQ-INV-001: Approve Invoice

## Metadata

- **Tags:** #finance #smoke
- **Prioritas:** high
- **Auth state:** authenticated
- **Module:** finance
- **Feature:** approve-invoice
- **Role scope:** super-admin, finance, hrd

## Kriteria Penerimaan

- **AC-01:** Pengguna role finance dapat menyetujui invoice berstatus pending.
- **AC-02:** Status invoice berubah menjadi "Approved".
- **AC-03:** Role yang tidak berhak mendapat penolakan akses.

## Skenario Uji

### SC-01: Finance Menyetujui Invoice (@success)

- **Test ID:** \`TC-INV-001\`
- **Covers:** \`AC-01\`, \`AC-02\`
- **Role:** \`finance\`

**Prekondisi:** Terdapat invoice berstatus pending.

**Input Data:**

- invoiceId: seed:invoice.pending
- note: literal:Approved for Q3 payout

**Langkah:**

1. Buka halaman detail invoice
2. Klik tombol Setujui
3. Masukkan catatan
4. Klik Konfirmasi

**Hasil yang Diharapkan:**

- Notifikasi sukses tampil
- Status badge berubah "Approved"
- Tombol Setujui tidak lagi tampil

---

### SC-02: HRD Ditolak (@access-restriction)

- **Test ID:** \`TC-INV-002\`
- **Covers:** \`AC-03\`
- **Role:** \`hrd\`

**Input Data:**

- targetUrl: literal:/finance/invoices

**Langkah:**

1. Buka URL /finance/invoices secara langsung

**Hasil yang Diharapkan:**

- Pesan Akses Ditolak tampil
- Tabel tidak dirender
`;

const TABLE_PLAN = `# PLAN-INV-001: Test Plan for Approve Invoice

## Metadata

| Field                   | Nilai                        |
| ----------------------- | ---------------------------- |
| Source requirement      | \`requirements/approve-invoice.md\` |
| Source requirement hash | \`abc123\`                     |
| Module                  | \`finance\`                    |
| Feature                 | \`approve-invoice\`            |

## Catalog Evidence

| Page        | Catalog                                          |
| ----------- | ------------------------------------------------ |
| \`invoice-detail\` | \`artifacts/selector-catalog/finance/invoice.json\` |

## Scenarios

### SC-01: Finance Menyetujui Invoice

| Field          | Nilai                                    |
| -------------- | ---------------------------------------- |
| Test ID        | \`TC-INV-001\`                             |
| Covers         | \`AC-01\`, \`AC-02\`                         |
| Actor          | \`finance\`                                |
| Auth Context   | \`finance\`                                |
| Execution Mode | \`automated\`                              |
| Data Setup     | Seed invoice in pending state            |
| Actions        | 1. Buka halaman detail<br>2. Klik Setujui<br>3. Masukkan catatan<br>4. Konfirmasi |
| Assertions     | \`[requirement]\` Status berubah Approved<br>\`[framework-derived]\` Network 200<br>\`[live-verification]\` Toast tampil |
| Locator Intent | \`button[data-action="approve"]\`<br>\`textarea[name="note"]\`<br>\`button[type="submit"]\` |

---

### SC-02: HRD Ditolak

| Field          | Nilai                                    |
| -------------- | ---------------------------------------- |
| Test ID        | \`TC-INV-002\`                             |
| Covers         | \`AC-03\`                                  |
| Actor          | \`hrd\`                                    |
| Execution Mode | \`automated\`                              |
| Actions        | 1. Buka URL /finance/invoices langsung   |
| Assertions     | \`[requirement]\` Akses ditolak            |

## Coverage Gaps

| Scenario | AC      | Reason                                               |
| -------- | ------- | ---------------------------------------------------- |
| \`SC-03\`  | \`AC-04\` | External OTP authentication requires physical device |
`;

test.describe('Dual-mode format parity (requirement + plan)', () => {
  test('table-format requirement compiles to the expected contract shape', () => {
    const r = compileRequirementFromText(TABLE_REQ, 'requirements/approve-invoice.md');

    expect(r.status).toBe('success');
    const req = r.data!;
    expect(req.module).toBe('finance');
    expect(req.feature).toBe('approve-invoice');
    expect(req.acceptanceCriteria.map((a) => a.id)).toEqual(['AC-01', 'AC-02', 'AC-03']);
    expect(req.scenarios.length).toBe(2);

    const s1 = req.scenarios[0];
    expect(s1.testId).toBe('TC-INV-001');
    expect(s1.covers).toEqual(expect.arrayContaining(['AC-01', 'AC-02']));
    expect(s1.actor).toBe('finance');
    expect(s1.steps.length).toBe(4);
    expect(s1.steps[0]).toContain('Buka halaman detail invoice');
    expect(s1.expectations.length).toBeGreaterThanOrEqual(3);
    expect(s1.inputData.some((i) => i.source === 'seed')).toBe(true);

    // Access Matrix (a 3-column table) is unaffected by the 2-column label reader.
    const matrix = req.accessMatrix ?? [];
    expect(matrix.length).toBe(3);
    expect(matrix.find((m) => m.role === 'hrd')?.access).toBe('deny');
  });

  test('legacy bullet requirement compiles to the SAME contract as the table one', () => {
    const table = compileRequirementFromText(TABLE_REQ, 'requirements/approve-invoice.md');
    const bullet = compileRequirementFromText(BULLET_REQ, 'requirements/approve-invoice.md');

    expect(table.status).toBe('success');
    expect(bullet.status).toBe('success');

    // The two shapes must be interchangeable.
    expect(bullet.data!.module).toBe(table.data!.module);
    expect(bullet.data!.feature).toBe(table.data!.feature);
    expect(bullet.data!.tags).toEqual(table.data!.tags);
    expect(bullet.data!.acceptanceCriteria).toEqual(table.data!.acceptanceCriteria);
    expect(bullet.data!.scenarios.length).toBe(table.data!.scenarios.length);

    for (let i = 0; i < table.data!.scenarios.length; i++) {
      const t = table.data!.scenarios[i];
      const b = bullet.data!.scenarios[i];
      expect(b.id).toBe(t.id);
      expect(b.testId).toBe(t.testId);
      expect(b.type).toBe(t.type);
      expect(b.actor).toBe(t.actor);
      expect(b.covers).toEqual(t.covers);
      expect(b.steps).toEqual(t.steps);
      expect(b.expectations).toEqual(t.expectations);
      expect(b.inputData).toEqual(t.inputData);
    }
  });

  test('table-format plan compiles: scenarios, sections and coverage gaps', () => {
    const r = compileTestPlanFromText(TABLE_PLAN, 'specs/approve-invoice.plan.md');

    expect(r.status).toBe('success');
    const plan = r.data!;
    expect(plan.module).toBe('finance');
    expect(plan.feature).toBe('approve-invoice');
    expect(plan.scenarios.length).toBe(2);

    const s1 = plan.scenarios[0];
    expect(s1.testId).toBe('TC-INV-001');
    expect(s1.actions.length).toBe(4);
    expect(s1.assertions.length).toBe(3);
    expect(s1.locatorIntent.length).toBe(3);

    // Coverage Gaps table row -> one gap
    expect(plan.coverageGaps.length).toBe(1);
    expect(plan.coverageGaps[0].scenarioId).toBe('SC-03');
    expect(plan.coverageGaps[0].acceptanceCriterionId).toBe('AC-04');
  });
});
