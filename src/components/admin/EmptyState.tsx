import type { LucideIcon } from "lucide-react";

/**
 * Graceful empty-state block for tables/lists that returned no rows.
 * Mirrors the dashed-card look used on the dashboard's "Recent Orders" panel.
 */
export default function EmptyState({
  icon: Icon,
  title,
  description,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-stone-100 text-stone-400">
        <Icon className="h-5 w-5" />
      </span>
      <p className="mt-3 text-sm font-medium text-stone-600">{title}</p>
      {description && (
        <p className="mt-1 text-xs text-stone-400">{description}</p>
      )}
    </div>
  );
}
