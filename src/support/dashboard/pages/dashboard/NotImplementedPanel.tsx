/** @jsxImportSource @kitajs/html */
import type { NotImplementedCategoryEntry } from '../../domain/dashboard';
import { IconHammer } from '../../components/shared/icons';

export interface NotImplementedPanelProps {
  entries: NotImplementedCategoryEntry[];
}

/**
 * "Kenapa belum jalan" — groups not-implemented rows by reason category so a
 * non-coder QA sees WHAT kind of work is owed (page not explored / seed /
 * session / data chain) and the ONE action that unblocks it, instead of a raw
 * count. Renders nothing on clean runs — a run without unbuilt work must not
 * grow an empty panel.
 */
export function NotImplementedPanel({ entries }: NotImplementedPanelProps) {
  if (entries.length === 0) return null;
  const total = entries.reduce((n, e) => n + e.count, 0);

  return (
    <div class="panel why-not-panel">
      <div class="panel-header">
        <h3 class="panel-title">
          <IconHammer size={15} class="icon-neutral" />
          <span>Kenapa belum jalan</span>
        </h3>
        <span class="muted font-mono">{total} belum dibangun</span>
      </div>
      <ul class="why-not-list">
        {entries.map((e) => (
          <li class="why-not-row" title={e.reasons.length > 0 ? e.reasons.join('\n') : undefined}>
            <div class="why-not-row__top">
              <span class="why-not-row__label" safe>
                {e.label}
              </span>
              <span class="why-not-row__count font-mono">{e.count}</span>
            </div>
            <p class="why-not-row__action" safe>
              {e.nextAction}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}
