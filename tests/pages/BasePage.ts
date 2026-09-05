import { type Locator, type Page, expect } from '@playwright/test';
import { downloadAndSave } from '@/support/pw/files';

/**
 * BasePage — Fondasi tangguh untuk semua Page Object.
 *
 * Sesuai dengan Playwright Best Practices:
 * 1. Tidak membungkus API native sederhana (click, fill, dll) secara redundan.
 * 2. Memfokuskan diri pada utilities tingkat tinggi yang menyelesaikan gotchas nyata di Playwright:
 *    - Navigasi & Load State (networkidle, domcontentloaded)
 *    - Penanganan Dynamic Dialogs (alert, confirm, prompt)
 *    - Penanganan Skenario Multi-Tab / New Windows
 *    - File Upload & Download dengan penanganan event-promise
 *    - Penanganan elemen async global (loading spinner)
 */
export class BasePage {
  constructor(public readonly page: Page) {}

  // ── NAVIGASI & LOAD STATE ──────────────────────────────────────────────────

  /** Buka URL dan tunggu DOM konten ter-load penuh. */
  async navigate(url: string): Promise<void> {
    await this.page.goto(url);
    await this.waitForLoad();
  }

  /** Tunggu halaman visual-ready secara tangguh. */
  async waitForLoad(timeout = 10_000): Promise<void> {
    try {
      // Prioritaskan domcontentloaded untuk kecepatan, lalu coba networkidle secara aman
      await this.page.waitForLoadState('domcontentloaded', { timeout: 5000 });
      await this.page.waitForLoadState('networkidle', { timeout: timeout - 5000 });
    } catch {
      // Long-polling/SSE sering menahan status networkidle — abaikan jika timeout
      // karena halaman sudah visual-ready bagi pengguna.
    }
  }

  /** Refresh halaman dan tunggu selesai dimuat. */
  async reload(): Promise<void> {
    await this.page.reload();
    await this.waitForLoad();
  }

  /** Kembali ke halaman sebelumnya (browser back). */
  async goBack(): Promise<void> {
    await this.page.goBack();
    await this.waitForLoad();
  }

  // ── DIALOGS (JS ALERT/CONFIRM/PROMPT) ──────────────────────────────────────

  /**
   * Menyiapkan handler untuk Dialog browser berikutnya.
   * @param action 'accept' | 'dismiss'
   * @param expectedText Teks pesan opsional yang ingin diverifikasi di dalam dialog
   */
  async handleNextDialog(action: 'accept' | 'dismiss', expectedText?: string): Promise<void> {
    this.page.once('dialog', async (dialog) => {
      if (expectedText) {
        expect(dialog.message()).toContain(expectedText);
      }
      if (action === 'accept') {
        await dialog.accept();
      } else {
        await dialog.dismiss();
      }
    });
  }

  // ── MULTI-TAB / NEW WINDOWS ────────────────────────────────────────────────

  /**
   * Mengeksekusi aksi yang membuka tab baru dan mengembalikan Page dari tab baru tersebut.
   * @param triggerAction Aksi (seperti klik tombol) yang memicu pembukaan tab baru.
   */
  async waitForNewTab(triggerAction: () => Promise<void>): Promise<Page> {
    const pagePromise = this.page.context().waitForEvent('page');
    await triggerAction();
    const newPage = await pagePromise;
    await newPage.waitForLoadState('domcontentloaded');
    return newPage;
  }

  // ── ADVANCED INTERACTION: UPLOAD & DOWNLOAD ───────────────────────────────

  /**
   * Menangani download file dan mengembalikan absolute path file yang terunduh.
   * Prefer `@/support/pw` `downloadAndSave` for new specs (same behavior).
   */
  async downloadFile(locator: Locator): Promise<string> {
    const result = await downloadAndSave(this.page, () => locator.click());
    return result.path;
  }

  /**
   * Mengunggah file ke input secara aman.
   * Prefer `uploadFixture` or `dropFixture` from `@/support/pw` for paths under tests/data/.
   */
  async uploadFile(locator: Locator, filePath: string): Promise<void> {
    await locator.setInputFiles(filePath);
  }

  /**
   * Simulasikan drop file ke target element (dropzone).
   * Menggunakan Playwright locator.drop() synthetic DataTransfer.
   */
  async dropFile(locator: Locator, filePath: string): Promise<void> {
    await locator.drop({ files: [filePath] });
  }

  // ── MENUNGGU ELEMEN ASYNC GLOBAL ───────────────────────────────────────────

  /** Tunggu indikator busy hilang (generic, framework-agnostic). */
  async waitForBusyIndicatorGone(indicator: Locator, timeout = 15_000): Promise<void> {
    if ((await indicator.count()) > 0) {
      await expect(indicator.first()).toBeHidden({ timeout });
    }
  }

  /** Backward-compatible wrapper untuk spinner MUI lama. */
  async waitForSpinnerGone(timeout = 15_000): Promise<void> {
    const spinner = this.page.locator('.MuiCircularProgress-root');
    await this.waitForBusyIndicatorGone(spinner, timeout);
  }

  private escapeRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  // ── BACA & VERIFIKASI HALAMAN ──────────────────────────────────────────────

  /** Assert URL saat ini mengandung teks tertentu. */
  async expectUrlContains(partial: string): Promise<void> {
    await expect(this.page).toHaveURL(new RegExp(partial.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }

  /** Assert <title> tab mengandung teks tertentu. */
  async expectTitleContains(partial: string): Promise<void> {
    await expect(this.page).toHaveTitle(new RegExp(partial, 'i'));
  }

  /**
   * Pilih opsi dari autocomplete secara robust (generic, tidak terikat framework UI).
   */
  async selectAutocompleteOption(
    input: Locator,
    value: string,
    options?: {
      listbox?: Locator;
      clearButton?: Locator;
      exactMatch?: boolean;
      typingDelay?: number;
      timeout?: number;
      waitForBusyIndicator?: Locator;
    },
  ): Promise<void> {
    if (!value) return;

    const timeout = options?.timeout ?? 8000;
    const typingDelay = options?.typingDelay ?? 30;
    const exactMatch = options?.exactMatch ?? true;

    await expect(input).toBeVisible({ timeout });
    await input.click();

    if (options?.clearButton && (await options.clearButton.isVisible())) {
      await options.clearButton.click();
    }

    await input.fill('');
    await input.pressSequentially(value, { delay: typingDelay });

    const listbox = options?.listbox ?? this.page.getByRole('listbox').last();
    await expect(listbox).toBeVisible({ timeout });

    const escaped = this.escapeRegex(value);
    const roleOptions = listbox.getByRole('option');

    let targetOption = exactMatch
      ? roleOptions.filter({ hasText: new RegExp(`^\\s*${escaped}\\s*$`, 'i') }).first()
      : roleOptions.filter({ hasText: new RegExp(escaped, 'i') }).first();

    if ((await targetOption.count()) === 0) {
      targetOption = roleOptions.filter({ hasText: new RegExp(escaped, 'i') }).first();
    }

    await expect(targetOption).toBeVisible({ timeout });
    await targetOption.click();

    await expect(listbox).toBeHidden({ timeout });

    if (options?.waitForBusyIndicator) {
      await this.waitForBusyIndicatorGone(options.waitForBusyIndicator, timeout);
    }
  }

  /** Backward-compatible alias dari helper lama. */
  async fillAndSelectAutocomplete(autocompleteLocator: Locator, value: string): Promise<void> {
    await this.selectAutocompleteOption(autocompleteLocator, value, {
      waitForBusyIndicator: this.page.locator('.MuiCircularProgress-root'),
      clearButton: this.page.getByRole('button', { name: /Clear|Bersihkan/i }).first(),
    });
  }

  async selectOptionFromListbox(trigger: Locator, value: string, timeout = 5000): Promise<void> {
    await trigger.click();
    const listbox = this.page.getByRole('listbox').last();
    await expect(listbox).toBeVisible({ timeout });
    const option = listbox
      .getByRole('option')
      .filter({ hasText: new RegExp(`^\\s*${this.escapeRegex(value)}\\s*$`, 'i') })
      .first();
    await expect(option).toBeVisible({ timeout });
    await option.click();
    await expect(listbox).toBeHidden({ timeout });
  }

  async selectFirstOptionFromListbox(trigger: Locator, timeout = 5000): Promise<void> {
    await trigger.click();
    const listbox = this.page.getByRole('listbox').last();
    await expect(listbox).toBeVisible({ timeout });
    const firstOption = listbox.getByRole('option').first();
    await expect(firstOption).toBeVisible({ timeout });
    await firstOption.click();
    await expect(listbox).toBeHidden({ timeout });
  }

  async selectOptionByDataValueFromListbox(
    trigger: Locator,
    value: string,
    timeout = 5000,
  ): Promise<void> {
    await trigger.click();
    const listbox = this.page.getByRole('listbox').last();
    await expect(listbox).toBeVisible({ timeout });
    const option = listbox.locator(`li[data-value="${value}"]`).first();
    await expect(option).toBeVisible({ timeout });
    await option.click();
    await expect(listbox).toBeHidden({ timeout });
  }

  /** Verifikasi toast notification yang muncul di layar */
  async waitForToast(
    pattern: RegExp | string,
    _type: 'success' | 'error' | 'any' = 'any',
    timeout = 7000,
  ): Promise<void> {
    const selector = 'div[role="status"], div[role="alert"], .hot-toast-bar, .toast';
    const toast = this.page.locator(selector).getByText(pattern).first();
    await toast.waitFor({ state: 'visible', timeout });
    await toast.waitFor({ state: 'hidden', timeout: timeout + 3000 });
  }
}
