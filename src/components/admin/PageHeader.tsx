import type { ReactNode } from "react";

/**
 * Shared header for admin pages — the uppercase eyebrow + Cormorant serif title
 * pattern established on the dashboard. Optional `action` renders top-right
 * (e.g. an "Add New Product" button).
 */
export default function PageHeader({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        {eyebrow && (
          <span className="text-[11px] font-semibold uppercase tracking-[0.3em] text-primary">
            {eyebrow}
          </span>
        )}
        <h1 className="mt-2 font-serif text-4xl font-medium tracking-tight text-stone-900">
          {title}
        </h1>
        {description && (
          <p className="mt-2 max-w-xl text-sm text-stone-500">{description}</p>
        )}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </header>
  );
}
