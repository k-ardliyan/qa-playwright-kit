/** @jsxImportSource @kitajs/html */
import type { ModuleHealthEntry } from '../../domain/dashboard';
import { IconDashboard } from '../../components/shared/icons';

export interface ModuleHealthPanelProps {
  modules: ModuleHealthEntry[];
}

/**
 * Module health — per-module pass rate across the latest run plus recent
 * archived runs. Modules sort worst-first so the weakest area is visible
 * without scrolling.
 */
export function ModuleHealthPanel({ modules }: ModuleHealthPanelProps) {
  const rows = modules.slice(0, 8);
  const totalTests = modules.reduce((n, m) => n + m.total, 0);

  return (
    <div class="panel health-panel">
      <div class="panel-header">
        <div class="attention-header-title">
          <IconDashboard size={16} class="icon-neutral" />
          <h3 class="panel-title">Module Health</h3>
        </div>
        <span class="muted font-mono">{totalTests} tests</span>
      </div>

      {rows.length === 0 ? (
        <div class="attention-healthy">
          <p>
            <strong>No module data yet.</strong>
          </p>
          <span class="muted">Run a suite with module metadata to see per-module health.</span>
        </div>
      ) : (
        <ul class="module-health-list">
          {rows.map((m) => {
            const rate = m.passRate;
            const tone = rate === 100 ? 'is-good' : rate >= 80 ? 'is-warn' : 'is-bad';
            return (
              <li class="module-health-row">
                <div class="module-health-row__top">
                  <span class="module-health-row__name" safe>
                    {m.module}
                  </span>
                  <span class="module-health-row__meta font-mono muted" safe>
                    {rate}% · {m.total}
                  </span>
                </div>
                <div class="mini-bar" role="img" aria-label={`${m.module} pass rate ${rate}%`}>
                  <div class={`mini-bar__fill ${tone}`} style={`width:${rate}%`} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
