/** @jsxImportSource @kitajs/html */
import type { Children } from '@kitajs/html';

export interface DataTableToolbarProps {
  class?: string;
  id?: string;
  children: Children;
}

export function DataTableToolbar({ class: className = '', id, children }: DataTableToolbarProps) {
  const cls = ['table-toolbar', className].filter(Boolean).join(' ');
  return (
    <div class={cls} id={id}>
      {children}
    </div>
  );
}
