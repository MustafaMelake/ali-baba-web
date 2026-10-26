"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { Loader2, SlidersHorizontal, X } from "lucide-react";
import { countShopProducts } from "@/lib/actions/shop";
import {
  DEFAULT_SHOP_FILTERS,
  hasActiveFilters,
  parseShopFilters,
  shopHref,
  toShopQuery,
  type ShopFacets,
} from "@/lib/shop-filters";
import { SHOP_SORTS, type ShopFilters, type ShopSort } from "@/lib/validators";
import { useDialogFocus } from "@/lib/use-dialog-focus";
import { cn } from "@/lib/utils";

const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];

/** Strings kept out of the markup (the Arabic locale swaps this table). */
const COPY = {
  button: "Filter & sort",
  activeCount: (n: number) => `${n} active`,
  title: "Filter & sort",
  close: "Close filters",
  sortLegend: "Sort by",
  sorts: {
    featured: "Featured",
    newest: "Newest",
    "price-asc": "Price: low to high",
    "price-desc": "Price: high to low",
  } satisfies Record<ShopSort, string>,
  sale: "On sale only",
  priceLegend: "Price (EGP)",
  min: "Min",
  max: "Max",
  categoriesLegend: "Categories",
  collectionsLegend: "Collection",
  anyCollection: "Any collection",
  clear: "Clear all",
  apply: (n: number | null) =>
    n === null ? "Show results" : n === 1 ? "Show 1 creation" : `Show ${n} creations`,
  countLive: (n: number) => (n === 1 ? "1 creation matches" : `${n} creations match`),
} as const;

/** The sheet's editable state — price bounds stay strings while typed. */
type Draft = Omit<ShopFilters, "min" | "max"> & { min: string; max: string };

const toDraft = (f: ShopFilters): Draft => ({
  ...f,
  min: f.min?.toString() ?? "",
  max: f.max?.toString() ?? "",
});

// Through the same soft schema as the server: a half-typed bound is dropped.
const fromDraft = (d: Draft): ShopFilters =>
  parseShopFilters({ ...d, category: d.category, sale: d.sale ? "1" : undefined });

export interface FilterSortButtonProps {
  /** Every category and active collection (the checkbox / radio lists). */
  facets: ShopFacets;
  /** What the sheet opens with: /shop's current filters, or a listing page's preset. */
  initial: ShopFilters;
  /** The count for `initial` when the page already knows it (/shop's total). */
  initialCount?: number;
  /**
   * How Apply navigates. /shop passes its own transition-wrapped push (keeps
   * scroll, dims the grid); elsewhere it is a plain navigation to /shop.
   */
  onApply?: (href: string) => void;
  /** Show the active-filter badge (on /shop — a listing's preset isn't "active"). */
  showActiveCount?: boolean;
  className?: string;
}

/**
 * "Filter & sort" — a button plus its sheet: a bottom sheet on phones, a side
 * panel from md up. Edits a local draft; every edit asks the public
 * `countShopProducts` action (debounced) for the live result count; Apply
 * navigates to the matching /shop URL. Reads NO searchParams — it's handed its
 * starting filters — so it can sit on the ISR listings without making them
 * dynamic.
 */
export default function FilterSortButton({
  facets,
  initial,
  initialCount,
  onApply,
  showActiveCount = false,
  className,
}: FilterSortButtonProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [side, setSide] = useState<"bottom" | "end">("bottom");
  const [draft, setDraft] = useState<Draft>(() => toDraft(initial));
  // The count and the draft URL it was computed for — stale while they differ.
  const [counted, setCounted] = useState<{ href: string; count: number | null } | null>(null);
  const [isCounting, startCounting] = useTransition();
  const timer = useRef<number | undefined>(undefined);
  const latest = useRef(0);
  const dialogRef = useDialogFocus<HTMLDivElement>(open);

  const draftHref = shopHref(fromDraft(draft));
  // The count shown on Apply — null while a newer draft is still being counted.
  const freshCount = counted?.href === draftHref ? counted.count : null;
  const fresh = counted?.href === draftHref;
  const activeCount = [
    initial.category.length > 0,
    initial.collection !== undefined,
    initial.sale,
    initial.min !== undefined || initial.max !== undefined,
  ].filter(Boolean).length;

  // Debounced: typing a price shouldn't fire a count per keystroke. A newer
  // request supersedes an older answer.
  function requestCount(next: Draft, delay = 300) {
    window.clearTimeout(timer.current);
    const id = ++latest.current;
    const filters = fromDraft(next);
    timer.current = window.setTimeout(() => {
      startCounting(async () => {
        const result = await countShopProducts(toShopQuery(filters));
        if (id !== latest.current) return;
        setCounted({ href: shopHref(filters), count: result.success ? result.count : null });
      });
    }, delay);
  }

  function update(patch: Partial<Draft>) {
    const next = { ...draft, ...patch };
    setDraft(next);
    requestCount(next);
  }

  function openSheet() {
    setSide(window.matchMedia("(min-width: 48rem)").matches ? "end" : "bottom");
    const start = toDraft(initial);
    setDraft(start);
    if (initialCount !== undefined) {
      latest.current++;
      setCounted({ href: shopHref(fromDraft(start)), count: initialCount });
    } else {
      requestCount(start, 0);
    }
    setOpen(true);
  }

  function close() {
    window.clearTimeout(timer.current);
    setOpen(false);
  }

  function apply() {
    close();
    if (onApply) onApply(draftHref);
    else router.push(draftHref);
  }

  // Escape closes; the page behind doesn't scroll while the sheet is up.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      window.clearTimeout(timer.current);
      setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open]);

  const rtl = typeof document !== "undefined" && document.documentElement.dir === "rtl";
  const offscreen = side === "end" ? { x: rtl ? "-100%" : "100%" } : { y: "100%" };

  const toggleCategory = (slug: string) =>
    update({
      category: draft.category.includes(slug)
        ? draft.category.filter((s) => s !== slug)
        : [...draft.category, slug],
    });

  return (
    <>
      <button
        type="button"
        onClick={openSheet}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={cn(
          "inline-flex h-11 shrink-0 items-center gap-2 rounded-full border border-stone-200 bg-white px-5 font-sans text-[11px] font-semibold uppercase tracking-[0.15em] text-stone-700 transition-colors hover:border-stone-900 hover:text-stone-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
          className,
        )}
      >
        <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
        {COPY.button}
        {showActiveCount && activeCount > 0 && (
          <span
            aria-label={COPY.activeCount(activeCount)}
            className="flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[10px] tabular-nums tracking-normal text-white"
          >
            {activeCount}
          </span>
        )}
      </button>

      {/* Portal: render-time guard, safe because the sheet starts closed. */}
      {typeof document !== "undefined" &&
        createPortal(
          <AnimatePresence>
            {open && (
              <>
                <motion.div
                  key="filter-backdrop"
                  className="fixed inset-0 z-40 bg-stone-950/40 backdrop-blur-[2px]"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.3 }}
                  onClick={close}
                  aria-hidden="true"
                />
                <motion.div
                  key="filter-sheet"
                  ref={dialogRef}
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="filter-sheet-title"
                  className="fixed inset-x-0 bottom-0 z-50 flex max-h-[88dvh] flex-col rounded-t-3xl bg-white shadow-[0_-12px_40px_rgba(0,0,0,0.14)] md:inset-y-0 md:start-auto md:end-0 md:max-h-none md:w-[26rem] md:rounded-none md:shadow-[0_0_40px_rgba(0,0,0,0.14)]"
                  initial={offscreen}
                  animate={{ x: 0, y: 0 }}
                  exit={offscreen}
                  transition={{ duration: 0.4, ease: EASE }}
                >
                  {/* Header */}
                  <div className="flex items-center justify-between border-b border-stone-100 ps-6 pe-3 py-3">
                    <h2 id="filter-sheet-title" className="font-serif text-2xl font-medium text-stone-900">
                      {COPY.title}
                    </h2>
                    <button
                      type="button"
                      onClick={close}
                      aria-label={COPY.close}
                      className="flex h-11 w-11 items-center justify-center rounded-full text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-900"
                    >
                      <X className="h-5 w-5" />
                    </button>
                  </div>

                  {/* Body */}
                  <div className="flex-1 space-y-8 overflow-y-auto px-6 py-6">
                    <fieldset>
                      <legend className={LEGEND}>{COPY.sortLegend}</legend>
                      <div className="flex flex-wrap gap-2">
                        {SHOP_SORTS.map((sort) => (
                          <label key={sort} className="cursor-pointer">
                            <input
                              type="radio"
                              name="shop-sort"
                              value={sort}
                              checked={draft.sort === sort}
                              onChange={() => update({ sort })}
                              className="peer sr-only"
                            />
                            <span className={PILL}>{COPY.sorts[sort]}</span>
                          </label>
                        ))}
                      </div>
                    </fieldset>

                    <label className="flex min-h-11 cursor-pointer items-center justify-between gap-4">
                      <span className="font-sans text-sm font-medium text-stone-800">{COPY.sale}</span>
                      <input
                        type="checkbox"
                        role="switch"
                        checked={draft.sale}
                        onChange={(e) => update({ sale: e.target.checked })}
                        className="peer sr-only"
                      />
                      <span
                        aria-hidden="true"
                        className="relative h-7 w-12 shrink-0 rounded-full bg-stone-200 transition-colors peer-checked:bg-primary peer-focus-visible:ring-2 peer-focus-visible:ring-primary peer-focus-visible:ring-offset-2 after:absolute after:top-1 after:start-1 after:h-5 after:w-5 after:rounded-full after:bg-white after:shadow after:transition-transform peer-checked:after:translate-x-5 rtl:peer-checked:after:-translate-x-5"
                      />
                    </label>

                    <fieldset>
                      <legend className={LEGEND}>{COPY.priceLegend}</legend>
                      <div className="grid grid-cols-2 gap-3">
                        {(["min", "max"] as const).map((bound) => (
                          <label key={bound} className="block">
                            <span className="mb-1.5 block font-sans text-xs text-stone-500">{COPY[bound]}</span>
                            <input
                              type="number"
                              inputMode="decimal"
                              min={0}
                              step="any"
                              value={draft[bound]}
                              onChange={(e) =>
                                update(bound === "min" ? { min: e.target.value } : { max: e.target.value })
                              }
                              className="h-11 w-full rounded-full border border-stone-200 px-4 font-sans text-sm tabular-nums text-stone-900 outline-none transition-colors focus:border-stone-900"
                            />
                          </label>
                        ))}
                      </div>
                    </fieldset>

                    {facets.categories.length > 0 && (
                      <fieldset>
                        <legend className={LEGEND}>{COPY.categoriesLegend}</legend>
                        <div className="space-y-0.5">
                          {facets.categories.map((c) => (
                            <label key={c.slug} className={ROW}>
                              <input
                                type="checkbox"
                                checked={draft.category.includes(c.slug)}
                                onChange={() => toggleCategory(c.slug)}
                                className={CHECK}
                              />
                              {c.name}
                            </label>
                          ))}
                        </div>
                      </fieldset>
                    )}

                    {/* One collection at a time (?collection= is single-valued). */}
                    {facets.collections.length > 0 && (
                      <fieldset>
                        <legend className={LEGEND}>{COPY.collectionsLegend}</legend>
                        <div className="space-y-0.5">
                          {[{ name: COPY.anyCollection, slug: undefined }, ...facets.collections].map((c) => (
                            <label key={c.slug ?? ""} className={ROW}>
                              <input
                                type="radio"
                                name="shop-collection"
                                checked={draft.collection === c.slug}
                                onChange={() => update({ collection: c.slug })}
                                className={CHECK}
                              />
                              {c.name}
                            </label>
                          ))}
                        </div>
                      </fieldset>
                    )}
                  </div>

                  {/* Footer — the live count rides on Apply. */}
                  <div className="flex items-center gap-3 border-t border-stone-100 px-6 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
                    <button
                      type="button"
                      onClick={() => update(toDraft(DEFAULT_SHOP_FILTERS))}
                      disabled={!hasActiveFilters(fromDraft(draft)) && draft.sort === "featured"}
                      className="h-11 shrink-0 rounded-full px-4 font-sans text-xs font-semibold uppercase tracking-[0.15em] text-stone-600 underline-offset-4 transition-colors hover:text-stone-900 hover:underline disabled:pointer-events-none disabled:text-stone-300"
                    >
                      {COPY.clear}
                    </button>
                    <button
                      type="button"
                      onClick={apply}
                      className="flex h-12 flex-1 items-center justify-center gap-2 rounded-full bg-stone-900 px-6 font-sans text-xs font-semibold uppercase tracking-[0.15em] text-white transition-colors hover:bg-primary"
                    >
                      {(isCounting || !fresh) && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                      <span className="tabular-nums">{COPY.apply(freshCount)}</span>
                    </button>
                    <p className="sr-only" aria-live="polite">
                      {freshCount !== null ? COPY.countLive(freshCount) : ""}
                    </p>
                  </div>
                </motion.div>
              </>
            )}
          </AnimatePresence>,
          document.body,
        )}
    </>
  );
}

const LEGEND =
  "mb-3 font-sans text-[11px] font-semibold uppercase tracking-[0.2em] text-stone-400";
const PILL =
  "inline-flex h-11 items-center rounded-full border border-stone-200 px-4 font-sans text-sm text-stone-700 transition-colors hover:border-stone-400 peer-checked:border-stone-900 peer-checked:bg-stone-900 peer-checked:text-white peer-focus-visible:ring-2 peer-focus-visible:ring-primary peer-focus-visible:ring-offset-2";
const ROW =
  "flex min-h-11 cursor-pointer items-center gap-3 rounded-xl px-1 font-sans text-sm text-stone-800 transition-colors hover:bg-stone-50";
const CHECK = "h-5 w-5 shrink-0 accent-stone-900";
