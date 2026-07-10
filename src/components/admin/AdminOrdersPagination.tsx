"use client";

import { useTransition } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";

/**
 * Prev/Next CURSOR pager for the admin orders board.
 *
 * Mirrors AdminOrderFilters' URL-state pattern: the `cursor` (an order id) and
 * `dir` search params are the single source of truth, pushed inside a
 * transition so the server-rendered table streams in without a hard reload.
 *
 *   Next     → cursor = endCursor of the page on screen, no `dir` (the default
 *              direction walks toward older orders).
 *   Previous → cursor = startCursor, dir = "prev" (walks back toward newer).
 *
 * The first page is the canonical param-less URL. On a stale-cursor EMPTY page
 * (the cursor's row was deleted or no longer matches the filter) there are no
 * row cursors to walk from, so "Previous" clears the cursor pair entirely —
 * recovering to the first page. Renders nothing when the filtered list fits on
 * a single page.
 */
export default function AdminOrdersPagination({
  total,
  shown,
  hasMore,
  hasPrevious,
  startCursor,
  endCursor,
}: {
  /** Total rows matching the active filter, across all pages. */
  total: number;
  /** Rows actually rendered on THIS page (caption + empty-page recovery). */
  shown: number;
  /** Older orders exist beyond this page. */
  hasMore: boolean;
  /** Newer orders exist before this page. */
  hasPrevious: boolean;
  /** First row's id, or null on an empty page. */
  startCursor: string | null;
  /** Last row's id, or null on an empty page. */
  endCursor: string | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  // Single page and nothing behind us → nothing to navigate; stay hidden.
  // (A stale-cursor empty page always has one of the two flags set, so the
  // recovery affordance below still renders.)
  if (!hasMore && !hasPrevious) return null;

  // A stale cursor can produce an EMPTY page — keep "Previous" usable there as
  // the recovery path (with no startCursor it clears the cursor pair, landing
  // on the canonical first page). "Next" needs a real row to walk from.
  const canPrevious = hasPrevious || shown === 0;
  const canNext = hasMore && endCursor != null;

  function navigate(mutate: (params: URLSearchParams) => void) {
    const params = new URLSearchParams(searchParams.toString());
    mutate(params);
    const qs = params.toString();
    startTransition(() =>
      router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false }),
    );
  }

  function goNext() {
    if (!endCursor) return;
    navigate((params) => {
      params.set("cursor", endCursor);
      params.delete("dir"); // "next" is the default direction
    });
  }

  function goPrevious() {
    navigate((params) => {
      if (startCursor) {
        params.set("cursor", startCursor);
        params.set("dir", "prev");
      } else {
        // Empty page from a stale cursor — recover to the first page.
        params.delete("cursor");
        params.delete("dir");
      }
    });
  }

  const buttonClass =
    "inline-flex items-center gap-1.5 rounded-full border border-stone-200 bg-white px-4 py-2 font-sans text-[13px] font-medium text-stone-600 transition-colors hover:border-stone-400 hover:text-stone-900 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-stone-200 disabled:hover:text-stone-600";

  return (
    <div className="flex items-center justify-between gap-4">
      {/* Caption — cursor pages carry no absolute offset, so the label counts
          this page against the filter total. Doubles as the recovery hint on
          a stale-cursor empty page. */}
      <p
        aria-live="polite"
        className="font-sans text-xs tabular-nums text-stone-400"
      >
        {shown === 0
          ? `No orders on this page — ${total} match the current filter`
          : `Showing ${shown} of ${total} orders`}
      </p>

      <div className="flex items-center gap-2">
        {isPending && (
          <Loader2 className="h-4 w-4 animate-spin text-stone-400" />
        )}
        <button
          type="button"
          onClick={goPrevious}
          disabled={!canPrevious || isPending}
          className={buttonClass}
        >
          <ChevronLeft className="h-3.5 w-3.5" />
          Previous
        </button>
        <button
          type="button"
          onClick={goNext}
          disabled={!canNext || isPending}
          className={buttonClass}
        >
          Next
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
