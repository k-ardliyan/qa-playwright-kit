# Resolusi Error `net::ERR_BLOCKED_BY_CLIENT` & Browser Discovery Checklist

Gunakan referensi ini saat AI agent menemui error `net::ERR_BLOCKED_BY_CLIENT` atau kegagalan navigasi browser saat melakukan eksplorasi UI.

---

## 1. Fakta & Diagnosis (Anti-Halusinasi)

Jangan berasumsi bahwa:
- Website target down atau tidak bisa dijangkau.
- Halaman web memblokir bot / IP secara permanen.
- Fitur live UI exploration tidak dapat dilakukan dan harus di-skip atau diubah jadi `@manual`.

### Penyebab Nyata
Error `net::ERR_BLOCKED_BY_CLIENT` pada tool MCP `@playwright/mcp` (`browser_navigate`) **BUKAN** karena firewall server web target atau blokir dari web tujuan. Error ini dibangkitkan secara lokal oleh Chromium karena adanya flag keamanan `--allowed-origins`:
- Flag `--allowed-origins=<url>` diinisialisasi oleh MCP wrapper saat peluncuran.
- Jika URL target melakukan redirect, memuat resource dari domain lain, atau origin-nya berbeda sedikit pun dari daftar yang didaftarkan, Chromium lokal menolak request tersebut dengan kode status `net::ERR_BLOCKED_BY_CLIENT`.
- Dialog Windows `"Get an app to open this 'chrome' link"` muncul jika tool eksternal mencoba membuka URI skema `chrome://` di sistem Windows yang tidak memiliki handler default untuk protokol tersebut.

---

## 2. Solusi & Jalur Prioritas (Resolution Ladder)

Jika menemui kendala `ERR_BLOCKED_BY_CLIENT` atau kegagalan `browser_navigate`:

### Jalur 1 (Utama & Teruji): `qa-playwright-kit:snapshot_page`
Gunakan tool MCP internal kit terlebih dahulu:
```json
{
  "featureName": "auth",
  "pageName": "login",
  "url": "http://localhost:3000/login",
  "force": true
}
```
*(Ganti URL target sesuai `BASE_URL` aktif aplikasi Anda).*

**Keunggulan:**
- Tool ini menggunakan instance Playwright internal tanpa pembatasan origin kaku dari `@playwright/mcp`.
- Langsung mengekstrak semantic catalog dan ARIA snapshot ke `artifacts/selector-catalog/<feature>/<page>.json`.
- Selalu berhasil mengekstrak locator semantik (`getByRole`, `getByLabel`, dsb) tanpa terganggu oleh error client blocker.

### Jalur 2: CLI Smoke Test / Verifikasi Langsung
Jika perlu melakukan cek navigasi cepat tanpa MCP browser:
```bash
npx tsx -e "
import { chromium } from 'playwright';
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const res = await page.goto(process.env.BASE_URL || 'http://localhost:3000/login', { waitUntil: 'domcontentloaded' });
  console.log('STATUS:', res?.status(), 'TITLE:', await page.title());
  await browser.close();
})();"
```

### Jalur 3: Penyesuaian `allowed-origins` pada `@playwright/mcp`
Jika ingin menggunakan live interactive MCP `@playwright/mcp`:
1. Pastikan `BASE_URL` di environment terkonfigurasi dengan benar (misal: `http://localhost:3000` atau URL staging Anda).
2. Jangan menggunakan protokol kustom seperti `chrome://` di Windows; gunakan instance browser standar.
3. Tambahkan origin terkait ke `extraOrigins` di `src/shared/mcp/origin-resolver.ts` jika ada sub-domain atau API origin terpisah.

---

## 3. Checklist Sebelum Menyimpulkan "Browser Tidak Bisa Dibuka"

1. [ ] Jalankan `curl -I -L <URL>` di terminal. Jika return `200 OK`, server hidup.
2. [ ] Panggil `snapshot_page` dari server `qa-playwright-kit`.
3. [ ] Cek isi file `artifacts/selector-catalog/<feature>/<page>.json` untuk melihat hasil ekstraksi DOM.
4. [ ] Jangan mengubah skenario menjadi `@manual` hanya karena kendala `ERR_BLOCKED_BY_CLIENT` pada client MCP.
