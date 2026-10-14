/** @jsxImportSource @kitajs/html */
import type { Children } from '@kitajs/html';

export interface DataTableProps {
  variant?: 'report' | 'history' | 'compare' | 'default';
  class?: string;
  id?: string;
  caption?: string;
  children: Children;
}

export function DataTable({
  variant = 'default',
  class: className = '',
  id,
  caption,
  children,
}: DataTableProps) {
  const variantClass =
    variant === 'history'
      ? 'history-table'
      : variant === 'compare'
        ? 'comparison-table'
        : 'qa-report-table';
  const cls = [variantClass, 'data-table', className].filter(Boolean).join(' ');
  return (
    <table class={cls} id={id}>
      {caption ? (
        <caption class="sr-only" safe>
          {caption}
        </caption>
      ) : null}
      {children}
    </table>
  );
}
