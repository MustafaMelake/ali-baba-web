import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { pageHref, pageWindow, type PageHrefMode, type PageInfo } from "@/lib/pagination";
import { cn } from "@/lib/utils";

/** Strings kept out of the markup (the Arabic locale swaps this table). */
const COPY = {
  nav: "Pagination",
  previous: "Previous page",
  next: "Next page",
  page: (n: number) => `Page ${n}`,
} as const;

/**
 * The one pagination control — storefront and admin. A Server Component (plain
 * links, zero client JS), so it renders inside cached ISR HTML as-is. Also
 * emits <link rel="prev"/"next"> (React 19 hoists them into <head>). Renders
 * nothing for a single page. Logical properties only; the chevrons flip in RTL.
 */
export default function Pagination({
  info,
  mode,
  tone = "storefront",
}: {
  info: PageInfo;
  mode: PageHrefMode;
  tone?: "storefront" | "admin";
}) {
  const { page, totalPages } = info;
  if (totalPages <= 1) return null;

  const prev = page > 1 ? pageHref(mode, page - 1) : null;
  const next = page < totalPages ? pageHref(mode, page + 1) : null;

  const item =
    tone === "admin"
      ? "inline-flex h-9 min-w-9 items-center justify-center rounded-lg px-2 text-sm tabular-nums"
      : "inline-flex h-11 min-w-11 items-center justify-center rounded-full px-3 font-sans text-sm tabular-nums";
  const idle = "text-stone-600 transition-colors hover:bg-stone-100 hover:text-stone-900";
  const current = tone === "admin" ? "bg-stone-900 text-white" : "bg-stone-900 text-white";
  const disabled = "pointer-events-none text-stone-300";

  return (
    <>
      {prev && <link rel="prev" href={prev} />}
      {next && <link rel="next" href={next} />}
      <nav aria-label={COPY.nav} className="mt-12 flex items-center justify-center gap-1">
        {prev ? (
          <Link href={prev} aria-label={COPY.previous} className={cn(item, idle)}>
            <ChevronLeft className="h-4 w-4 rtl:-scale-x-100" />
          </Link>
        ) : (
          <span aria-hidden className={cn(item, disabled)}>
            <ChevronLeft className="h-4 w-4 rtl:-scale-x-100" />
          </span>
        )}

        {pageWindow(page, totalPages).map((n, i) =>
          n === null ? (
            <span key={`gap-${i}`} aria-hidden className="px-1 text-stone-400">
              …
            </span>
          ) : n === page ? (
            <span key={n} aria-current="page" aria-label={COPY.page(n)} className={cn(item, current)}>
              {n}
            </span>
          ) : (
            <Link key={n} href={pageHref(mode, n)} aria-label={COPY.page(n)} className={cn(item, idle)}>
              {n}
            </Link>
          ),
        )}

        {next ? (
          <Link href={next} aria-label={COPY.next} className={cn(item, idle)}>
            <ChevronRight className="h-4 w-4 rtl:-scale-x-100" />
          </Link>
        ) : (
          <span aria-hidden className={cn(item, disabled)}>
            <ChevronRight className="h-4 w-4 rtl:-scale-x-100" />
          </span>
        )}
      </nav>
    </>
  );
}
