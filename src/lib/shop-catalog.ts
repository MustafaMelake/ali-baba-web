import { unstable_cache } from "next/cache";
import type { Prisma } from "@/generated/prisma/client";
import type { ShopProduct } from "@/components/ProductCard";
import { prisma } from "@/lib/prisma";
import { LISTABLE_PRODUCT } from "@/lib/catalog";
import { ACTIVE_COLLECTION } from "@/lib/collections";
import { pageSlice, STOREFRONT_PAGE_SIZE } from "@/lib/pagination";
import { productCardInclude, toProductCard } from "@/lib/product-cards";
import {
  filterAndSortShopEntries,
  needsPricing,
  type ShopFacets,
} from "@/lib/shop-filters";
import type { ShopFilters } from "@/lib/validators";

// ─────────────────────────────────────────────────────────────────────────────
// /shop catalog reads — the Prisma half of the filter engine
// (`src/lib/shop-filters.ts` is the pure half). Server-only by usage: read by
// the /shop page and by the filter sheet's public count action.
//
// Two paths, one `where`, one card mapper:
//   • FAST — nothing depends on a price (no sale/min/max, sort featured or
//     newest): Postgres orders, counts and paginates, exactly like every other
//     listing.
//   • PRICED — every matching listable product is priced through the shared
//     card chain (`toProductCard`: four promotion levels, the caller's ONE
//     `now`), then filtered and sorted on the final starting price in memory,
//     then sliced. Promotions make a stored sort key impossible — a price is
//     only known once resolved. That loads the whole match set per request:
//     fine for a catalog of a few thousand products (DOMAIN_MAP §3.6).
// ─────────────────────────────────────────────────────────────────────────────

/** Listable products narrowed by the (already resolved) category / collection. */
export function shopProductWhere(filters: ShopFilters): Prisma.ProductWhereInput {
  return {
    ...LISTABLE_PRODUCT,
    ...(filters.category.length > 0 ? { category: { slug: { in: filters.category } } } : {}),
    ...(filters.collection
      ? { collections: { some: { collection: { slug: filters.collection, ...ACTIVE_COLLECTION } } } }
      : {}),
  };
}

/** The Postgres order for the price-free sorts (`id` breaks createdAt ties). */
function shopOrderBy(filters: ShopFilters): Prisma.ProductOrderByWithRelationInput[] {
  const newest: Prisma.ProductOrderByWithRelationInput[] = [{ createdAt: "desc" }, { id: "desc" }];
  return filters.sort === "featured" ? [{ isFeatured: "desc" }, ...newest] : newest;
}

/** Every match, priced and filtered/sorted on the final price (the PRICED path). */
async function pricedEntries(filters: ShopFilters, now: Date) {
  const rows = await prisma.product.findMany({
    where: shopProductWhere(filters),
    include: productCardInclude(now),
  });
  return filterAndSortShopEntries(
    rows.map((row) => ({ card: toProductCard(row, now), createdAt: row.createdAt, isFeatured: row.isFeatured })),
    filters,
  );
}

/** One page of priced cards plus the total across all pages. */
export async function getShopListing(
  filters: ShopFilters,
  page: number,
  now: Date,
): Promise<{ cards: ShopProduct[]; total: number }> {
  const { skip, take } = pageSlice(page, STOREFRONT_PAGE_SIZE);

  if (needsPricing(filters)) {
    const entries = await pricedEntries(filters, now);
    return { cards: entries.slice(skip, skip + take).map((e) => e.card), total: entries.length };
  }

  const where = shopProductWhere(filters);
  const [total, rows] = await Promise.all([
    prisma.product.count({ where }),
    prisma.product.findMany({
      where,
      include: productCardInclude(now),
      orderBy: shopOrderBy(filters),
      skip,
      take,
    }),
  ]);
  return { cards: rows.map((row) => toProductCard(row, now)), total };
}

/** How many products match — the filter sheet's live count. */
export async function countShopListing(filters: ShopFilters, now: Date): Promise<number> {
  if (needsPricing(filters)) return (await pricedEntries(filters, now)).length;
  return prisma.product.count({ where: shopProductWhere(filters) });
}

/** What the filter sheet offers: every category, every ACTIVE collection. */
export async function getShopFacets(): Promise<ShopFacets> {
  const [categories, collections] = await Promise.all([
    prisma.category.findMany({ orderBy: { name: "asc" }, select: { name: true, slug: true } }),
    prisma.collection.findMany({
      where: ACTIVE_COLLECTION,
      orderBy: [{ order: "asc" }, { createdAt: "asc" }],
      select: { name: true, slug: true },
    }),
  ]);
  return { categories, collections };
}

/**
 * `getShopFacets` behind a 60s cache, for the public count action: it runs on
 * every pause in the sheet, from anyone, so it shouldn't add two queries per
 * call. The facets only drop unknown slugs, and 60s is the staleness the ISR
 * listings that open the sheet already carry. The /shop page reads uncached.
 */
export const getCachedShopFacets = unstable_cache(getShopFacets, ["shop-facets"], {
  revalidate: 60,
});
