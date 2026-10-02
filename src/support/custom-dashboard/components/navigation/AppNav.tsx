/** @jsxImportSource @kitajs/html */
import type { Children } from '@kitajs/html';
import {
  IconLayoutDashboard,
  IconHistory,
  IconArrowRightLeft,
  IconSun,
  IconMoon,
  IconFlaskConical,
  IconMenu,
} from '../shared/icons';

export type NavTab = 'dashboard' | 'history' | 'compare' | 'report';

export interface AppNavProps {
  activeTab?: NavTab;
}

/**
 * Application chrome. Full-bleed bar: brand, primary navigation, then the
 * global actions. Navigation is a row of pill links (shadcn button-ghost
 * geometry) rather than an underlined tab bar, so the active state reads at a
 * glance without a second horizontal rule.
 *
 * Run actions (Export / Markdown / Save) deliberately do NOT live here: they
 * read the LATEST summary server-side, so on the history or compare pages they
 * would export the wrong run. They sit on the latest report's masthead (Hero),
 * which is the surface that actually describes that run.
 */
export function AppNav({ activeTab = 'dashboard' }: AppNavProps) {
  const tabs: Array<{ id: NavTab; label: string; href: string; icon: Children }> = [
    {
      id: 'dashboard',
      label: 'Dashboard',
      href: '/dashboard',
      icon: <IconLayoutDashboard size={15} />,
    },
    { id: 'history', label: 'History', href: '/history', icon: <IconHistory size={15} /> },
    {
      id: 'compare',
      label: 'Compare',
      href: '/compare',
      icon: <IconArrowRightLeft size={15} />,
    },
  ];

  return (
    <header class="app-header">
      <div class="app-header__brand">
        <a href="/dashboard" class="app-header__logo">
          <span class="app-header__mark">
            <IconFlaskConical size={16} />
          </span>
          <span class="app-header__title">QA Playwright Kit</span>
        </a>
      </div>

      {/* One <nav>, two presentations. Above the breakpoint the wrapper is
          `display: contents`, so the nav lays out inline in the header exactly
          as before. Below it the wrapper becomes a modal <dialog> and the same
          links slide up as a bottom sheet. A modal dialog (rather than a
          popover) is what makes the dimming backdrop honest: it makes the rest
          of the page inert, moves focus into the sheet, and restores focus to
          the trigger on close — all without JS. */}
      <dialog class="app-nav-sheet" id="app-nav-sheet">
        <span class="sheet-handle" aria-hidden="true"></span>
        <nav class="app-header__nav" id="app-nav" aria-label="Main Navigation">
          {tabs.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <a
                href={tab.href}
                class={`app-nav__link ${isActive ? 'is-active' : ''}`}
                aria-current={isActive ? 'page' : undefined}
              >
                <span class="app-nav__icon">{tab.icon}</span>
                <span class="app-nav__label" safe>
                  {tab.label}
                </span>
              </a>
            );
          })}
        </nav>
      </dialog>

      <button
        class="app-header__menu btn-icon"
        type="button"
        commandfor="app-nav-sheet"
        command="show-modal"
        aria-label="Open navigation menu"
        title="Navigation"
      >
        <IconMenu size={17} />
      </button>

      <div class="app-header__actions">
        <button
          class="theme-toggle btn-icon"
          id="theme-toggle-btn"
          type="button"
          aria-label="Toggle light / dark theme"
          title="Toggle light / dark theme"
        >
          <span class="theme-toggle__sun">
            <IconSun size={15} />
          </span>
          <span class="theme-toggle__moon">
            <IconMoon size={15} />
          </span>
        </button>
      </div>
    </header>
  );
}
