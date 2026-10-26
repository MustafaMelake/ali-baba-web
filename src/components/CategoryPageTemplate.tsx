import Link from "next/link";
import { ChevronRight } from "lucide-react";
import ProductCard, { type ShopProduct } from "@/components/ProductCard";
import GridDensityToggle from "@/components/GridDensityToggle";
import FilterSortButton from "@/components/shop/FilterSortButton";
import { PRODUCT_GRID_PHONE } from "@/lib/grid-density";
import type { ShopFacets } from "@/lib/shop-filters";
import type { ShopFilters } from "@/lib/validators";
import { cn } from "@/lib/utils";

export interface CategoryPageTemplateProps {
  /** Display title, e.g. "Oriental Sweets" or a collection's name. */
  title: string;
  /** Editorial description shown beneath the title. */
  description: string;
  /** The small label above the title — "Category" or "Collection". */
  eyebrow: string;
  /** Breadcrumb links between Home and the current page (e.g. Shop, Collections). */
  crumbs: { label: string; href: string }[];
  /** One page of already-priced cards (`toProductCard` — the math is never done here). */
  cards: ShopProduct[];
  /** Listable products across ALL pages (the count line). */
  total: number;
  /** Optional heading above the grid, e.g. "All Cakes" under collection cards. */
  gridHeading?: string;
  /** Rendered between the header and the grid (e.g. a category's collection cards). */
  beforeGrid?: React.ReactNode;
  /** The page control for a multi-page listing (a <Pagination />), rendered under the grid. */
  pagination?: React.ReactNode;
  /**
   * "Filter & sort": the sheet's lists, and this page's context preset (e.g.
   * its category). Applying navigates to /shop — this ISR page never reads
   * the query string itself.
   */
  filter: { facets: ShopFacets; preset: ShopFilters };
}

/**
 * Shared Server Component for a product listing page — a category or a
 * collection: an editorial header, an optional block above the grid, the grid
 * of pre-priced cards, and the page control.
 *
 * Takes cards already priced by `toProductCard` (`@/lib/product-cards`), so no
 * discount math lives in a component. Server Component by default (no "use
 * client") — it composes the client `ProductCard` for quick-add. Deliberately
 * reads NO per-user state (wishlist hearts hydrate client-side from the shared
 * store), so the pages using it can be served from a shared ISR cache.
 */
export default function CategoryPageTemplate({
  title,
  description,
  eyebrow,
  crumbs,
  cards,
  total,
  gridHeading,
  beforeGrid,
  pagination,
  filter,
}: CategoryPageTemplateProps) {
  return (
    // Navbar/Footer (and the fixed-navbar clearance) come from the (shop)
    // layout — the header's top padding here is purely editorial spacing.
    <div className="min-h-screen bg-white font-sans" dir="ltr">
      {/* ─── Editorial header ─────────────────────────────── */}
      <header className="relative overflow-hidden border-b border-stone-100 bg-[#FAFAFA]">
        <div className="mx-auto max-w-screen-xl px-6 pb-12 pt-12 text-center md:px-10 md:pb-16 md:pt-16 lg:px-14">
          {/* Breadcrumb */}
          <nav
            aria-label="Breadcrumb"
            className="mb-7 flex items-center justify-center gap-1.5 font-sans text-[11px] font-medium uppercase tracking-[0.18em] text-stone-400"
          >
            <Link href="/" className="transition-colors hover:text-primary">
              Home
            </Link>
            {crumbs.map((crumb) => (
              <span key={crumb.href} className="contents">
                <ChevronRight className="h-3 w-3 rtl:-scale-x-100" aria-hidden="true" />
                <Link href={crumb.href} className="transition-colors hover:text-primary">
                  {crumb.label}
                </Link>
              </span>
            ))}
            <ChevronRight className="h-3 w-3 rtl:-scale-x-100" aria-hidden="true" />
            <span className="text-stone-600">{title}</span>
          </nav>

          <p className="mb-5 font-sans text-[11px] font-semibold uppercase tracking-[0.35em] text-primary">
            {eyebrow}
          </p>

          <h1 className="font-serif font-medium leading-[1.03] tracking-tight text-stone-900 text-[clamp(2.5rem,6.5vw,5rem)]">
            {title}
          </h1>

          <p className="mx-auto mt-6 max-w-2xl font-sans text-base leading-relaxed text-stone-500 md:text-lg">
            {description}
          </p>

          <p className="mt-8 font-sans text-xs font-medium uppercase tracking-[0.2em] text-stone-400">
            <span className="tabular-nums">{total}</span> {total === 1 ? "creation" : "creations"}
          </p>
        </div>
      </header>

      {beforeGrid}

      {/* ─── Product grid ─────────────────────────────────── */}
      <section
        aria-label={gridHeading ?? `${title} products`}
        className="mx-auto max-w-screen-xl px-6 py-14 md:px-10 md:py-20 lg:px-14"
      >
        {/* Grid heading + the phone grid-density switch + Filter & sort */}
        {(gridHeading || cards.length > 0) && (
        <div className="mb-8 flex flex-wrap items-end justify-between gap-x-4 gap-y-3 md:mb-10">
          {gridHeading ? (
            <h2 className="text-start font-serif text-3xl font-medium tracking-tight text-stone-900 md:text-4xl">
              {gridHeading}
            </h2>
          ) : (
            <span />
          )}
          {cards.length > 0 && (
            <div className="flex items-center gap-2">
              <GridDensityToggle />
              <FilterSortButton facets={filter.facets} initial={filter.preset} />
            </div>
          )}
        </div>
        )}
        {cards.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <p className="font-serif text-2xl font-medium text-stone-700 md:text-3xl">
              Nothing here just yet
            </p>
            <p className="mt-3 max-w-md font-sans text-sm text-stone-400">
              We&apos;re still perfecting this selection. Explore the rest of the
              maison in the meantime.
            </p>
            <Link
              href="/shop"
              className="mt-8 inline-flex items-center gap-2 rounded-full bg-stone-900 px-7 py-3 font-sans text-xs font-semibold uppercase tracking-[0.18em] text-white transition-colors hover:bg-primary"
            >
              Browse all products
            </Link>
          </div>
        ) : (
          <div
            data-product-grid
            className={cn("grid sm:grid-cols-2 sm:gap-x-6 sm:gap-y-12 lg:grid-cols-3 xl:grid-cols-4", PRODUCT_GRID_PHONE)}
          >
            {cards.map((card) => (
              <ProductCard key={card.id} product={card} />
            ))}
          </div>
        )}
        {pagination}
      </section>
    </div>
  );
}
