import type { ShopProduct } from "@/components/ProductCard";
import { shopFiltersSchema, type ShopFilters } from "@/lib/validators";

// ─────────────────────────────────────────────────────────────────────────────
// /shop filters & sort — the pure half of the one filter engine.
//
// Filtering lives ONLY on /shop: it is already dynamic (it reads
// `searchParams`), while the category / collection / new-arrivals listings are
// ISR and must not read the query string. Their "Filter & sort" button just
// navigates here with the page's context preset (`shopHref`).
//
// What's here: parsing (the soft `shopFiltersSchema`), resolving slugs against
// what exists, URL building, and the in-memory filter + sort that runs on the
// FINAL (discounted) starting price — the exact number the card shows, priced
// by `toProductCard`. The Prisma half is `src/lib/shop-catalog.ts`.
//
// Plain module, no Prisma client — imported by the page, the count action and
// the client filter sheet alike, so all three read a URL the same way.
// ─────────────────────────────────────────────────────────────────────────────

export const DEFAULT_SHOP_FILTERS: ShopFilters = {
  category: [],
  collection: undefined,
  sale: false,
  min: undefined,
  max: undefined,
  sort: "featured",
};

/** Any input (searchParams, the sheet's query, junk) → valid filters. Never throws. */
export function parseShopFilters(raw: unknown): ShopFilters {
  const parsed = shopFiltersSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : DEFAULT_SHOP_FILTERS;
}

/** A category or collection as the filter UI needs it. */
export type ShopFacet = { name: string; slug: string };
export type ShopFacets = { categories: ShopFacet[]; collections: ShopFacet[] };

/**
 * Drop slugs that name nothing a shopper can see — an unknown category, a
 * missing or draft collection — so a stale link is ignored rather than
 * emptying the page.
 */
export function resolveShopFilters(filters: ShopFilters, facets: ShopFacets): ShopFilters {
  const categories = new Set(facets.categories.map((c) => c.slug));
  const collections = new Set(facets.collections.map((c) => c.slug));
  return {
    ...filters,
    category: filters.category.filter((slug) => categories.has(slug)),
    collection: filters.collection && collections.has(filters.collection) ? filters.collection : undefined,
  };
}

/** The query record for these filters — defaults omitted, never a `page`. */
export type ShopQuery = Record<string, string | string[]>;

export function toShopQuery(filters: ShopFilters): ShopQuery {
  const query: ShopQuery = {};
  if (filters.category.length > 0) query.category = filters.category;
  if (filters.collection) query.collection = filters.collection;
  if (filters.sale) query.sale = "1";
  if (filters.min !== undefined) query.min = String(filters.min);
  if (filters.max !== undefined) query.max = String(filters.max);
  if (filters.sort !== "featured") query.sort = filters.sort;
  return query;
}

/**
 * The /shop URL for these filters. Always page 1 — any filter change drops
 * `page`. Also the ISR listings' preset link (`/shop?category=…&sale=1`).
 */
export function shopHref(filters: ShopFilters): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(toShopQuery(filters))) {
    for (const v of Array.isArray(value) ? value : [value]) params.append(key, v);
  }
  const qs = params.toString();
  return qs ? `/shop?${qs}` : "/shop";
}

/** True when anything narrows the result (sort alone doesn't). */
export function hasActiveFilters(filters: ShopFilters): boolean {
  return (
    filters.category.length > 0 ||
    filters.collection !== undefined ||
    filters.sale ||
    filters.min !== undefined ||
    filters.max !== undefined
  );
}

/** "Clear filters" — everything off, the chosen sort kept. */
export function clearedShopFilters(filters: ShopFilters): ShopFilters {
  return { ...DEFAULT_SHOP_FILTERS, sort: filters.sort };
}

/**
 * Whether the result depends on resolved prices. When it doesn't, Postgres
 * can order and paginate on its own (`shop-catalog.ts`'s fast path).
 */
export function needsPricing(filters: ShopFilters): boolean {
  return (
    filters.sale ||
    filters.min !== undefined ||
    filters.max !== undefined ||
    filters.sort === "price-asc" ||
    filters.sort === "price-desc"
  );
}

/**
 * A card is "on sale" exactly when it shows a strikethrough — a live promotion
 * or a manual Compare-At above the selling price. `ProductCard` draws its
 * strikethrough from this, so the filter and the card can't disagree.
 */
export function isOnSale(card: Pick<ShopProduct, "price" | "compareAtPrice">): boolean {
  return card.compareAtPrice != null && card.compareAtPrice > card.price;
}

/** A priced card plus the columns the orderings read. */
export type PricedShopEntry = { card: ShopProduct; createdAt: Date; isFeatured: boolean };

// Newest first, product id descending on a tie — the same order Postgres
// gives `orderBy: [{ createdAt: "desc" }, { id: "desc" }]`.
function newestFirst(a: PricedShopEntry, b: PricedShopEntry): number {
  const byDate = b.createdAt.getTime() - a.createdAt.getTime();
  if (byDate !== 0) return byDate;
  return a.card.id < b.card.id ? 1 : a.card.id > b.card.id ? -1 : 0;
}

const COMPARATORS: Record<ShopFilters["sort"], (a: PricedShopEntry, b: PricedShopEntry) => number> = {
  featured: (a, b) => Number(b.isFeatured) - Number(a.isFeatured) || newestFirst(a, b),
  newest: newestFirst,
  "price-asc": (a, b) => a.card.price - b.card.price || newestFirst(a, b),
  "price-desc": (a, b) => b.card.price - a.card.price || newestFirst(a, b),
};

/**
 * Apply sale / min / max and the sort to already-priced cards. Every
 * comparison is on `card.price` — the final (discounted) starting price the
 * shopper sees — never the base price. Bounds are inclusive.
 */
export function filterAndSortShopEntries<T extends PricedShopEntry>(
  entries: T[],
  filters: ShopFilters,
): T[] {
  return entries
    .filter(
      ({ card }) =>
        (!filters.sale || isOnSale(card)) &&
        (filters.min === undefined || card.price >= filters.min) &&
        (filters.max === undefined || card.price <= filters.max),
    )
    .sort(COMPARATORS[filters.sort]);
}
