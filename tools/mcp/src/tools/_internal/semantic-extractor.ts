/**
 * Semantic Extractor for Live Web Pages (15 W3C WAI-ARIA APG & SaaS Patterns)
 */

import type { Page } from 'playwright';
import type {
  SemanticCatalog,
  SemanticTable,
  SemanticTreegrid,
  SemanticTreeView,
  SemanticKanbanBoard,
  SemanticRadioGroup,
  SemanticToggleSwitch,
  SemanticSlider,
  SemanticSpinbutton,
  SemanticBreadcrumb,
  SemanticPagination,
  SemanticAccordion,
  SemanticActionMenu,
  SemanticCommandPalette,
  SemanticChart,
  SemanticProgressBar,
  SemanticStatCard,
  SemanticTab,
  SemanticStepper,
  SemanticFormInput,
  SemanticUploadDropzone,
  SemanticModalOrDrawer,
  SemanticRbacSignal,
  SemanticAlertOrToast,
  SemanticSubRoute,
} from '../../contracts/semantic-catalog';

export function normalizeSubRoutePattern(urlPath: string): string {
  try {
    const segments = urlPath.split('/').filter((s) => s.length > 0);
    const normalized = segments.map((seg) => {
      if (
        /^\d+$/.test(seg) ||
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(seg) ||
        /^[A-Z]{2,6}-\d+.*$/i.test(seg) ||
        /^[0-9a-f]{20,}$/i.test(seg)
      ) {
        return ':id';
      }
      return seg;
    });
    return '/' + normalized.join('/');
  } catch {
    return urlPath;
  }
}

export async function extractSemanticCatalog(page: Page, role?: string): Promise<SemanticCatalog> {
  const currentUrl = page.url();

  const extracted = (await page.evaluate(`(() => {
    // 1. Tables & Grids
    const tables = [];
    document.querySelectorAll('table, [role="table"], [role="grid"]').forEach((t, tIdx) => {
      const name =
        t.getAttribute('aria-label') ||
        (t.querySelector('caption') ? t.querySelector('caption').textContent.trim() : '') ||
        ('Table-' + (tIdx + 1));

      const headers = [];
      t.querySelectorAll('th, [role="columnheader"]').forEach((th) => {
        const txt = (th.textContent || '').trim();
        if (txt && !headers.includes(txt)) headers.push(txt);
      });

      const rows = t.querySelectorAll('tbody tr, [role="row"]:not(:first-child)');
      let sampleRow;
      const rowActions = [];
      let hasExpandableRows = false;

      if (rows.length > 0) {
        const firstRow = rows[0];
        const cells = firstRow ? firstRow.querySelectorAll('td, [role="cell"]') : [];
        if (cells.length > 0 && headers.length > 0) {
          sampleRow = {};
          cells.forEach((c, idx) => {
            const h = headers[idx] || ('Col-' + (idx + 1));
            sampleRow[h] = (c.textContent || '').trim().slice(0, 100);
          });
        }

        rows.forEach((r) => {
          if (r.hasAttribute('aria-expanded')) hasExpandableRows = true;
          r.querySelectorAll('button, a, [role="button"]').forEach((btn) => {
            const aLabel = (btn.getAttribute('aria-label') || btn.textContent || '').trim();
            if (aLabel && !rowActions.includes(aLabel) && aLabel.length < 40) {
              rowActions.push(aLabel);
            }
          });
        });
      }

      if (headers.length > 0 || rows.length > 0) {
        tables.push({
          name,
          headers,
          sampleRow,
          rowActions: rowActions.slice(0, 10),
          totalRowsObserved: rows.length,
          hasExpandableRows,
        });
      }
    });

    // 2. Treegrids
    const treegrids = [];
    document.querySelectorAll('[role="treegrid"]').forEach((tg, idx) => {
      const name = tg.getAttribute('aria-label') || ('Treegrid-' + (idx + 1));
      const headers = [];
      tg.querySelectorAll('[role="columnheader"]').forEach((th) => {
        const txt = (th.textContent || '').trim();
        if (txt) headers.push(txt);
      });
      const expandedRowsCount = tg.querySelectorAll('[role="row"][aria-expanded="true"]').length;
      treegrids.push({ name, headers, expandedRowsCount });
    });

    // 3. Tree Views
    const treeViews = [];
    document.querySelectorAll('[role="tree"], .tree-view').forEach((tv, idx) => {
      const name = tv.getAttribute('aria-label') || ('TreeView-' + (idx + 1));
      const rootNodes = [];
      tv.querySelectorAll(':scope > [role="treeitem"], :scope > li').forEach((item) => {
        const txt = (item.textContent || '').trim().slice(0, 40);
        if (txt) rootNodes.push(txt);
      });
      const totalItems = tv.querySelectorAll('[role="treeitem"]').length;
      treeViews.push({ name, rootNodes: rootNodes.slice(0, 10), totalItems });
    });

    // 4. Kanban Boards
    const kanbanBoards = [];
    const kanbanCols = document.querySelectorAll('.kanban-column, [data-testid*="kanban-col"]');
    if (kanbanCols.length > 0) {
      const columns = [];
      kanbanCols.forEach((col) => {
        const colTitle = (col.querySelector('.kanban-title, h3, h4, .title')?.textContent || '').trim() || 'Column';
        const cardCount = col.querySelectorAll('.kanban-card, [data-testid*="kanban-card"]').length;
        columns.push({ name: colTitle, cardCount });
      });
      kanbanBoards.push({ title: 'Kanban Workflow', columns });
    }

    // 5. Radio Groups & Segmented Controls
    const radioGroups = [];
    document.querySelectorAll('[role="radiogroup"], fieldset:has(input[type="radio"])').forEach((rg) => {
      const label = rg.getAttribute('aria-label') || rg.querySelector('legend')?.textContent?.trim() || 'Radio Group';
      const options = [];
      let selectedOption;
      rg.querySelectorAll('[role="radio"], input[type="radio"]').forEach((r) => {
        const oLabel = (r.getAttribute('aria-label') || r.closest('label')?.textContent || r.textContent || '').trim();
        if (oLabel) {
          options.push(oLabel);
          if (r.getAttribute('aria-checked') === 'true' || r.checked) selectedOption = oLabel;
        }
      });
      if (options.length > 0) {
        radioGroups.push({ label, options, selectedOption });
      }
    });

    // 6. Toggle Switches
    const toggleSwitches = [];
    document.querySelectorAll('[role="switch"]').forEach((sw) => {
      const label = (sw.getAttribute('aria-label') || sw.closest('label')?.textContent || sw.textContent || '').trim();
      const checked = sw.getAttribute('aria-checked') === 'true' || sw.classList.contains('active');
      if (label) toggleSwitches.push({ label, checked });
    });

    // 7. Sliders & Range Controls
    const sliders = [];
    document.querySelectorAll('[role="slider"], input[type="range"]').forEach((sl) => {
      const label = sl.getAttribute('aria-label') || sl.closest('label')?.textContent?.trim() || 'Slider';
      const min = Number(sl.getAttribute('aria-valuemin') || sl.getAttribute('min') || 0);
      const max = Number(sl.getAttribute('aria-valuemax') || sl.getAttribute('max') || 100);
      const step = Number(sl.getAttribute('step') || 1);
      const value = Number(sl.getAttribute('aria-valuenow') || sl.value || 0);
      sliders.push({ label, min, max, step, value });
    });

    // 8. Spinbuttons / Stepper Inputs
    const spinbuttons = [];
    document.querySelectorAll('[role="spinbutton"], input[type="number"]').forEach((sb) => {
      const label = sb.getAttribute('aria-label') || sb.closest('label')?.textContent?.trim() || sb.getAttribute('placeholder') || 'Number Input';
      const val = Number(sb.getAttribute('aria-valuenow') || sb.value || 0);
      spinbuttons.push({ label, value: val });
    });

    // 9. Breadcrumbs Navigation
    const breadcrumbs = [];
    document.querySelectorAll('nav[aria-label*="breadcrumb" i], .breadcrumb').forEach((bc) => {
      const items = [];
      bc.querySelectorAll('a, li, span').forEach((el) => {
        const t = (el.textContent || '').trim();
        if (t && !items.includes(t)) items.push(t);
      });
      if (items.length > 0) {
        breadcrumbs.push({ items, current: items[items.length - 1] });
      }
    });

    // 10. Pagination & Page Size
    const paginations = [];
    document.querySelectorAll('nav[aria-label*="pagination" i], .pagination').forEach((pg) => {
      const activeEl = pg.querySelector('[aria-current="page"], .active');
      const currentPage = activeEl ? Number(activeEl.textContent?.trim()) : 1;
      const hasPrev = Boolean(pg.querySelector('button[aria-label*="prev" i], .prev, [rel="prev"]'));
      const hasNext = Boolean(pg.querySelector('button[aria-label*="next" i], .next, [rel="next"]'));
      paginations.push({ currentPage: isNaN(currentPage) ? 1 : currentPage, hasPrevious: hasPrev, hasNext: hasNext });
    });

    // 11. Accordions & Disclosures
    const accordions = [];
    document.querySelectorAll('details, [data-accordion], .accordion').forEach((acc) => {
      const title = (acc.querySelector('summary, .accordion-header, [data-accordion-trigger]')?.textContent || '').trim();
      const expanded = acc.hasAttribute('open') || acc.querySelector('[aria-expanded="true"]') !== null;
      if (title) accordions.push({ title, expanded });
    });

    // 12. Action Menus (Meatball / Dropdown Menu)
    const actionMenus = [];
    document.querySelectorAll('button[aria-haspopup="menu"], [data-dropdown-toggle]').forEach((btn) => {
      const triggerLabel = (btn.getAttribute('aria-label') || btn.textContent || '').trim();
      if (triggerLabel) {
        actionMenus.push({ triggerLabel, menuItems: [] });
      }
    });

    // 13. Command Palettes
    const commandPalettes = [];
    const cmdEl = document.querySelector('[data-command-palette], [role="combobox"][placeholder*="Type a command" i]');
    if (cmdEl) {
      commandPalettes.push({
        placeholder: cmdEl.getAttribute('placeholder') || 'Search command...',
        shortcut: 'Cmd+K / Ctrl+K',
      });
    }

    // 14. Charts & Visualizations
    const charts = [];
    document.querySelectorAll('svg.recharts-surface, canvas, [role="img"][aria-label*="chart" i], .chart-container').forEach((ch, idx) => {
      const title = ch.getAttribute('aria-label') || ('Chart-' + (idx + 1));
      let chartType = 'unknown';
      if (ch.classList.contains('recharts-surface')) chartType = 'bar';
      const legends = [];
      ch.closest('.chart-wrapper, .card')?.querySelectorAll('.recharts-legend-item-text, .legend-item').forEach((lg) => {
        const lTxt = (lg.textContent || '').trim();
        if (lTxt) legends.push(lTxt);
      });
      charts.push({ title, chartType, legends });
    });

    // 15. Progress Bars & Meters
    const progressBars = [];
    document.querySelectorAll('[role="progressbar"], [role="meter"], progress').forEach((pb) => {
      const label = pb.getAttribute('aria-label') || 'Progress';
      const val = Number(pb.getAttribute('aria-valuenow') || pb.value || 0);
      const max = Number(pb.getAttribute('aria-valuemax') || pb.max || 100);
      progressBars.push({ label, valueNow: val, valueMax: max, percentage: max > 0 ? Math.round((val / max) * 100) : 0 });
    });

    // Stat Cards
    const statCards = [];
    document
      .querySelectorAll('.card, .stat-card, [data-testid*="stat"], [data-testid*="kpi"], article')
      .forEach((c) => {
        const heading = c.querySelector('h1, h2, h3, h4, h5, h6, .title, .label');
        const valueEl = c.querySelector(
          '.value, .metric, .number, .amount, .count, [class*="text-2xl"], [class*="text-3xl"]',
        );
        if (heading && valueEl) {
          const title = (heading.textContent || '').trim();
          const value = (valueEl.textContent || '').trim();
          if (title && value && title.length < 50 && value.length < 50) {
            const descEl = c.querySelector('.desc, .description, .muted, [class*="text-muted"]');
            statCards.push({
              title,
              value,
              description: descEl ? descEl.textContent.trim() : undefined,
            });
          }
        }
      });

    // Tabs
    const tabs = [];
    document.querySelectorAll('[role="tablist"] [role="tab"], .nav-tabs .nav-link').forEach((tab) => {
      const label = (tab.getAttribute('aria-label') || tab.textContent || '').trim();
      const active =
        tab.getAttribute('aria-selected') === 'true' ||
        tab.classList.contains('active') ||
        tab.hasAttribute('data-active');
      if (label && !tabs.some((t) => t.label === label)) {
        tabs.push({ label, active });
      }
    });

    // Steppers
    const steppers = [];
    const stepperEls = document.querySelectorAll('.stepper, [role="progressbar"], .wizard-steps');
    stepperEls.forEach((s) => {
      const stepItems = s.querySelectorAll('.step, [data-step], li');
      const steps = [];
      let currentStepIndex = 0;
      stepItems.forEach((st, idx) => {
        const sTxt = (st.textContent || '').trim();
        if (sTxt) steps.push(sTxt);
        if (
          st.getAttribute('aria-current') === 'step' ||
          st.classList.contains('active') ||
          st.classList.contains('current')
        ) {
          currentStepIndex = idx;
        }
      });
      if (steps.length > 0) {
        steppers.push({
          steps,
          currentStepIndex,
          currentStepLabel: steps[currentStepIndex],
        });
      }
    });

    // Forms
    const forms = [];
    document
      .querySelectorAll('input:not([type="hidden"]), select, textarea, [role="combobox"]')
      .forEach((el) => {
        const tag = el.tagName.toLowerCase();
        let type = 'unknown';
        const inputType = el.getAttribute('type') || 'text';

        if (tag === 'textarea') type = 'textarea';
        else if (tag === 'select' || el.getAttribute('role') === 'combobox') type = 'combobox';
        else if (inputType === 'checkbox') type = 'checkbox';
        else if (inputType === 'radio') type = 'radio';
        else if (inputType === 'date') type = 'date';
        else if (['text', 'email', 'password', 'number', 'tel', 'url'].includes(inputType))
          type = 'textbox';

        let label = '';
        const id = el.getAttribute('id');
        if (id) {
          const lbl = document.querySelector('label[for="' + id + '"]');
          if (lbl) label = (lbl.textContent || '').trim();
        }
        if (!label) {
          label =
            el.getAttribute('aria-label') ||
            el.getAttribute('placeholder') ||
            el.getAttribute('name') ||
            '';
        }

        const placeholder = el.getAttribute('placeholder') || undefined;
        const required = el.hasAttribute('required') || el.getAttribute('aria-required') === 'true';

        const options = [];
        if (tag === 'select') {
          el.querySelectorAll('option').forEach((opt) => {
            const oTxt = (opt.textContent || '').trim();
            if (oTxt) options.push(oTxt);
          });
        }

        if (label && !forms.some((f) => f.label === label && f.type === type)) {
          forms.push({
            label,
            type,
            placeholder,
            required,
            options: options.length > 0 ? options.slice(0, 20) : undefined,
          });
        }
      });

    // Upload Dropzones
    const uploadDropzones = [];
    document
      .querySelectorAll('input[type="file"], .dropzone, [data-testid*="upload"]')
      .forEach((up) => {
        const accept = up.getAttribute('accept');
        const label =
          up.getAttribute('aria-label') ||
          (up.closest('label') ? up.closest('label').textContent.trim() : '') ||
          'Upload File';
        uploadDropzones.push({
          label,
          acceptedFormats: accept ? accept.split(',').map((s) => s.trim()) : undefined,
        });
      });

    // Modals and Drawers
    const modalsAndDrawers = [];
    document
      .querySelectorAll(
        'button[aria-haspopup="dialog"], [data-toggle="modal"], [data-bs-toggle="modal"], [data-drawer-target]',
      )
      .forEach((btn) => {
        const triggerLabel = (btn.getAttribute('aria-label') || btn.textContent || '').trim();
        if (triggerLabel) {
          modalsAndDrawers.push({
            triggerLabel,
            type: btn.hasAttribute('data-drawer-target') ? 'drawer' : 'modal',
          });
        }
      });

    // RBAC Signals
    const rbacSignals = [];
    document
      .querySelectorAll(
        'button:disabled, [aria-disabled="true"], [disabled], .disabled button, [data-disabled="true"]',
      )
      .forEach((dis) => {
        const actionLabel = (dis.getAttribute('aria-label') || dis.textContent || '').trim();
        const tooltip =
          dis.getAttribute('title') ||
          dis.getAttribute('data-tooltip') ||
          dis.getAttribute('aria-description') ||
          undefined;
        if (actionLabel && actionLabel.length < 50) {
          rbacSignals.push({
            actionLabel,
            disabled: true,
            tooltipOrReason: tooltip,
          });
        }
      });

    // Alerts and Toasts
    const alertsAndToasts = [];
    document
      .querySelectorAll('[role="alert"], .alert, .toast, .notification, [aria-live="polite"]')
      .forEach((al) => {
        const text = (al.textContent || '').trim();
        let type = 'info';
        const cls = al.className.toLowerCase();
        if (cls.includes('danger') || cls.includes('error')) type = 'error';
        else if (cls.includes('warning') || cls.includes('warn')) type = 'warning';
        else if (cls.includes('success')) type = 'success';

        if (text && text.length < 200) {
          alertsAndToasts.push({ text, type });
        }
      });

    // Sub-routes
    const subRoutes = [];
    document.querySelectorAll('a[href]').forEach((a) => {
      const href = a.getAttribute('href');
      const label = (a.getAttribute('aria-label') || a.textContent || '').trim();
      if (
        href &&
        !href.startsWith('#') &&
        !href.startsWith('javascript:') &&
        !href.startsWith('mailto:') &&
        label &&
        label.length < 50
      ) {
        subRoutes.push({ label, targetUrl: href });
      }
    });

    return {
      tables,
      treegrids,
      treeViews,
      kanbanBoards,
      radioGroups,
      toggleSwitches,
      sliders,
      spinbuttons,
      breadcrumbs,
      paginations,
      accordions,
      actionMenus,
      commandPalettes,
      charts,
      progressBars,
      statCards,
      tabs,
      steppers,
      forms,
      uploadDropzones,
      modalsAndDrawers,
      rbacSignals,
      alertsAndToasts,
      subRoutes,
    };
  })()`)) as {
    tables: SemanticTable[];
    treegrids: SemanticTreegrid[];
    treeViews: SemanticTreeView[];
    kanbanBoards: SemanticKanbanBoard[];
    radioGroups: SemanticRadioGroup[];
    toggleSwitches: SemanticToggleSwitch[];
    sliders: SemanticSlider[];
    spinbuttons: SemanticSpinbutton[];
    breadcrumbs: SemanticBreadcrumb[];
    paginations: SemanticPagination[];
    accordions: SemanticAccordion[];
    actionMenus: SemanticActionMenu[];
    commandPalettes: SemanticCommandPalette[];
    charts: SemanticChart[];
    progressBars: SemanticProgressBar[];
    statCards: SemanticStatCard[];
    tabs: SemanticTab[];
    steppers: SemanticStepper[];
    forms: SemanticFormInput[];
    uploadDropzones: SemanticUploadDropzone[];
    modalsAndDrawers: SemanticModalOrDrawer[];
    rbacSignals: SemanticRbacSignal[];
    alertsAndToasts: SemanticAlertOrToast[];
    subRoutes: Array<{ label: string; targetUrl: string }>;
  };

  const mappedSubRoutes: SemanticSubRoute[] = [];
  const seenPatterns = new Set<string>();

  for (const sr of extracted.subRoutes) {
    try {
      const resolved = new URL(sr.targetUrl, currentUrl);
      if (resolved.origin === new URL(currentUrl).origin) {
        const pattern = normalizeSubRoutePattern(resolved.pathname);
        const isSample = seenPatterns.has(pattern);
        seenPatterns.add(pattern);

        mappedSubRoutes.push({
          label: sr.label,
          targetUrl: resolved.pathname + resolved.search,
          routePattern: pattern,
          isSampleOnly: isSample,
        });
      }
    } catch {
      // skip invalid URLs
    }
  }

  return {
    schemaVersion: 'qa.semantic-catalog/v1',
    url: currentUrl,
    role,
    capturedAt: new Date().toISOString(),
    tables: extracted.tables,
    treegrids: extracted.treegrids,
    treeViews: extracted.treeViews,
    kanbanBoards: extracted.kanbanBoards,
    radioGroups: extracted.radioGroups,
    toggleSwitches: extracted.toggleSwitches,
    sliders: extracted.sliders,
    spinbuttons: extracted.spinbuttons,
    breadcrumbs: extracted.breadcrumbs,
    paginations: extracted.paginations,
    accordions: extracted.accordions,
    actionMenus: extracted.actionMenus,
    commandPalettes: extracted.commandPalettes,
    charts: extracted.charts,
    progressBars: extracted.progressBars,
    statCards: extracted.statCards,
    tabs: extracted.tabs,
    steppers: extracted.steppers,
    forms: extracted.forms,
    uploadDropzones: extracted.uploadDropzones,
    modalsAndDrawers: extracted.modalsAndDrawers,
    rbacSignals: extracted.rbacSignals,
    alertsAndToasts: extracted.alertsAndToasts,
    subRoutes: mappedSubRoutes.slice(0, 30),
  };
}
