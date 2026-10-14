/** @jsxImportSource @kitajs/html */
export interface EmptyStateProps {
  message: string;
  class?: string;
}

export function EmptyState({ message, class: className }: EmptyStateProps) {
  const cls = className ? `empty-state ${className}` : 'empty-state';
  return (
    <p class={cls} safe>
      {message}
    </p>
  );
}
