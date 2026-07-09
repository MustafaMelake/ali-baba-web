"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { Search, X, Loader2 } from "lucide-react";
import { OrderStatus } from "@/generated/prisma/enums";
import { cn } from "@/lib/utils";

export type TabValue = OrderStatus | "ALL";

const TABS: TabValue[] = ["ALL", ...Object.values(OrderStatus)];

function tabLabel(tab: TabValue) {
  if (tab === "ALL") return "All";
  return tab.charAt(0) + tab.slice(1).toLowerCase();
}

export default function AdminOrderFilters({
  activeStatus,
  query,
  counts,
}: {
  activeStatus: TabValue;
  query: string;
  counts: Record<TabValue, number>;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [term, setTerm] = useState(query);

  // Keep the draft in sync when the committed URL query changes elsewhere (back/
  // forward, external nav). React's adjust-state-during-render pattern — no effect.
  const [committedQuery, setCommittedQuery] = useState(query);
  if (query !== committedQuery) {
    setCommittedQuery(query);
    setTerm(query);
  }

  function pushParams(mutate: (params: URLSearchParams) => void) {
    const params = new URLSearchParams(searchParams.toString());
    mutate(params);
    const qs = params.toString();
    startTransition(() =>
      router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false }),
    );
  }

  function selectStatus(tab: TabValue) {
    if (tab === activeStatus) return;
    pushParams((p) => {
      if (tab === "ALL") p.delete("status");
      else p.set("status", tab);
      // A new filter is a new list — never carry the old page position into
      // it (a stale ?page= could land past the shorter list's end).
      p.delete("page");
    });
  }

  // Debounced search → pushes the `query` param without a hard reload.
  useEffect(() => {
    const current = searchParams.get("query") ?? "";
    if (term === current) return;

    const timer = setTimeout(() => {
      const params = new URLSearchParams(searchParams.toString());
      if (term.trim()) params.set("query", term.trim());
      else params.delete("query");
      // Same rule as selectStatus: a changed search is a new list → page 1.
      params.delete("page");
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
          placeholder="Search by order #, name or phone…"
          aria-label="Search orders"
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

      {/* ── Status tabs (counters + sliding pill) ──────────── */}
      <div className="-mx-1 overflow-x-auto scrollbar-none">
        <div
          role="tablist"
          aria-label="Filter by status"
          className="flex items-center gap-1.5 px-1"
        >
          {TABS.map((tab) => {
            const isActive = tab === activeStatus;
            return (
              <button
                key={tab}
                role="tab"
                aria-selected={isActive}
                onClick={() => selectStatus(tab)}
                className={cn(
                  "relative shrink-0 rounded-full px-4 py-2 font-sans text-[13px] font-medium tracking-wide transition-colors duration-300",
                  isActive ? "text-white" : "text-stone-500 hover:text-stone-900",
                )}
              >
                {isActive && (
                  <motion.span
                    layoutId="admin-status-pill"
                    className="absolute inset-0 rounded-full bg-stone-900"
                    transition={{ type: "spring", stiffness: 380, damping: 32 }}
                  />
                )}
                <span className="relative z-10 whitespace-nowrap">
                  {tabLabel(tab)}
                  <span
                    className={cn(
                      "ml-1.5 tabular-nums",
                      isActive ? "text-white/60" : "text-stone-400",
                    )}
                  >
                    {counts[tab] ?? 0}
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
