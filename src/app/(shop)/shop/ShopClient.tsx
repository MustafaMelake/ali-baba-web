"use client";

import { useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowLeft, X } from "lucide-react";
import ProductCard, { type ShopProduct } from "@/components/ProductCard";
import GridDensityToggle from "@/components/GridDensityToggle";
import FilterSortButton from "@/components/shop/FilterSortButton";
import { PRODUCT_GRID_PHONE } from "@/lib/grid-density";
import {
  clearedShopFilters,
  hasActiveFilters,
  shopHref,
  type ShopFacets,
} from "@/lib/shop-filters";
import type { ShopFilters } from "@/lib/validators";
import { cn, formatMoney } from "@/lib/utils";

const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];

/** Strings kept out of the markup (the Arabic locale swaps this table). */
const COPY = {
  all: "All Products",
  eyebrow: "Est. 1998 · The Maison",
  count: (n: number) => (n === 1 ? "Creation" : "Creations"),
  back: (name: string) => `Back to ${name}`,
  activeFilters: "Active filters",
  remove: (label: string) => `Remove filter: ${label}`,
  onSale: "On sale",
  priceRange: (min: number, max: number) => `EGP ${formatMoney(min)} – ${formatMoney(max)}`,
  priceFrom: (min: number) => `From EGP ${formatMoney(min)}`,
  priceUpTo: (max: number) => `Up to EGP ${formatMoney(max)}`,
  clearAll: "Clear all",
  noMatchTitle: "No creations match these filters.",
  noMatchBody: "Try a wider price range, or fewer categories.",
  clearFilters: "Clear filters",
  emptyTitle: "Nothing here yet.",
  emptyBody: "These creations are being perfected. Please check back soon.",
} as const;

/**
 * The page's subject when the URL narrows to exactly one category or one
 * collection: its name becomes the heading, with a link back to its own page.
 */
export interface ShopHeading {
  kind: "Category" | "Collection";
  name: string;
  href: string;
}

export interface ShopClientProps {
  /** Every category and active collection — the pills and the filter sheet. */
  facets: ShopFacets;
  /** The validated, resolved filters this page was rendered for. */
  filters: ShopFilters;
  /** One page, already filtered + sorted server-side — rendered as-is. */
  products: ShopProduct[];
  /** Products matching the filters across ALL pages (the count line). */
  total: number;
  heading: ShopHeading | null;
  /** The page control (a <Pagination />), rendered under the grid. */
  pagination?: React.ReactNode;
}

export default function ShopClient({
  facets,
  filters,
  products,
  total,
  heading,
  pagination,
}: ShopClientProps) {
  const router = useRouter();
  // Keeps the UI interactive while the server refetches the filtered grid, and
  // exposes a pending flag we use to dim the grid mid-transition.
  const [isPending, startTransition] = useTransition();

  // Every filter change is a navigation to the /shop URL that describes it
  // (page dropped — `shopHref` never emits one); scroll:false keeps the
  // sticky bar in place.
  function navigate(href: string) {
    startTransition(() => {
      router.push(href, { scroll: false });
    });
  }

  // The pills are a quick single-category pick; the other filters stay.
  const onlyCategory = filters.category.length === 1 ? filters.category[0] : null;
  const pills: { name: string; slug: string | null }[] = [
    { name: COPY.all, slug: null },
    ...facets.categories,
  ];

  // Removable chips, one per active filter.
  const nameOf = (list: { name: string; slug: string }[], slug: string) =>
    list.find((f) => f.slug === slug)?.name ?? slug;
  const chips: { key: string; label: string; href: string }[] = [
    ...filters.category.map((slug) => ({
      key: `category-${slug}`,
      label: nameOf(facets.categories, slug),
      href: shopHref({ ...filters, category: filters.category.filter((s) => s !== slug) }),
    })),
    ...(filters.collection
      ? [{
          key: "collection",
          label: nameOf(facets.collections, filters.collection),
          href: shopHref({ ...filters, collection: undefined }),
        }]
      : []),
    ...(filters.sale
      ? [{ key: "sale", label: COPY.onSale, href: shopHref({ ...filters, sale: false }) }]
      : []),
    ...(filters.min !== undefined || filters.max !== undefined
      ? [{
          key: "price",
          label:
            filters.min !== undefined && filters.max !== undefined
              ? COPY.priceRange(filters.min, filters.max)
              : filters.min !== undefined
                ? COPY.priceFrom(filters.min)
                : COPY.priceUpTo(filters.max!),
          href: shopHref({ ...filters, min: undefined, max: undefined }),
        }]
      : []),
  ];
  const filtered = hasActiveFilters(filters);

  return (
    <div className="min-h-screen bg-white pt-8 md:pt-10">
      {/* ─── Editorial header ──────────────────────────────── */}
      <header className="max-w-screen-xl mx-auto px-6 md:px-10 lg:px-14 pt-12 md:pt-20 pb-10 md:pb-14 text-center">
        <motion.span
          className="inline-block font-sans text-[11px] font-semibold uppercase tracking-[0.35em] text-primary mb-6"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, ease: EASE }}
        >
          {heading ? heading.kind : COPY.eyebrow}
        </motion.span>

        <motion.h1
          key={heading?.href ?? "shop"}
          className="font-serif font-medium tracking-tight leading-[1.02] text-stone-900 text-[clamp(2.5rem,7vw,5.5rem)]"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.9, ease: EASE, delay: 0.08 }}
        >
          {heading ? (
            heading.name
          ) : (
            <>
              Our Signature <em className="not-italic text-primary">Creations</em>
            </>
          )}
        </motion.h1>

        {heading ? (
          <Link
            href={heading.href}
            className="mt-6 inline-flex min-h-11 items-center gap-2 font-sans text-[11px] font-semibold uppercase tracking-[0.18em] text-stone-500 transition-colors hover:text-primary"
          >
            <ArrowLeft className="h-3.5 w-3.5 rtl:-scale-x-100" aria-hidden="true" />
            {COPY.back(heading.name)}
          </Link>
        ) : (
          <motion.p
            className="mx-auto mt-6 max-w-xl font-sans text-base text-stone-500 leading-relaxed"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, ease: EASE, delay: 0.2 }}
          >
            A curated anthology of our most celebrated creations — each one
            hand-crafted in the Menouf kitchen, perfected over a quarter century.
          </motion.p>
        )}
      </header>

      {/* ─── Category pills ────────────────────────────────── */}
      <motion.div
        className="sticky top-0 md:top-0 z-30 bg-white/90 backdrop-blur-md border-y border-stone-100"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.6, delay: 0.3 }}
      >
        <div className="max-w-screen-xl mx-auto px-4 md:px-10 lg:px-14">
          <div className="flex items-center justify-center gap-2 overflow-x-auto py-4 scrollbar-none -mx-1 px-1">
            {pills.map((cat) => {
              const isActive =
                cat.slug === null ? filters.category.length === 0 : cat.slug === onlyCategory;
              return (
                <button
                  key={cat.name}
                  onClick={() => navigate(shopHref({ ...filters, category: cat.slug ? [cat.slug] : [] }))}
                  aria-pressed={isActive}
                  className={`relative shrink-0 rounded-full px-5 py-2.5 font-sans text-[13px] font-medium uppercase tracking-[0.12em] transition-colors duration-300 ${
                    isActive
                      ? "text-white"
                      : "text-stone-500 hover:text-stone-900"
                  }`}
                >
                  {isActive && (
                    <motion.span
                      layoutId="shop-filter-pill"
                      className="absolute inset-0 rounded-full bg-stone-900"
                      transition={{
                        type: "spring",
                        stiffness: 380,
                        damping: 32,
                      }}
                    />
                  )}
                  <span className="relative z-10 whitespace-nowrap">{cat.name}</span>
                </button>
              );
            })}
          </div>
        </div>
      </motion.div>

      {/* ─── Product grid ──────────────────────────────────── */}
      <div className="max-w-screen-xl mx-auto px-6 md:px-10 lg:px-14 py-12 md:py-16">
        {/* Result count + the grid-density switch + Filter & sort */}
        <div className="mb-6 flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
          <p className="font-sans text-xs uppercase tracking-[0.2em] text-stone-400">
            <span className="tabular-nums">{total}</span> {COPY.count(total)}
          </p>
          <div className="flex items-center gap-2">
            <GridDensityToggle />
            <FilterSortButton
              facets={facets}
              initial={filters}
              initialCount={total}
              onApply={navigate}
              showActiveCount
            />
          </div>
        </div>

        {/* Active filters — each chip removes itself */}
        {chips.length > 0 && (
          <ul aria-label={COPY.activeFilters} className="mb-8 flex flex-wrap items-center gap-2">
            {chips.map((chip) => (
              <li key={chip.key}>
                <button
                  type="button"
                  onClick={() => navigate(chip.href)}
                  aria-label={COPY.remove(chip.label)}
                  className="inline-flex h-11 items-center gap-2 rounded-full border border-stone-200 bg-stone-50 ps-4 pe-3 font-sans text-sm tabular-nums text-stone-700 transition-colors hover:border-stone-900 hover:text-stone-900"
                >
                  {chip.label}
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </li>
            ))}
            {chips.length > 1 && (
              <li>
                <button
                  type="button"
                  onClick={() => navigate(shopHref(clearedShopFilters(filters)))}
                  className="h-11 px-3 font-sans text-xs font-semibold uppercase tracking-[0.15em] text-stone-500 underline-offset-4 transition-colors hover:text-stone-900 hover:underline"
                >
                  {COPY.clearAll}
                </button>
              </li>
            )}
          </ul>
        )}

        <motion.div
          layout
          data-product-grid
          className={cn("grid sm:grid-cols-2 sm:gap-8 lg:grid-cols-3 xl:grid-cols-4", PRODUCT_GRID_PHONE)}
          // Pending dim while the server refetches — purely additive (opacity 1
          // at rest, so the resting layout is byte-identical); a CSS opacity
          // transition that never touches Framer's transform-based layout anim.
          style={{ opacity: isPending ? 0.6 : 1, transition: "opacity 0.25s ease" }}
        >
          <AnimatePresence mode="popLayout">
            {products.map((product) => (
              <motion.div
                key={product.id}
                layout
                initial={{ opacity: 0, scale: 0.94 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.94 }}
                transition={{ duration: 0.45, ease: EASE }}
              >
                <ProductCard product={product} />
              </motion.div>
            ))}
          </AnimatePresence>
        </motion.div>

        {pagination}

        {/* Empty states — no match for the filters, or a genuinely empty catalog. */}
        {products.length === 0 && (
          <div className="py-24 text-center">
            <p className="font-serif text-2xl text-stone-800 mb-2">
              {filtered ? COPY.noMatchTitle : COPY.emptyTitle}
            </p>
            <p className="font-sans text-sm text-stone-400">
              {filtered ? COPY.noMatchBody : COPY.emptyBody}
            </p>
            {filtered && (
              <button
                type="button"
                onClick={() => navigate(shopHref(clearedShopFilters(filters)))}
                className="mt-8 inline-flex h-12 items-center rounded-full bg-stone-900 px-7 font-sans text-xs font-semibold uppercase tracking-[0.18em] text-white transition-colors hover:bg-primary"
              >
                {COPY.clearFilters}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
