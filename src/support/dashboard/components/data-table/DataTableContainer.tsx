/** @jsxImportSource @kitajs/html */
import type { Children } from '@kitajs/html';

export interface DataTableContainerProps {
  class?: string;
  id?: string;
  children: Children;
}

export function DataTableContainer({
  class: className = '',
  id,
  children,
}: DataTableContainerProps) {
  const cls = ['table-wrapper', className].filter(Boolean).join(' ');
  return (
    <div class={cls} id={id}>
      {children}
    </div>
  );
}
