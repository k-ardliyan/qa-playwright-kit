import { test, expect, type Page } from '@playwright/test';

/**
 * Dashboard browser suite — boots the real dashboard HTTP server (webServer in
 * config/playwright/dashboard.ts) against an isolated QA_REPORT_DIR seeded by
 * config/dashboard-seed.ts. Exercises the actual HTML, hash-router and
 * fragment/API stack — not just render units.
 */

/** Navigate to a hash route and wait for the fragment to settle. */
async function gotoHash(page: Page, hash: string): Promise<void> {
  await page.goto(`/#${hash}`);
  await page.waitForLoadState('domcontentloaded');
}

test.describe('dashboard overview', () => {
  test('home renders KPI summary cards and the latest run hero', async ({ page }) => {
    await gotoHash(page, '/');
    await expect(page.locator('h1, h2').first()).toBeVisible();

    // KPI summary: 2 total / 1 passed / 1 failed from the seeded summary.
    await expect(page.getByText('1', { exact: true }).first()).toBeVisible();
    // Latest run card appears (Test Run label or run requirement path).
    await expect(page.getByText(/Test Run|login-none/i).first()).toBeVisible();
  });

  test('nav links navigate to history via the hash router', async ({ page }) => {
    await gotoHash(page, '/');
    // Primary nav exposes History (table) — clicking switches fragment.
    const historyLink = page.locator('a[href*="#/history"], a[href*="history"]').first();
    await expect(historyLink).toBeVisible();
    await historyLink.click();
    await expect(page.locator('body')).toContainText('History');
  });
});

test.describe('dashboard history', () => {
  test('history lists archived runs with status chips', async ({ page }) => {
    await gotoHash(page, '/history');
    // Both seeded archives render as rows.
    await expect(page.getByText('8 Sept, 17:40').first()).toBeVisible();
    await expect(page.getByText('8 Sept, 17:00').first()).toBeVisible();
  });

  test('compare page renders pickers for baseline and candidate runs', async ({ page }) => {
    // Compare is a full server-rendered page (AppNav uses real paths), reachable
    // at /compare. Two archived runs are seeded, so pickers render.
    await page.goto('/compare');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('body')).toContainText(/Pick a baseline run/i);
    // Series filter select + combobox inputs for baseline/candidate.
    await expect(page.locator('select[name="series"]').first()).toBeVisible();
    await expect(page.locator('input[role="combobox"]').first()).toBeVisible();
  });
});

test.describe('dashboard detail', () => {
  test('overview surfaces failing test rows from the latest run', async ({ page }) => {
    await gotoHash(page, '/');
    // The attention panel lists the failed test title.
    await expect(page.locator('body')).toContainText(/Login with wrong password/i);
    await expect(page.locator('.attention-panel')).toBeVisible();
  });

  test('archived detail route renders decision and notes column', async ({ page }) => {
    // Detail fragment for the first archived run.
    await gotoHash(page, '/detail/run-20260908-174000-000');
    await expect(page.locator('body')).toContainText(/APPROVE|Decision/i);
  });
});

test.describe('dashboard interactions', () => {
  test('toggleDetailRow expands a row when invoked', async ({ page }) => {
    await gotoHash(page, '/latest');
    const firstExpandable = page
      .locator('[data-testid*="toggle"], button.toggle, .detail-toggle')
      .first();
    if ((await firstExpandable.count()) > 0) {
      await firstExpandable.click();
      // Row expansion reveals steps/attachments detail.
      await expect(
        page.locator('[class*="expanded"], [data-expanded="true"]').first(),
      ).toBeAttached();
    }
  });

  test('SSE heartbeat endpoint answers (server is alive)', async ({ page }) => {
    const response = await page.request.get('/heartbeat');
    expect(response.status()).toBe(200);
  });
});

test.describe('P3 additions: health panels, triage, deep-links', () => {
  test('overview shows the failure-source mix and module health panels', async ({ page }) => {
    await gotoHash(page, '/');
    await expect(page.locator('body')).toContainText('Failure source');
    await expect(page.locator('.mix-bar')).toBeAttached();
    await expect(page.locator('body')).toContainText('Module health');
    // Seed data: auth module exists in latest + archived runs.
    await expect(page.locator('.module-health-row').first()).toBeVisible();
  });

  test('latest detail page shows the triage strip for the failing run', async ({ page }) => {
    await page.goto('/latest');
    await page.waitForLoadState('domcontentloaded');
    // Seeded latest run has 1 failed test (wrong password).
    await expect(page.locator('.triage-strip')).toBeVisible();
    await expect(page.locator('.triage-group').first()).toBeVisible();
    // Suggested-decision button is present and wired to applyTriageDecision.
    const btn = page.locator('.triage-set-decision').first();
    await expect(btn).toBeVisible();
    expect(await btn.getAttribute('data-triage-decision')).toBeTruthy();
  });

  test('/history?decision=APPROVE deep-link preselects the filter', async ({ page }) => {
    await page.goto('/history?decision=APPROVE');
    await page.waitForLoadState('domcontentloaded');
    // Toolbar select is preselected.
    const decision = page.locator('#filter-history-decision');
    await expect(decision).toHaveValue('APPROVE');
    // Only the APPROVE row remains visible after the on-load filter.
    const visibleRows = page.locator('.history-row:visible');
    await expect(visibleRows).toHaveCount(1);
    await expect(visibleRows.first()).toContainText('APPROVE');
  });

  test('/latest?view=accordion deep-link activates the accordion server-side', async ({ page }) => {
    await page.goto('/latest?view=accordion');
    await page.waitForLoadState('domcontentloaded');
    const accordion = page.locator('#view-accordion');
    await expect(accordion).toHaveClass(/view-panel--active/);
    const table = page.locator('#view-table');
    await expect(table).toHaveClass(/view-panel--hidden/);
  });

  test('/latest?test=<id> deep-link opens the matching test card', async ({ page }) => {
    // Seeded failing test id in the latest run.
    await page.goto('/latest?test=SC-L2&view=accordion');
    await page.waitForLoadState('domcontentloaded');
    const card = page.locator('details#test-SC-L2');
    await expect(card).toBeAttached();
    await expect(card).toHaveAttribute('open', '');
  });

  test('/latest?test=<unknown-id> does not break the page', async ({ page }) => {
    const res = await page.goto('/latest?test=NOPE-404&view=accordion');
    expect(res?.status()).toBe(200);
    const card = page.locator('details#test-NOPE-404');
    await expect(card).toHaveCount(0);
  });
});

/**
 * The nav and filter toolbar each have two presentations, driven by a <dialog>
 * wrapper. An author `display` rule overrides the UA stylesheet's `display:
 * none` for a closed dialog REGARDLESS of specificity, so a base-level
 * `display: contents` leaks the contents into the header/toolbar at every
 * width. These tests pin the breakpoint behaviour that keeps them apart.
 */
test.describe('responsive chrome (nav + filter sheets)', () => {
  test('narrow: nav collapses to a menu button and the sheet opens modally', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/latest');
    await page.waitForLoadState('domcontentloaded');

    const nav = page.locator('#app-nav-sheet');
    // Closed dialog must not render its contents inline.
    await expect(nav).toBeHidden();
    await expect(page.locator('.app-header__nav')).toBeHidden();

    const menu = page.locator('.app-header__menu');
    await expect(menu).toBeVisible();
    await menu.click();

    await expect(nav).toBeVisible();
    // Modal, not a plain popover: the rest of the page goes inert.
    expect(await nav.evaluate((el: HTMLDialogElement) => el.matches(':modal'))).toBe(true);
    await expect(nav.getByRole('link', { name: 'History' })).toBeVisible();
  });

  test('narrow: filter controls live in the sheet, not the toolbar', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/latest');
    await page.waitForLoadState('domcontentloaded');

    const sheet = page.locator('#table-filter-sheet');
    await expect(sheet).toBeHidden();
    // No filter select is laid out anywhere on the page while the sheet is shut.
    // (`display: contents` flattens the box tree, so geometry — not the DOM
    // parent — is the honest test of whether a control is inline.)
    const laidOut = await page.evaluate(
      () =>
        [...document.querySelectorAll('#table-filter-sheet select')].filter(
          (s) => s.getBoundingClientRect().height > 0,
        ).length,
    );
    expect(laidOut).toBe(0);

    await page.locator('.filter-sheet-trigger').click();
    await expect(sheet).toBeVisible();
    await expect(sheet.locator('select').first()).toBeVisible();
  });

  test('wide: both wrappers dissolve and everything is inline', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/latest');
    await page.waitForLoadState('domcontentloaded');

    await expect(page.locator('.app-header__nav')).toBeVisible();
    await expect(page.locator('.app-header__menu')).toBeHidden();
    await expect(page.locator('.filter-sheet-trigger')).toBeHidden();

    // The filter controls are laid out INSIDE the toolbar row's box, which is
    // what "dissolved into the row" means visually.
    const inline = await page.evaluate(() => {
      const row = document.querySelector('.unified-toolbar__row');
      if (!row) return { total: 0, insideRow: 0 };
      const rowRect = row.getBoundingClientRect();
      const selects = [...document.querySelectorAll('#table-filter-sheet select')];
      return {
        total: selects.length,
        insideRow: selects.filter((s) => {
          const r = s.getBoundingClientRect();
          return r.height > 0 && r.top >= rowRect.top - 1 && r.bottom <= rowRect.bottom + 1;
        }).length,
      };
    });
    expect(inline.total).toBeGreaterThan(0);
    expect(inline.insideRow).toBe(inline.total);
  });

  test('no page-level horizontal overflow at phone width', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    for (const route of ['/', '/history', '/latest', '/compare']) {
      await page.goto(route);
      await page.waitForLoadState('domcontentloaded');
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      // The 13-column table scrolls inside its own wrapper; the DOCUMENT must not.
      expect(overflow, `page overflowed at ${route}`).toBeLessThanOrEqual(1);
    }
  });
});

/**
 * Control sizing. Buttons that share a flex row must share a height, or the row
 * reads as ragged. The bug this pins: `.btn-secondary` and `.btn-danger` were
 * missing from the base geometry rule (they are used WITHOUT `.btn`), so the
 * modal footer rendered a 28px "Cancel" beside a 36px "Save to History".
 */
test.describe('control sizing', () => {
  test('modal footer buttons share one height', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/latest');
    await page.waitForLoadState('domcontentloaded');
    await page.evaluate(() => {
      const w = window as unknown as { openSaveModal?: () => void };
      w.openSaveModal?.();
    });
    await page.waitForTimeout(400);

    const heights = await page.evaluate(() =>
      [...document.querySelectorAll('.modal-foot button')]
        // Only the modal that is actually open: hidden modals keep 0-height buttons.
        .map((b) => Math.round(b.getBoundingClientRect().height))
        .filter((h) => h > 0),
    );
    expect(heights.length).toBeGreaterThan(1);
    expect(new Set(heights).size, `heights differ: ${heights}`).toBe(1);
  });

  test('header and masthead action rows share one height', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/latest');
    await page.waitForLoadState('domcontentloaded');

    // The run actions moved from the global header to the report masthead, so
    // both rows carry controls now and both must stay internally consistent.
    const rows = await page.evaluate(() =>
      ['.app-header__actions', '.hero__run-actions'].map((sel) => ({
        sel,
        heights: [...document.querySelectorAll(`${sel} > *`)]
          .map((b) => Math.round(b.getBoundingClientRect().height))
          .filter((h) => h > 0),
      })),
    );
    const total = rows.reduce((n, r) => n + r.heights.length, 0);
    expect(total, 'no action controls found').toBeGreaterThan(1);
    for (const row of rows) {
      expect(new Set(row.heights).size, `${row.sel} heights differ: ${row.heights}`).toBe(1);
    }
  });

  test('every standalone .btn-* control gets an explicit height', async ({ page }) => {
    // Guards the root cause: a .btn-* class used without .btn must still be
    // sized, or it silently falls back to the UA default.
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/latest');
    await page.waitForLoadState('domcontentloaded');
    await page.evaluate(() => {
      const w = window as unknown as { openSaveModal?: () => void };
      w.openSaveModal?.();
    });
    await page.waitForTimeout(400);

    const unstyled = await page.evaluate(() => {
      const bad = [];
      for (const el of document.querySelectorAll('button, a')) {
        const cls = (el.className || '').toString();
        if (!/\bbtn-/.test(cls)) continue;
        const cs = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        if (r.height === 0) continue;
        // A UA-default button has no author border-radius and no padding-inline.
        if (parseFloat(cs.borderTopLeftRadius) === 0 && parseFloat(cs.paddingLeft) === 0) {
          bad.push(cls);
        }
      }
      return [...new Set(bad)];
    });
    expect(unstyled, `unstyled btn-* controls: ${unstyled.join(', ')}`).toEqual([]);
  });
});

/**
 * Bottom-sheet dismissal. A modal <dialog> gives focus trapping and Escape but
 * NOT click-outside-to-dismiss, so the sheets need an explicit backdrop handler
 * and a swipe gesture — both were missing.
 */
test.describe('bottom sheet dismissal', () => {
  /** Both sheets are <dialog> elements; read `.open` with the right type. */
  const sheetOpen = (page: Page, id: string) =>
    page.evaluate((sid) => (document.getElementById(sid) as HTMLDialogElement).open, id);

  test('clicking the backdrop closes the nav sheet', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/latest');
    await page.waitForLoadState('domcontentloaded');

    await page.locator('.app-header__menu').click();
    await page.waitForTimeout(300);
    expect(await sheetOpen(page, 'app-nav-sheet')).toBe(true);

    // Click well above the sheet: that lands on ::backdrop, i.e. the dialog box.
    await page.mouse.click(195, 100);
    await page.waitForTimeout(300);
    expect(await sheetOpen(page, 'app-nav-sheet')).toBe(false);
  });

  test('swiping down dismisses the filter sheet', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/latest');
    await page.waitForLoadState('domcontentloaded');

    await page.locator('.filter-sheet-trigger').click();
    await page.waitForTimeout(300);
    const top = await page.evaluate(
      () => document.getElementById('table-filter-sheet')!.getBoundingClientRect().top,
    );
    expect(await sheetOpen(page, 'table-filter-sheet')).toBe(true);

    await page.mouse.move(195, top + 14);
    await page.mouse.down();
    for (let i = 1; i <= 6; i++) {
      await page.mouse.move(195, top + 14 + i * 25);
    }
    await page.mouse.up();
    await page.waitForTimeout(500);

    expect(await sheetOpen(page, 'table-filter-sheet')).toBe(false);
  });

  test('a short, paused drag springs back instead of dismissing', async ({ page }) => {
    // Regression guard: the first swipe implementation dismissed on any
    // gesture that ended with target === dialog, so pressing the handle,
    // nudging 40px and letting go closed the sheet. Only a long drag OR a
    // genuine flick may dismiss.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/latest');
    await page.waitForLoadState('domcontentloaded');

    await page.locator('.filter-sheet-trigger').click();
    await page.waitForTimeout(300);
    const top = await page.evaluate(
      () => document.getElementById('table-filter-sheet')!.getBoundingClientRect().top,
    );

    await page.mouse.move(195, top + 14);
    await page.mouse.down();
    await page.mouse.move(195, top + 34);
    await page.mouse.move(195, top + 54);
    await page.waitForTimeout(250); // a pause means this is NOT a flick
    await page.mouse.up();
    await page.waitForTimeout(500);

    expect(await sheetOpen(page, 'table-filter-sheet')).toBe(true);
    // And it must have snapped back to its resting position.
    const transform = await page.evaluate(
      () => document.getElementById('table-filter-sheet')!.style.transform,
    );
    expect(transform).toBe('');
  });

  test('the drag handle carries the grab affordance', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/latest');
    await page.waitForLoadState('domcontentloaded');
    await page.locator('.filter-sheet-trigger').click();
    await page.waitForTimeout(300);

    const affordance = await page.evaluate(() => {
      const sheet = document.getElementById('table-filter-sheet')!;
      const handle = sheet.querySelector('.sheet-handle');
      const body = sheet.querySelector('.filter-sheet__body');
      return {
        handleCursor: handle ? getComputedStyle(handle).cursor : null,
        handleTouchAction: handle ? getComputedStyle(handle).touchAction : null,
        hasHandle: !!handle,
        handleWidth: handle ? Math.round(handle.getBoundingClientRect().width) : 0,
        // The scrolling body must NOT claim the gesture, or touch scroll dies.
        bodyTouchAction: body ? getComputedStyle(body).touchAction : null,
      };
    });
    expect(affordance.hasHandle).toBe(true);
    expect(affordance.handleWidth).toBeGreaterThan(20);
    // Grab affordance and gesture ownership live on the handle only.
    expect(affordance.handleCursor).toBe('grab');
    expect(affordance.handleTouchAction).toBe('none');
    expect(affordance.bodyTouchAction).not.toBe('none');
  });

  test('nav links inside the sheet still navigate (tap is not eaten by the drag)', async ({
    page,
  }) => {
    // Regression guard: taking pointer capture on pointerdown retargeted every
    // later pointer event — including the synthesized click — to the dialog, so
    // tapping a nav link inside the sheet did nothing.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/latest');
    await page.waitForLoadState('domcontentloaded');
    await page.locator('.app-header__menu').click();
    await page.waitForTimeout(400);

    await page.getByRole('link', { name: 'History' }).click();
    await page.waitForTimeout(1000);
    expect(page.url()).toContain('history');
    expect(await sheetOpen(page, 'app-nav-sheet')).toBe(false);
  });

  test('every header nav link navigates, at both widths', async ({ page }) => {
    // Scope to the main nav: "Dashboard" also appears in the breadcrumb, so an
    // unscoped role query is ambiguous.
    const mainNav = () => page.getByRole('navigation', { name: 'Main Navigation' });
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 });
      for (const [label, expected] of [
        ['Dashboard', 'dashboard'],
        ['History', 'history'],
        ['Compare', 'compare'],
      ]) {
        await page.goto('/latest');
        await page.waitForLoadState('domcontentloaded');
        if (width < 961) {
          await page.locator('.app-header__menu').click();
          await page.waitForTimeout(300);
        }
        await mainNav().getByRole('link', { name: label, exact: true }).click();
        await page.waitForTimeout(900);
        expect(page.url(), `${label} at ${width}px`).toContain(expected);
      }
    }
  });

  test('the default theme is light, regardless of OS preference', async ({ page }) => {
    // Emulate a dark-preferring OS: the dashboard must still open light.
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/latest');
    await page.waitForLoadState('domcontentloaded');
    const theme = await page.evaluate(() => document.documentElement.dataset.theme);
    expect(theme).toBe('light');
  });
});

/**
 * The accordion view. It used to render its own toolbar containing only a sort
 * select, so switching views hid the search box and every filter; the container
 * also carried its own padding, boxing the cards in narrower than the table.
 */
test.describe('accordion view', () => {
  test('shares the full toolbar (search + filters), not just a sort control', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/latest?view=accordion');
    await page.waitForLoadState('domcontentloaded');

    const toolbar = await page.evaluate(() => {
      const tb = document.querySelector('.unified-toolbar') as HTMLElement | null;
      if (!tb) return null;
      return {
        visible: !tb.hidden && getComputedStyle(tb).display !== 'none',
        hasSearch: !!tb.querySelector('#dash-search'),
        selects: tb.querySelectorAll('select').length,
      };
    });
    expect(toolbar, 'toolbar missing in accordion view').not.toBeNull();
    expect(toolbar!.visible).toBe(true);
    expect(toolbar!.hasSearch).toBe(true);
    expect(toolbar!.selects).toBeGreaterThan(2);
  });

  test('the accordion fills the page width with no extra padding', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/latest?view=accordion');
    await page.waitForLoadState('domcontentloaded');

    const m = await page.evaluate(() => {
      const acc = document.getElementById('view-accordion')!;
      const page = document.querySelector('.page')!;
      const cs = getComputedStyle(acc);
      return {
        padding: cs.padding,
        accW: Math.round(acc.getBoundingClientRect().width),
        pageInner: Math.round(
          page.getBoundingClientRect().width -
            2 * parseFloat(getComputedStyle(page).paddingLeft || '0') -
            2 *
              parseFloat(
                getComputedStyle(document.querySelector('.page > *') as Element).paddingLeft || '0',
              ),
        ),
      };
    });
    expect(m.padding).toBe('0px');
    // The accordion must not be narrower than the page's content box.
    expect(m.accW).toBeGreaterThan(1200);
  });

  test('group headers do not double up with the first card border', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/latest?view=accordion');
    await page.waitForLoadState('domcontentloaded');

    const stacked = await page.evaluate(() => {
      const out: Array<{ group: string; gap: number }> = [];
      document.querySelectorAll('#view-accordion .test-group').forEach((g) => {
        const hdr = g.querySelector('.test-group__header');
        const card = g.querySelector('.test-card');
        if (!hdr || !card) return;
        const gap = card.getBoundingClientRect().top - hdr.getBoundingClientRect().bottom;
        const cardTop = parseFloat(getComputedStyle(card).borderTopWidth);
        // A rule directly above another rule reads as a double divider.
        if (Math.abs(gap) < 4 && cardTop > 0) {
          out.push({ group: g.className, gap: Math.round(gap) });
        }
      });
      return out;
    });
    expect(stacked, `stacked dividers: ${JSON.stringify(stacked)}`).toEqual([]);
  });

  test('the failed verdict colour is a red, not the palette accent', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/latest');
    await page.waitForLoadState('domcontentloaded');

    // --destructive drives every "failed" affordance; it must read as red
    // (hue near 0/360), not as the pink accent the source palette ships.
    const hue = await page.evaluate(() => {
      const raw = getComputedStyle(document.documentElement)
        .getPropertyValue('--destructive')
        .trim();
      const probe = document.createElement('div');
      probe.style.color = raw;
      document.body.appendChild(probe);
      const rgb = getComputedStyle(probe).color.match(/\d+/g)!.map(Number);
      probe.remove();
      const [r, g, b] = rgb.map((v) => v / 255);
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const d = max - min;
      if (d === 0) return 0;
      let h: number;
      if (max === r) h = ((g - b) / d) % 6;
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60;
      return h < 0 ? h + 360 : h;
    });
    // Red sits near 0/360; the pink accent sat near 327. Allow a wide red band
    // but reject anything in the magenta/pink range.
    expect(hue < 45 || hue > 350, `--destructive hue ${hue} is not a red`).toBe(true);
  });

  test('the toolbar is a two-row grid with the trailing group flush right', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/latest?view=table');
    await page.waitForLoadState('domcontentloaded');

    // The filter count varies per run, so a single flex row wraps
    // unpredictably and `margin-left:auto` stranded the trailing group on its
    // own line with a ragged right-hand void. The desktop toolbar is instead a
    // fixed two-row grid: search + trailing controls on row 1, filters on row
    // 2. The invariant is that the trailing group ends flush with the row's
    // right edge (no void), and shares its line with the search field.
    const m = await page.evaluate(() => {
      const row = document.querySelector('.unified-toolbar__row')!;
      const search = document.querySelector('.cmd-search-wrap')!;
      const end = document.querySelector('.unified-toolbar__end')!;
      const body = document.querySelector('.filter-sheet__body')!;
      const r = (el: Element) => el.getBoundingClientRect();
      return {
        display: getComputedStyle(row).display,
        searchTop: Math.round(r(search).top),
        endTop: Math.round(r(end).top),
        bodyTop: Math.round(r(body).top),
        endRight: Math.round(r(end).right),
        rowRight: Math.round(r(row).right),
      };
    });
    expect(m.display).toBe('grid');
    // Trailing controls share the search's line, filters sit below.
    expect(Math.abs(m.searchTop - m.endTop)).toBeLessThan(4);
    expect(m.bodyTop).toBeGreaterThan(m.searchTop + 8);
    // Flush right: at most a couple of px of rounding, never a stranded void.
    expect(m.rowRight - m.endRight).toBeLessThan(4);
  });

  test('trailing controls are view-specific: no dead column picker in accordion', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/latest?view=table');
    await page.waitForLoadState('domcontentloaded');

    const tableState = await page.evaluate(() => ({
      picker: (document.querySelector('.column-picker') as HTMLElement).hidden,
      toggleAll: (document.getElementById('accordion-toggle-all') as HTMLElement).hidden,
    }));
    // Table: the column picker acts on columns, so it must be present.
    expect(tableState.picker).toBe(false);
    expect(tableState.toggleAll).toBe(true);

    // Switching views client-side must re-sync the controls, not reload.
    await page.getByRole('tab', { name: 'Accordion' }).click();
    const accState = await page.evaluate(() => ({
      picker: (document.querySelector('.column-picker') as HTMLElement).hidden,
      toggleAll: (document.getElementById('accordion-toggle-all') as HTMLElement).hidden,
    }));
    // Accordion renders grouped cards with 0 table cells: the picker is dead
    // there, and the accordion gets its own expand/collapse-all instead.
    expect(accState.picker).toBe(true);
    expect(accState.toggleAll).toBe(false);
  });

  test('expand/collapse-all drives every accordion card', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/latest?view=accordion');
    await page.waitForLoadState('domcontentloaded');

    const cards = page.locator('#view-accordion details.test-card');
    const count = await cards.count();
    expect(count).toBeGreaterThan(0);

    await page.getByRole('button', { name: 'Expand all' }).click();
    await expect(page.locator('#view-accordion details.test-card[open]')).toHaveCount(count);
    await expect(page.getByRole('button', { name: 'Collapse all' })).toBeVisible();

    await page.getByRole('button', { name: 'Collapse all' }).click();
    await expect(page.locator('#view-accordion details.test-card[open]')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Expand all' })).toBeVisible();
  });

  test('the accordion card header stacks title over meta (no squeezed gutter)', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/latest?view=accordion');
    await page.waitForLoadState('domcontentloaded');

    const m = await page.evaluate(() => {
      const card = document.querySelector('#view-accordion .test-card')!;
      const summary = card.querySelector('.test-card__summary') as HTMLElement;
      const row = card.querySelector('.test-card__summary-row') as HTMLElement;
      const meta = card.querySelector('.test-card__meta-row') as HTMLElement;
      const r = (el: Element) => el.getBoundingClientRect();
      return {
        dir: getComputedStyle(summary).flexDirection,
        rowW: Math.round(r(row).width),
        metaW: Math.round(r(meta).width),
        // Stacked: the meta line starts BELOW the title line, not beside it.
        metaBelowRow: r(meta).top >= r(row).bottom - 2,
        cardW: Math.round(r(card).width),
      };
    });
    expect(m.dir).toBe('column');
    expect(m.metaBelowRow, 'meta row is beside the title, not below it').toBe(true);
    // Both lines must use the card's full width (a row layout squeezed meta to
    // a ~288px right gutter, wrapping the spec path).
    expect(m.rowW).toBeGreaterThan(m.cardW * 0.85);
    expect(m.metaW).toBeGreaterThan(m.cardW * 0.85);
  });

  test('a step shows its source peek, mirroring the built-in report', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/latest?view=accordion');
    await page.waitForLoadState('domcontentloaded');

    // Open the first card so its steps render.
    await page
      .locator('#view-accordion details.test-card')
      .first()
      .evaluate((el) => {
        (el as HTMLDetailsElement).open = true;
      });

    const peek = page.locator('#view-accordion .step-snippet').first();
    await expect(peek).toBeVisible();

    const m = await peek.evaluate((el) => {
      const lines = Array.from(el.querySelectorAll('.step-snippet__line'));
      const highlight = el.querySelector('.step-snippet__line.is-highlight');
      const tokens = Array.from(el.querySelectorAll('.tok')).map((t) => t.className);
      return {
        lineCount: lines.length,
        hasHighlight: !!highlight,
        // The gutter shows the real source line numbers.
        lineNumbers: lines.map(
          (l) => l.querySelector('.step-snippet__ln')?.textContent?.trim() ?? '',
        ),
        tokenClasses: Array.from(new Set(tokens)),
      };
    });
    expect(m.lineCount).toBeGreaterThanOrEqual(3);
    expect(m.hasHighlight, 'no line marked as the executed one').toBe(true);
    // Gutter is the snippet window's own numbering, in order.
    expect(m.lineNumbers[0]).toBe('10');
    expect(m.lineNumbers[m.lineNumbers.length - 1]).toBe('13');
    // Syntax colour is applied, not a flat string.
    expect(m.tokenClasses.some((c) => c.includes('tok--keyword'))).toBe(true);
  });

  test('durations read in ms below one second and in seconds above', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/latest?view=accordion');
    await page.waitForLoadState('domcontentloaded');
    await page
      .locator('#view-accordion details.test-card')
      .first()
      .evaluate((el) => {
        (el as HTMLDetailsElement).open = true;
      });

    const labels = await page.locator('#view-accordion .tree-item__duration').allTextContents();
    expect(labels.length).toBeGreaterThan(0);
    for (const label of labels) {
      // Never a raw four-digit millisecond figure — that is the bug this fixed.
      expect(label, `raw ms leaked: ${label}`).not.toMatch(/^\d{4,}ms$/);
      expect(label).toMatch(/^(\d+ms|\d+\.\d{2}s)$/);
    }
    // Both units are exercised by the seeded steps (400/350/500 ms, ~1.4s card).
    expect(labels.some((l) => l.endsWith('ms'))).toBe(true);
  });

  test('the test card reports the worker that ran it', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/latest?view=accordion');
    await page.waitForLoadState('domcontentloaded');
    await page
      .locator('#view-accordion details.test-card')
      .first()
      .evaluate((el) => {
        (el as HTMLDetailsElement).open = true;
      });

    const worker = page
      .locator('#view-accordion .test-card')
      .first()
      .getByText(/^Worker$/);
    await expect(worker).toBeVisible();
    const value = await worker.locator('xpath=following-sibling::*[1]').textContent();
    expect(value).toMatch(/^#\d+$/);
  });
});

test.describe('open report attention cue', () => {
  test('the cue loops, is scoped to the card action, and pauses offscreen', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    const cue = page.locator('.latest-run-card__actions .btn-primary');
    await expect(cue).toBeVisible();

    // The loop must be infinite — a finite iteration count stops nagging the
    // moment QA looks away, which is exactly when the cue is needed.
    const style = await cue.evaluate((el) => {
      const cs = getComputedStyle(el);
      return {
        name: cs.animationName,
        iter: cs.animationIterationCount,
        state: cs.animationPlayState,
      };
    });
    expect(style.name).toBe('open-report-ring');
    expect(style.iter).toBe('infinite');
    expect(style.state).toBe('running');

    // Scoped to the card action: the history page's Save buttons share the
    // .btn-primary class and must NOT pulse.
    const historySave = await page.evaluate(() => {
      const el = document.querySelector('.latest-run-card__actions .btn-save-secondary');
      return el ? getComputedStyle(el).animationName : 'absent';
    });
    expect(historySave === 'none' || historySave === 'absent').toBe(true);

    // Hover ends the loop: a user who found the button is not nagged further.
    await cue.hover();
    const hovered = await cue.evaluate((el) => getComputedStyle(el).animationName);
    expect(hovered).toBe('none');
  });

  test('the cue pauses while the card is scrolled out of view', async ({ page }) => {
    // A long page puts the card far above the fold; the IntersectionObserver
    // must park the animation rather than repaint offscreen forever.
    await page.setViewportSize({ width: 1440, height: 600 });
    await page.goto('/latest?view=accordion');
    await page.waitForLoadState('domcontentloaded');
    await page.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight);
    });
    await page.waitForTimeout(500);

    const state = await page.evaluate(() => {
      const el = document.querySelector(
        '.latest-run-card__actions .btn-primary',
      ) as HTMLElement | null;
      return el ? getComputedStyle(el).animationPlayState : 'absent';
    });
    // Either the cue is offscreen (paused) or the card is not on this page.
    expect(state === 'paused' || state === 'absent').toBe(true);
  });
});

test.describe('full-bleed bars', () => {
  // S1's rule: a bar spans the viewport edge-to-edge and owns its own inset —
  // it must never be rounded, or the radius gets chopped at both edges.
  test('the analysis banner bleeds edge to edge at every width', async ({ page }) => {
    for (const width of [390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/latest');
      await page.waitForLoadState('domcontentloaded');

      const m = await page.evaluate(() => {
        const bar = document.querySelector('.page > .analysis-status-banner');
        if (!bar) return null;
        const cs = getComputedStyle(bar);
        const r = bar.getBoundingClientRect();
        return {
          left: Math.round(r.left),
          right: Math.round(r.right),
          radius: cs.borderTopLeftRadius,
          padLeft: Math.round(parseFloat(cs.paddingLeft)),
          padRight: Math.round(parseFloat(cs.paddingRight)),
          viewport: window.innerWidth,
        };
      });
      expect(m, `no banner at ${width}px`).not.toBeNull();
      if (!m) continue;
      // Flush to both edges, never a rounded card.
      expect(m.left, `banner inset from left at ${width}px`).toBeLessThan(2);
      expect(Math.abs(m.right - m.viewport), `banner short of right at ${width}px`).toBeLessThan(2);
      expect(m.radius, `banner has a radius at ${width}px`).toBe('0px');
      // It insets its OWN text (that is what makes it a bar, not a card).
      expect(m.padLeft).toBeGreaterThan(8);
      expect(m.padRight).toBeGreaterThan(8);
    }
  });
});

test.describe('dark mode', () => {
  test('the accordion renders readable cards in dark mode', async ({ page }) => {
    // S2's open item: the accordion was only ever eyeballed in light mode.
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/latest?view=accordion');
    await page.waitForLoadState('domcontentloaded');
    await page.evaluate(() => {
      localStorage.setItem('dashboard-theme', 'dark');
    });
    await page.reload();
    await page.waitForLoadState('domcontentloaded');

    expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe('dark');

    const card = page.locator('#view-accordion details.test-card').first();
    await expect(card).toBeVisible();

    // The card must actually paint a dark surface, not inherit the light one.
    const m = await card.evaluate((el) => {
      const cs = getComputedStyle(el);
      const parse = (v: string) => (v.match(/[\d.]+/g) ?? []).map(Number);
      return {
        bg: parse(cs.backgroundColor).slice(0, 3),
        fg: parse(cs.color).slice(0, 3),
      };
    });
    const bgLum = (m.bg[0] + m.bg[1] + m.bg[2]) / 3;
    // Dark surface, light ink — the inverse of the light theme.
    expect(bgLum, `card background is not dark: ${m.bg}`).toBeLessThan(110);
    const fgLum = (m.fg[0] + m.fg[1] + m.fg[2]) / 3;
    expect(fgLum, `card ink is not light: ${m.fg}`).toBeGreaterThan(140);
  });
});

test.describe('overview workspace grid', () => {
  test('main column keeps a usable width at every breakpoint', async ({ page }) => {
    for (const w of [390, 561, 768, 1024, 1200, 1440]) {
      await page.setViewportSize({ width: w, height: 900 });
      await page.goto('/');
      await page.waitForLoadState('domcontentloaded');

      const m = await page.evaluate(() => {
        const main = document.querySelector('.workspace__main');
        const ws = document.querySelector('.workspace');
        if (!main || !ws) return null;
        const mainW = main.getBoundingClientRect().width;
        const wsRect = ws.getBoundingClientRect();
        let spill = 0;
        for (const el of ws.querySelectorAll('*')) {
          const r = el.getBoundingClientRect();
          if (r.width > 0 && (r.right > wsRect.right + 1 || r.left < wsRect.left - 1)) spill++;
        }
        return { mainW: Math.round(mainW), spill, cols: getComputedStyle(ws).gridTemplateColumns };
      });
      expect(m, 'workspace grid missing').not.toBeNull();
      if (!m) return;
      expect(m.mainW, `main column crushed at ${w}px (cols=${m.cols})`).toBeGreaterThan(250);
      expect(m.spill, `workspace children spill the grid at ${w}px`).toBe(0);
    }
  });

  test('every overview panel fills its column', async ({ page }) => {
    for (const w of [390, 561, 1024]) {
      await page.setViewportSize({ width: w, height: 900 });
      await page.goto('/');
      await page.waitForLoadState('domcontentloaded');

      const crushed = await page.evaluate(() =>
        [...document.querySelectorAll('.workspace__main > *, .workspace__rail > *')]
          .map((el) => ({
            cls: (el.className || '').toString().slice(0, 40),
            w: Math.round(el.getBoundingClientRect().width),
          }))
          .filter((p) => p.w > 0 && p.w < 200),
      );
      expect(crushed, `crushed panels at ${w}px: ${JSON.stringify(crushed)}`).toEqual([]);
    }
  });
});
