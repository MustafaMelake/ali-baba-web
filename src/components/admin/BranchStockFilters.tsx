"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { Search, X, Loader2 } from "lucide-react";
import { SEARCH_MAX_QUERY_LENGTH } from "@/lib/validators";
import type { StockCounts, StockFilter } from "@/lib/branch-stock-filter";
import { cn } from "@/lib/utils";

const TABS: { value: StockFilter; label: string }[] = [
  { value: "all", label: "All Items" },
  { value: "in", label: "In Stock" },
  { value: "out", label: "Out of Stock" },
];

/**
 * Search + stock tabs for /admin/inventory. Same shape as AdminOrderFilters:
 * state lives in the URL (`?q=` debounced, `?stock=`), every change is a
 * `router.push` inside a transition, and the page re-filters server-side.
 * Other params (an ADMIN's `?branch=`) ride along untouched — except `?page=`,
 * which every filter change drops (the list it numbered no longer exists).
 */
export default function BranchStockFilters({
  activeStock,
  query,
  counts,
}: {
  activeStock: StockFilter;
  query: string;
  counts: StockCounts;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [term, setTerm] = useState(query);

  // Keep the draft in sync when the committed URL query changes elsewhere (back/
  // forward, a branch switch). React's adjust-state-during-render pattern — no effect.
  const [committedQuery, setCommittedQuery] = useState(query);
  if (query !== committedQuery) {
    setCommittedQuery(query);
    setTerm(query);
  }

  function push(params: URLSearchParams) {
    params.delete("page"); // a new filter starts on page 1
    const qs = params.toString();
    startTransition(() =>
      router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false }),
    );
  }

  function selectStock(value: StockFilter) {
    if (value === activeStock) return;
    const params = new URLSearchParams(searchParams.toString());
    if (value === "all") params.delete("stock");
    else params.set("stock", value);
    push(params);
  }

  // Debounced search → pushes the `q` param without a hard reload.
  useEffect(() => {
    const current = searchParams.get("q") ?? "";
    if (term.trim() === current) return;

    const timer = setTimeout(() => {
      const params = new URLSearchParams(searchParams.toString());
      if (term.trim()) params.set("q", term.trim());
      else params.delete("q");
      params.delete("page"); // a new search starts on page 1
      const qs = params.toString();
      startTransition(() =>
        router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false }),
      );
    }, 400);

    return () => clearTimeout(timer);
  }, [term, searchParams, pathname, router]);

  return (
    <div className="space-y-4">
      {/* ── Search bar ─────────────────────────────────────── */}
      <div className="relative max-w-md">
        <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
        <input
          type="search"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          maxLength={SEARCH_MAX_QUERY_LENGTH}
          placeholder="Search by product, size, SKU or category…"
          aria-label="Search branch stock"
          className="w-full rounded-full border border-stone-200 bg-white py-3 pl-11 pr-10 font-sans text-sm text-stone-900 outline-none transition-colors placeholder:text-stone-400 focus:border-primary focus:ring-2 focus:ring-primary/15"
        />
        <span className="absolute right-3.5 top-1/2 -translate-y-1/2">
          {isPending ? (
            <Loader2 className="h-4 w-4 animate-spin text-stone-400" />
          ) : (
            term && (
              <button
                type="button"
                onClick={() => setTerm("")}
                aria-label="Clear search"
                className="flex h-6 w-6 items-center justify-center rounded-full text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )
          )}
        </span>
      </div>

      {/* ── Stock tabs (counters + sliding pill) ───────────── */}
      <div className="-mx-1 overflow-x-auto scrollbar-none">
        <div
          role="tablist"
          aria-label="Filter by stock"
          className="flex items-center gap-1.5 px-1"
        >
          {TABS.map(({ value, label }) => {
            const isActive = value === activeStock;
            // Sold-out lines are the thing a manager scans for — tint the
            // counter amber whenever there are any.
            const flagOut = value === "out" && counts.out > 0;
            return (
              <button
                key={value}
                role="tab"
                aria-selected={isActive}
                onClick={() => selectStock(value)}
                className={cn(
                  "relative shrink-0 rounded-full px-4 py-2 font-sans text-[13px] font-medium tracking-wide transition-colors duration-300",
                  isActive ? "text-white" : "text-stone-500 hover:text-stone-900",
                )}
              >
                {isActive && (
                  <motion.span
                    layoutId="branch-stock-pill"
                    className="absolute inset-0 rounded-full bg-stone-900"
                    transition={{ type: "spring", stiffness: 380, damping: 32 }}
                  />
                )}
                <span className="relative z-10 whitespace-nowrap">
                  {label}
                  <span
                    className={cn(
                      "ml-1.5 tabular-nums",
                      isActive
                        ? flagOut
                          ? "text-amber-300"
                          : "text-white/60"
                        : flagOut
                          ? "font-semibold text-amber-700"
                          : "text-stone-400",
                    )}
                  >
                    {counts[value]}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
