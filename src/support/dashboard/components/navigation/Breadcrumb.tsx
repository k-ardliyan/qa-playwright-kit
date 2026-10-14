/** @jsxImportSource @kitajs/html */

export interface BreadcrumbItem {
  label: string;
  href?: string;
}

export interface BreadcrumbProps {
  items: BreadcrumbItem[];
}

export function Breadcrumb({ items }: BreadcrumbProps) {
  if (!items || items.length === 0) return null;

  return (
    <nav class="breadcrumb" aria-label="Breadcrumb">
      <ol class="breadcrumb__list">
        {items.map((item, idx) => {
          const isLast = idx === items.length - 1;
          return (
            <li class="breadcrumb__item">
              {idx > 0 && <span class="breadcrumb__separator">/</span>}
              {isLast || !item.href ? (
                <span class="breadcrumb__current" aria-current="page" title={item.label} safe>
                  {item.label}
                </span>
              ) : (
                <a href={item.href} class="breadcrumb__link" safe>
                  {item.label}
                </a>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
