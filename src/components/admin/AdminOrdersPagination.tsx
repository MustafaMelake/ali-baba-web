"use client";

import { useTransition } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";

/**
 * Prev/Next pager for the admin orders board.
 *
 * Mirrors AdminOrderFilters' URL-state pattern exactly: the 1-based `page`
 * search param is the single source of truth, pushed inside a transition so
 * the server-rendered table streams in without a hard reload. `page=1` is
 * normalised to NO param, keeping the canonical (first-page) URL clean and
 * shareable. Renders nothing when the filtered list fits on one page.
 */
export default function AdminOrdersPagination({
  page,
  pageSize,
  total,
  shown,
  hasMore,
}: {
  /** The (server-clamped) 1-based page currently displayed. */
  page: number;
  pageSize: number;
  /** Total rows matching the active filter, across all pages. */
  total: number;
  /** Rows actually rendered on THIS page (range label + empty-page case). */
  shown: number;
  hasMore: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  // One page and we're on it → nothing to navigate; keep the board unchanged.
  if (total <= pageSize && page <= 1) return null;

  function goTo(nextPage: number) {
    const params = new URLSearchParams(searchParams.toString());
    if (nextPage <= 1) params.delete("page");
    else params.set("page", String(nextPage));
    const qs = params.toString();
    startTransition(() =>
      router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false }),
    );
  }

  const rangeStart = shown === 0 ? 0 : (page - 1) * pageSize + 1;
  const rangeEnd = (page - 1) * pageSize + shown;

  const buttonClass =
    "inline-flex items-center gap-1.5 rounded-full border border-stone-200 bg-white px-4 py-2 font-sans text-[13px] font-medium text-stone-600 transition-colors hover:border-stone-400 hover:text-stone-900 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-stone-200 disabled:hover:text-stone-600";

  return (
    <div className="flex items-center justify-between gap-4">
      {/* Range caption — also the recovery hint for an out-of-range page
          (e.g. a stale bookmarked ?page= after orders were filtered away). */}
      <p
        aria-live="polite"
        className="font-sans text-xs tabular-nums text-stone-400"
      >
        {shown === 0
          ? `No orders on this page — ${total} match the current filter`
          : `Showing ${rangeStart}–${rangeEnd} of ${total}`}
      </p>

      <div className="flex items-center gap-2">
        {isPending && (
          <Loader2 className="h-4 w-4 animate-spin text-stone-400" />
        )}
        <button
          type="button"
          onClick={() => goTo(page - 1)}
          disabled={page <= 1 || isPending}
          className={buttonClass}
        >
          <ChevronLeft className="h-3.5 w-3.5" />
          Previous
        </button>
        <button
          type="button"
          onClick={() => goTo(page + 1)}
          disabled={!hasMore || isPending}
          className={buttonClass}
        >
          Next
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
