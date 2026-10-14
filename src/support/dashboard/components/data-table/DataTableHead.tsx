/** @jsxImportSource @kitajs/html */
import type { Children } from '@kitajs/html';

export interface DataTableHeadProps {
  class?: string;
  children: Children;
}

export function DataTableHead({ class: className = '', children }: DataTableHeadProps) {
  return <thead class={className || undefined}>{children}</thead>;
}
