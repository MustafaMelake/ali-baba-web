import Link from "next/link";
import type { LucideIcon } from "lucide-react";

/**
 * High-end, minimalist empty state for storefront pages (wishlist, orders, …).
 * Server-renderable — no client JS, hydration-safe by construction.
 */
export default function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: { href: string; label: string };
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-24 text-center md:py-32">
      <span className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 text-primary">
        <Icon className="h-7 w-7" strokeWidth={1.6} />
      </span>

      <h2 className="mt-7 font-serif text-2xl font-medium tracking-tight text-stone-900 md:text-3xl">
        {title}
      </h2>

      {description && (
        <p className="mt-2.5 max-w-sm font-sans text-sm leading-relaxed text-stone-500">
          {description}
        </p>
      )}

      {action && (
        <Link
          href={action.href}
          className="mt-8 inline-flex items-center gap-2 rounded-full bg-stone-900 px-8 py-3.5 font-sans text-sm font-semibold uppercase tracking-widest text-white transition-colors hover:bg-stone-700"
        >
          {action.label}
        </Link>
      )}
    </div>
  );
}
