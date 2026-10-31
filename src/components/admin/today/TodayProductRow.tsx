"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ImageIcon, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { markSoldOutToday, clearSoldOutToday } from "@/lib/actions/branch-stock";
import { cn, formatEGP } from "@/lib/utils";
import { TODAY_COPY } from "@/lib/today-copy";
import type { TodayProduct } from "./types";

/**
 * One product on the Today page: a large product-level "Sold out today" control
 * plus an optional per-size expander. Every flip is optimistic (instant), rolls
 * back on a failed Server Action, toasts, then `router.refresh()` re-reads the
 * branch. Head-office-off sizes are shown disabled — not the manager's to flip.
 *
 * Optimistic state is a map { variantId -> isSoldOutToday } over the TOGGLABLE
 * sizes only (off sizes are fixed). The product control acts on all of them at
 * once via the product-level action; a size control acts on one.
 */
export default function TodayProductRow({ product }: { product: TodayProduct }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [expanded, setExpanded] = useState(false);

  const togglable = useMemo(
    () => product.sizes.filter((s) => s.state !== "off"),
    [product.sizes],
  );
  const offCount = product.sizes.length - togglable.length;

  const initial = useMemo(() => {
    const map: Record<string, boolean> = {};
    for (const s of togglable) map[s.id] = s.state === "sold_out_today";
    return map;
  }, [togglable]);

  const [soldOut, setSoldOut] = useState<Record<string, boolean>>(initial);

  // Re-sync when server truth changes underneath us (another tab, a refresh).
  useEffect(() => {
    /* eslint-disable-next-line react-hooks/set-state-in-effect -- mirror server truth */
    setSoldOut(initial);
  }, [initial]);

  const hasTogglable = togglable.length > 0;
  const allSoldOut = hasTogglable && togglable.every((s) => soldOut[s.id]);
  const anySoldOut = togglable.some((s) => soldOut[s.id]);

  function run(
    optimistic: Record<string, boolean>,
    action: () => Promise<{ success: true } | { success: false; error: string }>,
    successMsg: string,
  ) {
    const prev = soldOut;
    setSoldOut(optimistic);
    startTransition(async () => {
      const result = await action();
      if (!result.success) {
        setSoldOut(prev); // roll back
        toast.error(result.error);
        return;
      }
      toast.success(successMsg);
      router.refresh();
    });
  }

  function toggleProduct() {
    if (!hasTogglable) return;
    const next = !allSoldOut; // currently all out → bring back; else sell out all
    const optimistic: Record<string, boolean> = {};
    for (const s of togglable) optimistic[s.id] = next;
    run(
      optimistic,
      () => (next ? markSoldOutToday({ productId: product.id }) : clearSoldOutToday({ productId: product.id })),
      next ? TODAY_COPY.toastMarked(product.name) : TODAY_COPY.toastCleared(product.name),
    );
  }

  function toggleSize(size: TodayProduct["sizes"][number]) {
    const next = !soldOut[size.id];
    const label = size.name ? `${product.name} (${size.name})` : product.name;
    run(
      { ...soldOut, [size.id]: next },
      () => (next ? markSoldOutToday({ variantId: size.id }) : clearSoldOutToday({ variantId: size.id })),
      next ? TODAY_COPY.toastMarked(label) : TODAY_COPY.toastCleared(label),
    );
  }

  return (
    <li className="px-4 py-4 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div
            className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-stone-100 bg-cover bg-center text-stone-300"
            style={product.image ? { backgroundImage: `url(${product.image})` } : undefined}
          >
            {!product.image && <ImageIcon className="h-5 w-5" />}
          </div>
          <div className="min-w-0">
            <div className="truncate font-medium text-stone-900">{product.name}</div>
            <div className="truncate text-xs text-stone-400">
              {product.category}
              {offCount > 0 && (
                <span className="ms-1 text-stone-400">· {offCount} off</span>
              )}
            </div>
          </div>
        </div>

        {/* Product-level control (or an all-off note). */}
        {hasTogglable ? (
          <button
            type="button"
            onClick={toggleProduct}
            disabled={isPending}
            aria-pressed={allSoldOut}
            className={cn(
              "inline-flex min-w-[9.5rem] items-center justify-center gap-1.5 rounded-full px-4 py-2.5 text-sm font-semibold transition-colors disabled:opacity-60",
              allSoldOut
                ? "bg-emerald-600 text-white hover:bg-emerald-700"
                : "bg-stone-900 text-white hover:bg-stone-700",
            )}
          >
            {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            {allSoldOut ? TODAY_COPY.bringBack : TODAY_COPY.markSoldOut}
          </button>
        ) : (
          <span className="rounded-full bg-stone-100 px-3 py-1.5 text-xs font-medium text-stone-500">
            {TODAY_COPY.headOfficeOff}
          </span>
        )}
      </div>

      {/* Helper + partial state + per-size expander. */}
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 ps-15">
        {anySoldOut && (
          <span className="text-xs text-stone-400">{TODAY_COPY.autoReturn}</span>
        )}
        {product.sizes.length > 1 && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            className="inline-flex items-center gap-1 text-xs font-medium text-stone-500 hover:text-stone-900"
          >
            {TODAY_COPY.sizesExpand}
            <ChevronDown
              className={cn("h-3.5 w-3.5 transition-transform", expanded && "rotate-180")}
            />
          </button>
        )}
      </div>

      {expanded && product.sizes.length > 1 && (
        <ul className="mt-3 space-y-2 ps-15">
          {product.sizes.map((size) => {
            const isOff = size.state === "off";
            const out = !isOff && soldOut[size.id];
            return (
              <li
                key={size.id}
                className={cn(
                  "flex items-center justify-between gap-4 rounded-xl px-3 py-2",
                  isOff ? "bg-stone-50" : out ? "bg-emerald-50/60" : "bg-stone-50/70",
                )}
              >
                <span className="min-w-0 text-sm text-stone-700">
                  <span className="font-medium">{size.name}</span>
                  <span className="ms-2 text-xs text-stone-400 tabular-nums">
                    {formatEGP(size.price)}
                  </span>
                </span>
                {isOff ? (
                  <span className="text-xs font-medium text-stone-400">
                    {TODAY_COPY.headOfficeOff}
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => toggleSize(size)}
                    disabled={isPending}
                    aria-pressed={out}
                    className={cn(
                      "rounded-full px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-60",
                      out
                        ? "bg-emerald-600 text-white hover:bg-emerald-700"
                        : "border border-stone-200 text-stone-600 hover:border-stone-300 hover:bg-stone-50 hover:text-stone-900",
                    )}
                  >
                    {out ? TODAY_COPY.bringBack : TODAY_COPY.markSoldOut}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </li>
  );
}
