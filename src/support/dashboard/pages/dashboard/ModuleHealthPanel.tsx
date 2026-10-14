/** @jsxImportSource @kitajs/html */
import type { ModuleHealthEntry } from '../../domain/dashboard';
import { IconBoxes, IconMinus } from '../../components/shared/icons';

export interface ModuleHealthPanelProps {
  modules: ModuleHealthEntry[];
}

/**
 * Per-module pass rate across the latest run plus recent archived runs.
 * Modules sort worst-first upstream, so the weakest area is visible without
 * scrolling. The bar length carries the rate; the label repeats it in text.
 */
export function ModuleHealthPanel({ modules }: ModuleHealthPanelProps) {
  const rows = modules.slice(0, 8);
  const totalTests = modules.reduce((n, m) => n + m.total, 0);

  return (
    <div class="panel health-panel">
      <div class="panel-header">
        <h3 class="panel-title">
          <IconBoxes size={15} class="icon-neutral" />
          <span>Module health</span>
        </h3>
        <span class="muted font-mono">{totalTests} tests</span>
      </div>

      {rows.length === 0 ? (
        <p class="panel-empty">
          <span class="panel-empty__mark" aria-hidden="true">
            <IconMinus size={12} />
          </span>
          <span>No module metadata in this run.</span>
        </p>
      ) : (
        <ul class="module-health-list">
          {rows.map((m) => {
            const rate = m.passRate;
            // Three tones so 67% is not visually lumped in with 0%: green is
            // healthy, amber is degraded but partial, red is the majority failing.
            const tone = rate >= 90 ? 'is-good' : rate >= 60 ? 'is-warn' : 'is-bad';
            return (
              <li class="module-health-row">
                <div class="module-health-row__top">
                  <span class="module-health-row__name" safe>
                    {m.module}
                  </span>
                  <span class="module-health-row__meta">
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
