"use server";

import { countShopListing, getShopFacets } from "@/lib/shop-catalog";
import { parseShopFilters, resolveShopFilters } from "@/lib/shop-filters";

/**
 * The /shop filter sheet's live result count ("Show 12 creations").
 *
 * A read, yet a Server Action: the sheet asks at interaction time, from /shop
 * and from the ISR listings alike, and the platform has no API routes. Public
 * by design — guests filter too — so there is no gate; it returns only a count
 * of listable catalogue products, the same set /shop itself shows. The query
 * is the one /shop reads (`toShopQuery`), parsed by the same soft schema and
 * counted by the same engine against ONE `now`, so the count always equals
 * the grid the sheet's Apply lands on. Nothing here writes or revalidates.
 */

export type CountShopProductsResult =
  | { success: true; count: number }
  | { success: false; error: string };

export async function countShopProducts(query: unknown): Promise<CountShopProductsResult> {
  try {
    const now = new Date();
    const filters = resolveShopFilters(parseShopFilters(query), await getShopFacets());
    return { success: true, count: await countShopListing(filters, now) };
  } catch (err) {
    console.error("countShopProducts failed:", err);
    return { success: false, error: "Couldn't count products right now." };
  }
}
