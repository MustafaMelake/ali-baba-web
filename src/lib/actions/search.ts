"use server";

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import {
  gatherPromotions,
  livePromotionWhere,
  PROMOTION_SELECT_FIELDS,
  resolvePrice,
} from "@/lib/discounts";
import { searchQuerySchema, searchTokens } from "@/lib/validators";
import { LISTABLE_PRODUCT } from "@/lib/catalog";
import { ACTIVE_COLLECTION, listableCountsByCollection } from "@/lib/collections";

/**
 * Storefront search — the two reads behind the search palette
 * (src/components/search/).
 *
 * Read-only, yet Server Actions rather than RSC loaders: a client island calls
 * them at interaction time (as the wishlist store calls
 * getWishlistedProductIds), and the platform has no API routes to fetch from.
 * Public by design — guests search too — so there is no gate. Every hit is a
 * listable product or category; prices run through the Discount Engine
 * against ONE `now` per call and leave as plain numbers. The café menu is a
 * sealed world and is deliberately not searched. Nothing here writes, so
 * nothing here revalidates.
 */

export type SearchProductHit = {
  id: string;
  name: string;
  slug: string;
  image: string;
  category: string;
  /** Final (possibly discounted) starting price — what the PDP will show. */
  price: number;
  /**
   * The struck-through "was" price: the base price while a live promotion
   * applies, otherwise the variant's manual Compare-At (null when neither).
   */
  compareAtPrice: number | null;
};

export type SearchCategoryHit = {
  id: string;
  name: string;
  slug: string;
  image: string | null;
  /** Listable products in the category. */
  productCount: number;
};

/** A curated collection — same row shape as a category hit, its own group. */
export type SearchCollectionHit = {
  id: string;
  name: string;
  slug: string;
  image: string | null;
  /** Listable products in the collection. */
  productCount: number;
};

export type SearchResults = {
  /** The normalized query these hits answer (see normalizeSearchQuery). */
  query: string;
  products: SearchProductHit[];
  categories: SearchCategoryHit[];
  collections: SearchCollectionHit[];
};

export type SearchSuggestions = {
  categories: SearchCategoryHit[];
  products: SearchProductHit[];
};

export type SearchCatalogResult =
  | { success: true; data: SearchResults }
  | { success: false; error: string };

export type SearchSuggestionsResult =
  | { success: true; data: SearchSuggestions }
  | { success: false; error: string };

const PRODUCT_LIMIT = 6;
const CATEGORY_LIMIT = 3;
/** Collections shown for a query (active ones, matched on name). */
const COLLECTION_LIMIT = 4;
/**
 * Name matches fetched before the in-memory relevance ranking — headroom over
 * PRODUCT_LIMIT so an alphabetical cut can't drop the best (prefix) match.
 */
const NAME_CANDIDATE_LIMIT = 24;
const SUGGESTED_CATEGORY_LIMIT = 8;
const SUGGESTED_PRODUCT_LIMIT = 4;

/** Case-insensitive substring match — compiles to ILIKE on Postgres. */
function matching(token: string) {
  return { contains: token, mode: "insensitive" as const };
}

/**
 * Only what a hit renders: no description, and only the starting
 * (lowest-price available) variant — with the three-level live-promotion
 * hierarchy (category / product / variant) the Discount Engine needs.
 */
function hitSelect(now: Date) {
  return {
    id: true,
    name: true,
    slug: true,
    images: true,
    category: {
      select: {
        name: true,
        promotions: { where: livePromotionWhere(now), select: PROMOTION_SELECT_FIELDS },
      },
    },
    promotions: { where: livePromotionWhere(now), select: PROMOTION_SELECT_FIELDS },
    variants: {
      where: { isAvailable: true },
      orderBy: { price: "asc" }, // [0] = starting (lowest) price
      take: 1,
      select: {
        price: true,
        compareAtPrice: true,
        promotions: { where: livePromotionWhere(now), select: PROMOTION_SELECT_FIELDS },
      },
    },
  } satisfies Prisma.ProductSelect;
}

type HitRow = Prisma.ProductGetPayload<{ select: ReturnType<typeof hitSelect> }>;

/**
 * The listability filter and the nested variant read needn't be one
 * statement: a variant archived in between leaves a row with nothing to
 * price. Drop it rather than render "0 ج.م".
 */
function hasStartingVariant(row: HitRow): boolean {
  return row.variants.length > 0;
}

const CATEGORY_HIT_SELECT = {
  id: true,
  name: true,
  slug: true,
  image: true,
  _count: { select: { products: { where: LISTABLE_PRODUCT } } },
} satisfies Prisma.CategorySelect;

type CategoryHitRow = Prisma.CategoryGetPayload<{ select: typeof CATEGORY_HIT_SELECT }>;

/**
 * Prices the starting variant through the Discount Engine and serializes the
 * row into the plain-number hit the client renders — the same fallback chain
 * as the storefront cards; the math itself lives only in `discounts.ts`.
 */
function toProductHit(product: HitRow, now: Date): SearchProductHit {
  const starting = product.variants[0];
  const priced = resolvePrice(
    starting?.price ?? 0,
    gatherPromotions(
      starting?.promotions,
      product.promotions,
      product.category.promotions,
    ),
    now,
  );
  return {
    id: product.id,
    name: product.name,
    slug: product.slug,
    image: product.images[0] ?? "/placeholder.jpg",
    category: product.category.name,
    price: priced.finalPrice,
    // Live promo → struck-through base price; otherwise fall back to the
    // variant's manual Compare-At (mirrors the PDP). The Decimal column is
    // serialized to a plain number for the client.
    compareAtPrice: priced.hasDiscount
      ? priced.basePrice
      : starting?.compareAtPrice?.toNumber() ?? null,
  };
}

function toCategoryHit(category: CategoryHitRow): SearchCategoryHit {
  return {
    id: category.id,
    name: category.name,
    slug: category.slug,
    image: category.image,
    productCount: category._count.products,
  };
}

/**
 * Relevance among name matches: the name starts with the whole query (0),
 * every query word starts a word of the name (1), anything else (2). Ties
 * fall back to alphabetical so results never reshuffle between calls.
 */
function byNameRelevance<T extends { name: string }>(rows: T[], query: string): T[] {
  const needle = query.toLocaleLowerCase();
  const tokens = searchTokens(needle);
  const rank = (name: string) => {
    const haystack = name.toLocaleLowerCase();
    if (haystack.startsWith(needle)) return 0;
    const words = haystack.split(/[\s\-–—]+/);
    return tokens.every((token) => words.some((word) => word.startsWith(token))) ? 1 : 2;
  };
  return rows
    .map((row) => ({ row, rank: rank(row.name) }))
    .sort((a, b) => a.rank - b.rank || a.row.name.localeCompare(b.row.name))
    .map(({ row }) => row);
}

/**
 * Searches the commerce catalog: products by name (ranked first), then by
 * description or category name, plus matching categories. Every word of the
 * query must match. Public — guests search too.
 */
export async function searchCatalog(query: string): Promise<SearchCatalogResult> {
  const parsed = searchQuerySchema.safeParse(query);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid search." };
  }

  const term = parsed.data;
  const tokens = searchTokens(term);
  const nameHasEveryWord = tokens.map((token) => ({ name: matching(token) }));

  // One instant drives every promotion filter + evaluation this call.
  const now = new Date();

  try {
    const [nameRows, otherRows, categoryRows, collectionRows] = await Promise.all([
      // Primary: every word in the product name — ranked in memory below.
      prisma.product.findMany({
        where: { ...LISTABLE_PRODUCT, AND: nameHasEveryWord },
        select: hitSelect(now),
        orderBy: { name: "asc" },
        take: NAME_CANDIDATE_LIMIT,
      }),
      // Secondary: every word somewhere in the name, description or category
      // name — minus the primary set. These only fill the slots name matches
      // leave free.
      prisma.product.findMany({
        where: {
          ...LISTABLE_PRODUCT,
          AND: tokens.map((token) => ({
            OR: [
              { name: matching(token) },
              { description: matching(token) },
              { category: { name: matching(token) } },
            ],
          })),
          NOT: { AND: nameHasEveryWord },
        },
        select: hitSelect(now),
        orderBy: { name: "asc" },
        take: PRODUCT_LIMIT,
      }),
      prisma.category.findMany({
        where: { AND: nameHasEveryWord, products: { some: LISTABLE_PRODUCT } },
        select: CATEGORY_HIT_SELECT,
        orderBy: { name: "asc" },
        take: NAME_CANDIDATE_LIMIT,
      }),
      // Active collections with something to show, every word in the name.
      prisma.collection.findMany({
        where: {
          ...ACTIVE_COLLECTION,
          AND: nameHasEveryWord,
          products: { some: { product: LISTABLE_PRODUCT } },
        },
        select: { id: true, name: true, slug: true, image: true },
        orderBy: { name: "asc" },
        take: NAME_CANDIDATE_LIMIT,
      }),
    ]);

    const products = [...byNameRelevance(nameRows, term), ...otherRows]
      .filter(hasStartingVariant)
      .slice(0, PRODUCT_LIMIT)
      .map((row) => toProductHit(row, now));
    const categories = byNameRelevance(categoryRows, term)
      .slice(0, CATEGORY_LIMIT)
      .map(toCategoryHit);

    const rankedCollections = byNameRelevance(collectionRows, term).slice(0, COLLECTION_LIMIT);
    const counts = await listableCountsByCollection(rankedCollections.map((c) => c.id));
    const collections: SearchCollectionHit[] = rankedCollections.map((c) => ({
      ...c,
      productCount: counts.get(c.id) ?? 0,
    }));

    return { success: true, data: { query: term, products, categories, collections } };
  } catch (err) {
    console.error("searchCatalog failed:", err);
    return { success: false, error: "Search is unavailable right now. Please try again." };
  }
}

/**
 * What the palette shows before anything is typed: categories to jump
 * straight into (featured first, in slider order) and the newest arrivals.
 */
export async function getSearchSuggestions(): Promise<SearchSuggestionsResult> {
  // One instant drives every promotion filter + evaluation this call.
  const now = new Date();

  try {
    const [categoryRows, productRows] = await Promise.all([
      prisma.category.findMany({
        where: { products: { some: LISTABLE_PRODUCT } },
        select: { ...CATEGORY_HIT_SELECT, isFeatured: true, sliderOrder: true },
        orderBy: { name: "asc" },
      }),
      prisma.product.findMany({
        where: LISTABLE_PRODUCT,
        select: hitSelect(now),
        orderBy: { createdAt: "desc" },
        take: SUGGESTED_PRODUCT_LIMIT,
      }),
    ]);

    // Featured categories lead in their curated slider order; the rest follow
    // alphabetically (the query's order — Array.prototype.sort is stable).
    const categories = [...categoryRows]
      .sort((a, b) => {
        if (a.isFeatured !== b.isFeatured) return a.isFeatured ? -1 : 1;
        return a.isFeatured ? a.sliderOrder - b.sliderOrder : 0;
      })
      .slice(0, SUGGESTED_CATEGORY_LIMIT)
      .map(toCategoryHit);

    return {
      success: true,
      data: {
        categories,
        products: productRows.filter(hasStartingVariant).map((row) => toProductHit(row, now)),
      },
    };
  } catch (err) {
    console.error("getSearchSuggestions failed:", err);
    return { success: false, error: "Couldn't load suggestions." };
  }
}
