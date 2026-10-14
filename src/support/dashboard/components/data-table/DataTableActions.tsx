/** @jsxImportSource @kitajs/html */
import type { Children } from '@kitajs/html';

export interface DataTableActionsProps {
  class?: string;
  onclick?: string;
  children: Children;
}

export function DataTableActions({
  class: className = '',
  onclick = 'event.stopPropagation()',
  children,
}: DataTableActionsProps) {
  const cls = ['col-actions', className].filter(Boolean).join(' ');
  return (
    <td class={cls} onclick={onclick}>
      <div class="history-actions">{children}</div>
    </td>
  );
}
