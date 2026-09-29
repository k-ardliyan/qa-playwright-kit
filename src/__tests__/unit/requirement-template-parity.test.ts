import { test, expect } from '@playwright/test';
import { compileRequirementFromText } from '../../../tools/mcp/src/tools/compile-requirement';

/**
 * Contract tests for RequirementContractV1.
 *
 * Fixtures are INLINE on purpose: a test must never depend on a documentation
 * file, or deleting docs silently deletes coverage.
 */

/** A well-formed table-format requirement - must compile with zero diagnostics. */
const GOOD = `# REQ-AUTH-001: Login - Form Login

## Metadata

| Field        | Nilai                 |
| ------------ | --------------------- |
| Tags         | \`#auth #ui #smoke\`    |
| Prioritas    | \`high\`                |
| Auth state   | \`unauthenticated\`      |
| Halaman awal | \`/login\`              |
| Module       | \`auth\`                |
| Feature      | \`login-valid\`          |

## Kriteria Penerimaan

| ID    | Kriteria                                                    |
| ----- | ----------------------------------------------------------- |
| AC-01 | Login berhasil dengan kredensial valid.                     |
| AC-02 | Session tersimpan dan pengguna diarahkan ke \`/dashboard\`.    |

## Skenario Uji

### SC-01: Login Berhasil (@success)

| Field                 | Nilai                                                              |
| --------------------- | ------------------------------------------------------------------ |
| Test ID               | \`TC-AUTH-001\`                                                     |
| Covers                | \`AC-01\`, \`AC-02\`                                                 |
| Role                  | \`user\`                                                            |
| Prekondisi            | Pengguna di halaman login.                                         |
| Input Data            | \`email: credential:user.email\`<br>\`password: credential:user.password\` |
| Langkah               | 1. Buka halaman login<br>2. Isi email dan password<br>3. Klik tombol masuk |
| Hasil yang Diharapkan | - URL berpindah ke \`/dashboard\`<br>- Session tersimpan              |

---

### SC-02: Login Gagal (@failure)

| Field                 | Nilai                                                |
| --------------------- | ---------------------------------------------------- |
| Test ID               | \`TC-AUTH-002\`                                       |
| Covers                | \`AC-01\`                                             |
| Role                  | \`user\`                                              |
| Input Data            | \`email: literal:salah@example.com\`<br>\`password: literal:salah\` |
| Langkah               | 1. Buka halaman login<br>2. Isi kredensial salah<br>3. Klik tombol masuk |
| Hasil yang Diharapkan | - Pesan error tampil<br>- Tetap di halaman login      |
`;

/** A malformed requirement - must produce predictable diagnostics. */
const BAD = `# Tanpa Prefix REQ

## Metadata

| Field        | Nilai |
| ------------ | ----- |
| Tags         |       |
| Prioritas    |       |
| Auth state   |       |
| Halaman awal |       |

## Kriteria Penerimaan

| ID  | Kriteria                     |
| --- | ---------------------------- |
|     | Login harus bekerja dengan baik |
|     | Sistem harus aman            |

## Skenario Uji

### SC-01: Login

| Field  | Nilai          |
| ------ | -------------- |
| Covers | \`AC-99\`        |
| Langkah | 1. Coba login |
| Hasil  | Berhasil       |
`;

test.describe('Requirement contract (RequirementContractV1)', () => {
  test('well-formed table requirement compiles cleanly with 0 errors/warnings', () => {
    const result = compileRequirementFromText(GOOD, 'requirements/login-valid.md');

    expect(result.status).toBe('success');
    expect(result.data).toBeDefined();

    const req = result.data!;
    expect(req.schemaVersion).toBe('qa.requirement/v1');
    expect(req.requirementId).toBe('REQ-AUTH-001');
    expect(req.title).toContain('Login');
    expect(req.module).toBe('auth');
    expect(req.feature).toBe('login-valid');
    expect(req.acceptanceCriteria.map((a) => a.id)).toEqual(['AC-01', 'AC-02']);
    expect(req.scenarios.length).toBe(2);

    const s1 = req.scenarios[0];
    expect(s1.testId).toBe('TC-AUTH-001');
    expect(s1.type).toBe('success');
    expect(s1.covers).toEqual(expect.arrayContaining(['AC-01', 'AC-02']));
    expect(s1.actor).toBe('user');
    expect(s1.inputData.some((i) => i.source === 'credential')).toBe(true);

    const errorsOrWarnings = (req.diagnostics ?? []).filter(
      (d) => d.severity === 'error' || d.severity === 'warning',
    );
    expect(errorsOrWarnings).toHaveLength(0);
  });

  test('malformed requirement triggers predictable contract diagnostics', () => {
    const result = compileRequirementFromText(BAD, 'requirements/bad.md');

    expect(result.data).toBeDefined();
    const req = result.data!;
    expect(req.diagnostics).toBeDefined();
    expect(req.diagnostics!.length).toBeGreaterThan(0);

    const diagCodes = req.diagnostics!.map((d) => d.code);
    // Missing AC IDs (REQ_LEGACY_AC_BULLET) or unknown AC ref (REQ_UNKNOWN_AC_REFERENCE)
    expect(
      diagCodes.some(
        (code) => code === 'REQ_LEGACY_AC_BULLET' || code === 'REQ_UNKNOWN_AC_REFERENCE',
      ),
    ).toBe(true);
  });

  test('optional metadata fields are actually read by the parser', () => {
    // Regression: `Data scope` and `Environment scope` were documented in the
    // template but never parsed, so they silently came back as `[]` - fake
    // information in the docs. They must round-trip.
    const withScope = GOOD.replace(
      '| Feature      | `login-valid`          |',
      [
        '| Feature      | `login-valid`          |',
        '| Risk level   | `high`                 |',
        '| Data scope   | `seed:invoice.pending` |',
        '| Environment scope | `staging`         |',
      ].join('\n'),
    );
    expect(withScope).not.toBe(GOOD);

    const req = compileRequirementFromText(withScope, 'requirements/login-valid.md').data!;
    expect(req.dataScope).toEqual(['seed:invoice.pending']);
    expect(req.environmentScope).toEqual(['staging']);
    expect(req.risk).toEqual(['high']);
  });
});
