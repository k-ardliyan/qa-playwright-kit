/** @jsxImportSource @kitajs/html */
import type { Children } from '@kitajs/html';
import { DashboardDocument } from '../../layouts/DashboardDocument';
import { AppNav } from '../../components/navigation/AppNav';
import { Breadcrumb } from '../../components/navigation/Breadcrumb';
import {
  IconPlay,
  IconSlidersHorizontal,
  IconTerminal,
  IconMonitor,
  IconSquarePen,
  IconEye,
} from '../../components/shared/icons';

export interface StudioPageProps {
  serveMode?: boolean;
}

/**
 * Web Studio — the non-coder control panel, rendered inside the SAME dashboard
 * shell as every other page (DashboardDocument).
 *
 * Layout: shadcn-style TABS (TabsList of triggers + TabsContent panels) so each
 * feature gets its own surface instead of one long scroll. The tab list is a
 * real button list; the client script drives the active state + panel swap.
 *
 * One behavioural inline `<script>` is emitted by `renderStudioScript()` in
 * `src/cli/routes/studio.ts`. It is contract-bound by the browser suite
 * (`src/__tests__/dashboard-browser/studio.spec.ts`), which pins these
 * ids/classes — do not rename without updating the spec:
 *   ids:   #f #slug #title #module #feature #authState #halamanAwal
 *          #scenarioTitle #steps #expected #legacy #scenarios #addScenario
 *          #preview #appenv #envbtn #authbtn #headed #speclist #spec
 *          #runbtn #stopbtn #log
 *   class: .scenario (with .sc-title .sc-steps .sc-expected children)
 */
export function StudioPage({ serveMode = true }: StudioPageProps) {
  const breadcrumbs = [{ label: 'Dashboard', href: '/dashboard' }, { label: 'Studio' }];
  const tabs: Array<{ id: string; label: string; icon: Children }> = [
    { id: 'requirement', label: 'Requirement', icon: <IconSquarePen size={15} /> },
    { id: 'run', label: 'Jalankan', icon: <IconPlay size={15} /> },
    { id: 'env', label: 'Environment', icon: <IconMonitor size={15} /> },
  ];

  return (
    <DashboardDocument pageTitle="Web Studio · QA Playwright Kit" includeChart={false}>
      {serveMode && <AppNav activeTab="studio" />}
      {serveMode && <Breadcrumb items={breadcrumbs} />}

      <section class="page-section studio-page" id="studio-page">
        <div class="section-header">
          <div>
            <h1 class="section-title">Web Studio</h1>
            <p class="section-subtitle">
              Panel kontrol QA — tulis requirement, atur environment &amp; sesi login, lalu jalankan
              spec tanpa terminal.
            </p>
          </div>
        </div>

        <div class="studio-tabs" id="studio-tabs">
          <div class="studio-tablist" role="tablist" aria-label="Bagian Studio">
            {tabs.map((t) => (
              <button
                type="button"
                class="studio-tab"
                role="tab"
                data-studio-tab={t.id}
                id={`tab-${t.id}`}
                aria-controls={`panel-${t.id}`}
                aria-selected="false"
                tabindex="-1"
              >
                {t.icon}
                <span safe>{t.label}</span>
              </button>
            ))}
          </div>

          {/* ── Panel: Requirement (+ side-by-side live preview) ─────────── */}
          <div
            class="studio-tabpanel"
            role="tabpanel"
            id="panel-requirement"
            aria-labelledby="tab-requirement"
            data-studio-panel="requirement"
          >
            <div class="studio-split" id="studio-split">
              <div class="panel studio-split__main">
                <div class="panel-header">
                  <h2 class="panel-title">
                    <IconSquarePen size={15} /> Tulis requirement
                  </h2>
                  <button
                    type="button"
                    class="btn btn-secondary"
                    id="previewToggle"
                    aria-expanded="true"
                    aria-controls="studio-preview-col"
                  >
                    <IconEye size={14} /> <span id="previewToggleLabel">Sembunyikan pratinjau</span>
                  </button>
                </div>

                <form id="f" class="studio-form">
                  <div class="studio-grid">
                    <label class="studio-field">
                      <span class="studio-field__label">Slug fitur</span>
                      <input
                        class="form-input"
                        id="slug"
                        name="slug"
                        required
                        pattern="[a-z0-9-]+"
                        autocomplete="off"
                        placeholder="mis. login-berhasil"
                      />
                      <span class="studio-field__hint">huruf kecil, angka, tanda hubung</span>
                    </label>

                    <label class="studio-field">
                      <span class="studio-field__label">Judul</span>
                      <input
                        class="form-input"
                        id="title"
                        name="title"
                        placeholder="Login berhasil"
                      />
                    </label>

                    <label class="studio-field">
                      <span class="studio-field__label">Modul</span>
                      <input class="form-input" id="module" name="module" placeholder="auth" />
                    </label>

                    <label class="studio-field">
                      <span class="studio-field__label">Fitur</span>
                      <input class="form-input" id="feature" name="feature" placeholder="login" />
                    </label>

                    <label class="studio-field">
                      <span class="studio-field__label">Perlu login?</span>
                      <select class="form-select" id="authState" name="authState">
                        <option>authenticated</option>
                        <option>unauthenticated</option>
                      </select>
                    </label>

                    <label class="studio-field">
                      <span class="studio-field__label">Halaman awal</span>
                      <input class="form-input" id="halamanAwal" name="halamanAwal" value="/" />
                    </label>
                  </div>

                  {/* Legacy single-scenario inputs — seeded into the first block
                      and hidden once "Tambah skenario" is pressed (#legacy). */}
                  <div id="legacy" class="studio-grid">
                    <label class="studio-field">
                      <span class="studio-field__label">Judul skenario</span>
                      <input
                        class="form-input"
                        id="scenarioTitle"
                        name="scenarioTitle"
                        placeholder="User login dengan email valid"
                      />
                    </label>
                    <label class="studio-field studio-field--wide">
                      <span class="studio-field__label">Langkah</span>
                      <textarea
                        class="form-textarea"
                        id="steps"
                        name="steps"
                        placeholder="Isi email &amp; password&#10;Klik tombol Login"
                      />
                    </label>
                    <label class="studio-field studio-field--wide">
                      <span class="studio-field__label">Hasil yang diharapkan</span>
                      <textarea
                        class="form-textarea"
                        id="expected"
                        name="expected"
                        placeholder="URL berubah ke /dashboard"
                      />
                    </label>
                  </div>

                  <div id="scenarios" class="studio-scenarios" />

                  <div class="studio-actions">
                    <button class="btn btn-secondary" type="button" id="addScenario">
                      Tambah skenario
                    </button>
                    <button class="btn btn-primary" type="submit">
                      Simpan requirement
                    </button>
                  </div>
                </form>
              </div>

              <div class="panel studio-split__aside" id="studio-preview-col">
                <div class="panel-header">
                  <h2 class="panel-title">
                    <IconTerminal size={15} /> Pratinjau
                  </h2>
                  <span class="badge badge--meta">Live</span>
                </div>
                <pre id="preview" class="studio-preview" aria-live="polite" />
              </div>
            </div>
          </div>

          {/* ── Panel: Run ──────────────────────────────────────────────── */}
          <div
            class="studio-tabpanel"
            role="tabpanel"
            id="panel-run"
            aria-labelledby="tab-run"
            data-studio-panel="run"
            hidden
          >
            <div class="panel">
              <div class="panel-header">
                <h2 class="panel-title">
                  <IconPlay size={15} /> Jalankan spec
                </h2>
                <span class="badge badge--meta">Log langsung</span>
              </div>

              <div class="studio-field studio-field--wide">
                <span class="studio-field__label">Spec (bisa pilih beberapa)</span>
                <div class="studio-combo" id="speccombo">
                  <input
                    class="form-input studio-combo__input"
                    id="spec"
                    placeholder="Cari spec…"
                    autocomplete="off"
                    role="combobox"
                    aria-expanded="false"
                    aria-controls="specmenu"
                  />
                  <div class="studio-combo__menu" id="specmenu" role="listbox" hidden />
                </div>
                {/* Canonical spec list — the option store the combobox renders from. */}
                <select
                  id="speclist"
                  class="sr-only"
                  multiple="multiple"
                  tabindex="-1"
                  aria-hidden="true"
                />
                <div class="studio-chips" id="specchips" />
              </div>

              <fieldset class="studio-runopts">
                <legend class="studio-runopts__legend">
                  <IconSlidersHorizontal size={14} /> Opsi jalankan
                </legend>
                <div class="studio-grid">
                  <label class="studio-field">
                    <span class="studio-field__label">Mode browser</span>
                    <select class="form-select" id="headlessmode">
                      <option value="true">Headless (latar belakang)</option>
                      <option value="false">Headed (lihat browser)</option>
                    </select>
                  </label>
                  <label class="studio-field">
                    <span class="studio-field__label">Urutan jalan</span>
                    <select class="form-select" id="runorder">
                      <option value="parallel">Paralel (lebih cepat)</option>
                      <option value="serial">Satu per satu (urut)</option>
                    </select>
                  </label>
                  <label class="studio-field studio-field--wide" id="slowmofield" hidden>
                    <span class="studio-field__label">
                      Slow-mo (ms per aksi) — hanya saat headed
                    </span>
                    <input
                      class="form-input"
                      id="slowmo"
                      type="number"
                      min="0"
                      max="10000"
                      step="50"
                      value="0"
                    />
                  </label>
                  <div class="studio-field studio-field--wide">
                    <span class="studio-field__label">Ukuran layar</span>
                    <div class="studio-vp">
                      <input
                        class="form-input"
                        id="vpwidth"
                        type="number"
                        min="320"
                        max="3840"
                        step="10"
                        value="1920"
                        aria-label="Lebar layar"
                      />
                      <span class="studio-vp__x" aria-hidden="true">
                        ×
                      </span>
                      <input
                        class="form-input"
                        id="vpheight"
                        type="number"
                        min="240"
                        max="2160"
                        step="10"
                        value="1080"
                        aria-label="Tinggi layar"
                      />
                    </div>
                  </div>
                </div>
              </fieldset>

              <div class="studio-actions">
                <button class="btn btn-primary" type="button" id="runbtn">
                  <IconPlay size={14} /> Run
                </button>
                {/* Stop only exists while a run is in flight. */}
                <button class="btn btn-secondary" type="button" id="stopbtn" hidden>
                  Stop
                </button>
              </div>

              <div id="runsummary" class="studio-summary" hidden aria-live="polite" />

              {/* Log auto-expands when a run starts; hidden until then. */}
              <details class="studio-logwrap" id="logwrap" hidden open>
                <summary class="studio-logwrap__summary">
                  <IconTerminal size={14} /> Log mentah
                </summary>
                <pre id="log" class="studio-log" aria-live="polite" />
              </details>
            </div>
          </div>

          {/* ── Panel: Environment & session ────────────────────────────── */}
          <div
            class="studio-tabpanel"
            role="tabpanel"
            id="panel-env"
            aria-labelledby="tab-env"
            data-studio-panel="env"
            hidden
          >
            <div class="panel">
              <div class="panel-header">
                <h2 class="panel-title">
                  <IconMonitor size={15} /> Environment &amp; sesi
                </h2>
              </div>

              <div id="env" class="studio-envstatus" aria-live="polite" />

              <div class="studio-envrow">
                <label class="studio-field studio-envrow__select">
                  <span class="studio-field__label">Environment</span>
                  <select class="form-select" id="appenv">
                    <option>local</option>
                    <option>dev</option>
                    <option>staging</option>
                    <option>production</option>
                  </select>
                </label>
                <button class="btn btn-secondary" type="button" id="envbtn">
                  Pakai
                </button>
              </div>

              <hr class="studio-divider" />

              <label class="studio-field studio-inline">
                <input type="checkbox" id="headed" />
                <span>Buka browser (OTP/CAPTCHA)</span>
              </label>
              <div class="studio-actions">
                <button class="btn btn-secondary" type="button" id="authbtn">
                  Refresh sesi login
                </button>
              </div>
              <p class="studio-hint">
                Sesi disimpan di <code>.auth/&lt;env&gt;/&lt;role&gt;.json</code>. Bila ada
                OTP/CAPTCHA, centang "Buka browser" lalu selesaikan di jendela yang terbuka.
              </p>
            </div>
          </div>
        </div>
      </section>
    </DashboardDocument>
  );
}
