/** @jsxImportSource @kitajs/html */
import type { Children } from '@kitajs/html';
import {
  IconDashboard,
  IconHistory,
  IconCompare,
  IconSave,
  IconSun,
  IconMoon,
} from '../shared/icons';

export type NavTab = 'dashboard' | 'history' | 'compare' | 'report';

export interface AppNavProps {
  activeTab?: NavTab;
  hasLatestRun?: boolean;
  latestRunArchived?: boolean;
}

export function AppNav({ activeTab = 'dashboard', hasLatestRun, latestRunArchived }: AppNavProps) {
  const tabs: Array<{ id: NavTab; label: string; href: string; icon: Children }> = [
    { id: 'dashboard', label: 'Dashboard', href: '/dashboard', icon: <IconDashboard size={15} /> },
    { id: 'history', label: 'History', href: '/history', icon: <IconHistory size={15} /> },
    { id: 'compare', label: 'Compare', href: '/compare', icon: <IconCompare size={15} /> },
  ];

  return (
    <header class="app-header">
      <div class="app-header__brand">
        <a href="/dashboard" class="app-header__logo">
          <span class="app-header__mark">
            <svg
              width="18"
              height="18"
              viewBox="0 0 18 18"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <rect
                x="2"
                y="2"
                width="14"
                height="14"
                rx="4"
                stroke="currentColor"
                stroke-width="2"
              />
              <circle cx="9" cy="9" r="3" fill="currentColor" />
            </svg>
          </span>
          <span class="app-header__title">QA Playwright Kit</span>
        </a>
      </div>

      <nav class="app-header__nav" aria-label="Main Navigation">
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

      <div class="app-header__actions">
        {hasLatestRun &&
          !latestRunArchived &&
          activeTab !== 'history' &&
          activeTab !== 'compare' && (
            <button
              class="btn-save-sm"
              type="button"
              onclick="openSaveModal && openSaveModal()"
              title="Save latest run to archive"
            >
              <IconSave size={14} />
              <span>Save Run</span>
            </button>
          )}
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
